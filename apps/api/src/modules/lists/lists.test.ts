import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient, signedIn } from '../../test/helpers';
import { startRecord } from '../fms/engine';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Client = Awaited<ReturnType<typeof signedIn>>;
type Field = Record<string, unknown> & { key: string };
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const enc = encodeURIComponent;

/** A company with its owner (an admin) and one ordinary member. */
async function setup() {
  const o = await ownerClient(ctx.app);
  const mobile = rnd();
  const r = (await o.api.post('/api/org/users', { name: 'Gopal Prajapat', mobile, loginEnabled: true })).body;
  const member = await signedIn(ctx.app, mobile, r.tempPassword);
  await member.post('/api/auth/change-password', {
    currentPassword: r.tempPassword,
    newPassword: 'Gopal12345',
  });
  return { ...o, member, memberId: r.person.id as string, companyId: o.company.id };
}

/** A published one-step process whose start form (and, when given, step form) has the fields under test. */
async function makeFlow(
  api: Client,
  doerId: string,
  name: string,
  startFields: Field[],
  stepFields: Field[] = [],
) {
  const flow = (await api.post('/api/fms/flows', { meta: { name, runName: 'Booking' } })).body;
  await api.put(`/api/fms/flows/${flow.id}`, {
    meta: { coordinatorId: doerId, solverId: doerId },
    definition: {
      timeModel: 'calendar',
      startFields,
      steps: [
        {
          key: 'confirm',
          name: 'Confirm',
          type: 'TASK',
          doerIds: [doerId],
          time: { value: 2, unit: 'hours', anchor: 'previous' },
          fields: stepFields,
        },
      ],
    },
  });
  const pub = await api.post(`/api/fms/flows/${flow.id}/publish`);
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return flow.id as string;
}

const start = (api: Client, flowId: string, data: Record<string, unknown>) =>
  api.post(`/api/fms/flows/${flowId}/records`, { data });
const offer = async (api: Client, key: string, q = '') =>
  (await api.get(`/api/lists/offer?key=${enc(key)}&q=${enc(q)}`)).body as {
    values: { value: string; uses: number }[];
    total: number;
    canAdd: boolean;
  };
const offered = async (api: Client, key: string, q = '') =>
  (await offer(api, key, q)).values.map((v) => v.value);
const adminValues = async (api: Client, key: string) =>
  (await api.get(`/api/lists/values?key=${enc(key)}`)).body.values as {
    id: string;
    value: string;
    uses: number;
    hidden: boolean;
  }[];
const stored = async (recordId: string) =>
  (await ctx.prisma.fmsRecord.findUniqueOrThrow({ where: { id: recordId } })).data as Record<string, unknown>;
const learn = (key: string, label: string, more: object = {}): Field => ({
  key,
  label,
  type: 'text',
  learn: true,
  ...more,
});

describe('value lists', () => {
  it('L1: a remembered field offers the values already entered, most used first, filtered as you type', async () => {
    const s = await setup();
    const flowId = await makeFlow(s.api, s.memberId, 'Banquet booking', [learn('occasion', 'Occasion')]);
    const key = `flow:${flowId}:occasion`;
    for (const v of ['Wedding', 'Birthday party', 'Corporate lunch', 'Birthday party', 'Corporate lunch'])
      expect((await start(s.member, flowId, { occasion: v })).status).toBe(200);
    await start(s.member, flowId, { occasion: 'Birthday party' });

    expect((await offer(s.member, key)).values).toEqual([
      { value: 'Birthday party', uses: 3 },
      { value: 'Corporate lunch', uses: 2 },
      { value: 'Wedding', uses: 1 },
    ]);
    // Every typed word must match, in any order and whatever the capitals.
    expect(await offered(s.member, key, 'PAR birth')).toEqual(['Birthday party']);
    expect(await offered(s.member, key, 'lunch')).toEqual(['Corporate lunch']);
    expect(await offered(s.member, key, 'd')).toEqual(['Birthday party', 'Wedding']);
    expect(await offered(s.member, key, 'birthday lunch')).toEqual([]);
    // The same list through the choice sources (`list:<key>`).
    const viaSource = await s.member.get(`/api/masters/options?source=${enc(`list:${key}`)}`);
    expect(viaSource.body.map((o: { value: string }) => o.value)).toEqual([
      'Birthday party',
      'Corporate lunch',
      'Wedding',
    ]);
    const filtered = await s.member.get(`/api/masters/options?source=${enc(`list:${key}`)}&q=wed`);
    expect(filtered.body).toEqual([{ value: 'Wedding', label: 'Wedding', sub: null }]);
  });

  it('L2: a value written once is saved with the record and offered by the next record of the same process', async () => {
    const s = await setup();
    const flowId = await makeFlow(
      s.api,
      s.memberId,
      'Table booking',
      [learn('area', 'Area'), { key: 'guest', label: 'Guest', type: 'text' }],
      [learn('served_by', 'Served by')],
    );
    const key = `flow:${flowId}:area`;
    expect(await offer(s.member, key)).toMatchObject({ values: [], total: 0 });

    const first = await start(s.member, flowId, { area: 'Rooftop', guest: 'Mr Jain' });
    expect(first.status).toBe(200);
    expect(await stored(first.body.id)).toMatchObject({ area: 'Rooftop' });
    expect((await offer(s.member, key)).values).toEqual([{ value: 'Rooftop', uses: 1 }]);
    // A plain text field next to it remembers nothing.
    expect(await offered(s.member, `flow:${flowId}:guest`)).toEqual([]);

    // The next record: the same value in other capitals is the same value, kept in the list's spelling.
    const second = await start(s.member, flowId, { area: '  rooftop ', guest: 'Ms Rao' });
    expect(await stored(second.body.id)).toMatchObject({ area: 'Rooftop' });
    expect((await offer(s.member, key)).values).toEqual([{ value: 'Rooftop', uses: 2 }]);
    expect(await ctx.prisma.valueList.count({ where: { companyId: s.companyId, key } })).toBe(1);

    // A step's field has its own list, fed when the step is done.
    const rec = (await s.api.get(`/api/fms/records/${first.body.id}`)).body;
    const step = rec.steps.find((x: { status: string }) => x.status === 'OPEN');
    const done = await s.member.post(`/api/fms/steps/${step.id}/complete`, {
      data: { served_by: 'Captain Ravi' },
    });
    expect(done.status).toBe(200);
    expect(await offered(s.member, `flow:${flowId}:served_by`)).toEqual(['Captain Ravi']);

    // The public form never feeds a list: the value stays on its record only.
    const pub = await startRecord(ctx.prisma, {
      companyId: s.companyId,
      flowId,
      data: { area: 'Spam Terrace' },
      startedById: null,
      source: 'public',
    });
    expect(await stored(pub.id)).toMatchObject({ area: 'Spam Terrace' });
    expect(await offered(s.member, key)).toEqual(['Rooftop']);

    // A new value is a change to the list: audited, with an event; one more use is only counted.
    const audits = await ctx.prisma.auditLog.findMany({
      where: { companyId: s.companyId, action: 'list.value_added' },
    });
    expect(audits).toHaveLength(2);
    expect(audits.map((a) => (a.after as { value: string }).value).sort()).toEqual([
      'Captain Ravi',
      'Rooftop',
    ]);
  });

  it('L3: one named list is fed and offered by fields in two different processes', async () => {
    const s = await setup();
    const banquet = await makeFlow(s.api, s.memberId, 'Banquet enquiry', [
      learn('venue', 'Venue', { list: 'venues' }),
    ]);
    const party = await makeFlow(s.api, s.memberId, 'Party order', [
      learn('place', 'Place', { list: 'venues' }),
      learn('theme', 'Theme'),
    ]);
    const key = 'list:venues';

    await start(s.member, banquet, { venue: 'Banquet hall' });
    // The other process already offers what the first one learnt…
    expect(await offered(s.member, key)).toEqual(['Banquet hall']);
    await start(s.member, party, { place: 'Banquet hall', theme: 'Retro' });
    await start(s.member, party, { place: 'Lawn', theme: 'Retro' });
    // …and what it learns comes back to the first: one list, counted across both.
    expect((await offer(s.member, key)).values).toEqual([
      { value: 'Banquet hall', uses: 2 },
      { value: 'Lawn', uses: 1 },
    ]);
    expect(await offered(s.member, `flow:${banquet}:venue`)).toEqual([]);
    expect(await offered(s.member, `flow:${party}:theme`)).toEqual(['Retro']);
    // As a choice source a named list is `list:list:<name>`.
    const viaSource = await s.member.get(`/api/masters/options?source=${enc(`list:${key}`)}`);
    expect(viaSource.body.map((o: { value: string }) => o.value)).toEqual(['Banquet hall', 'Lawn']);

    // Masters → Lists shows it once, with both forms that use it; the form editor can pick it by name.
    const lists = (await s.api.get('/api/lists')).body as {
      key: string;
      shared: boolean;
      name: string;
      values: number;
      uses: number;
      usedIn: { kind: string; name: string; field: string }[];
    }[];
    const venues = lists.find((l) => l.key === key)!;
    expect(venues).toMatchObject({ shared: true, name: 'venues', values: 2, uses: 3 });
    expect(venues.usedIn.map((u) => `${u.name} · ${u.field}`).sort()).toEqual([
      'Banquet enquiry · Venue',
      'Party order · Place',
    ]);
    expect(lists.find((l) => l.key === `flow:${party}:theme`)).toMatchObject({
      shared: false,
      name: 'Theme',
      values: 1,
    });
    expect((await s.member.get('/api/lists/names')).body).toEqual([{ name: 'venues', values: 2, forms: 2 }]);
  });

  it('L4: an admin renames, merges and hides values; old records keep what they said', async () => {
    const s = await setup();
    const flowId = await makeFlow(s.api, s.memberId, 'Delivery', [learn('city', 'City')]);
    const key = `flow:${flowId}:city`;
    const typo = (await start(s.member, flowId, { city: 'Jaipr' })).body;
    await start(s.member, flowId, { city: 'Jaipur' });
    await start(s.member, flowId, { city: 'Jaipur' });
    const ajmer = (await start(s.member, flowId, { city: 'Ajmer' })).body;
    const id = async (value: string) => (await adminValues(s.api, key)).find((v) => v.value === value)!.id;

    // Rename: the list offers the new text; the record that said "Ajmer" still says "Ajmer".
    const renamed = await s.api.patch(`/api/lists/values/${await id('Ajmer')}`, { value: 'Ajmer city' });
    expect(renamed.body).toMatchObject({ value: 'Ajmer city', hidden: false });
    expect(await offered(s.member, key)).toEqual(['Jaipur', 'Ajmer city', 'Jaipr']);
    expect(await stored(ajmer.id)).toMatchObject({ city: 'Ajmer' });
    // A name another value already has is refused (merge them instead).
    expect((await s.api.patch(`/api/lists/values/${await id('Jaipr')}`, { value: 'JAIPUR' })).status).toBe(
      409,
    );

    // Merge the typo into the right one: its uses are added, it is gone from the list, the record is untouched.
    const merged = await s.api.post(`/api/lists/values/${await id('Jaipr')}/merge`, {
      into: await id('Jaipur'),
    });
    expect(merged.body).toMatchObject({ value: 'Jaipur', uses: 3 });
    expect((await offer(s.member, key)).values).toEqual([
      { value: 'Jaipur', uses: 3 },
      { value: 'Ajmer city', uses: 1 },
    ]);
    expect((await adminValues(s.api, key)).map((v) => v.value)).toEqual(['Jaipur', 'Ajmer city']);
    expect(await stored(typo.id)).toMatchObject({ city: 'Jaipr' });
    expect((await s.api.get(`/api/fms/records/${typo.id}`)).body.title).toBe('Jaipr');
    // A value can't be merged into itself, or into a value of another list.
    const jaipur = await id('Jaipur');
    expect((await s.api.post(`/api/lists/values/${jaipur}/merge`, { into: jaipur })).status).toBe(400);

    // Hide: no longer offered, still on the admin's screen; show it again and it is back.
    const ajmerId = await id('Ajmer city');
    await s.api.patch(`/api/lists/values/${ajmerId}`, { hidden: true });
    expect(await offered(s.member, key)).toEqual(['Jaipur']);
    expect(await adminValues(s.api, key)).toEqual([
      expect.objectContaining({ value: 'Jaipur', hidden: false }),
      expect.objectContaining({ value: 'Ajmer city', hidden: true }),
    ]);
    expect((await s.api.get('/api/lists')).body.find((l: { key: string }) => l.key === key)).toMatchObject({
      values: 2,
      hidden: 1,
      uses: 4,
    });
    await s.api.patch(`/api/lists/values/${ajmerId}`, { hidden: false });
    expect(await offered(s.member, key)).toEqual(['Jaipur', 'Ajmer city']);

    // An admin adds a value nobody typed yet; the same value twice is refused.
    expect((await s.api.post('/api/lists/values', { key, value: ' Kishangarh ' })).body.value).toBe(
      'Kishangarh',
    );
    expect((await s.api.post('/api/lists/values', { key, value: 'kishangarh' })).status).toBe(409);
    expect((await s.api.post('/api/lists/values', { key: 'nonsense', value: 'X' })).status).toBe(400);
    expect((await offer(s.member, key)).values.at(-1)).toEqual({ value: 'Kishangarh', uses: 0 });

    // The merged text is free again: typed anew, it is a new value.
    await start(s.member, flowId, { city: 'Jaipr' });
    expect(await offered(s.member, key)).toContain('Jaipr');

    // Every change left an audit row and a domain event.
    for (const [action, n] of [
      ['list.value_renamed', 1],
      ['list.values_merged', 1],
      ['list.value_hidden', 1],
      ['list.value_shown', 1],
    ] as const) {
      const where = { companyId: s.companyId, entityType: 'value_list' };
      expect(await ctx.prisma.auditLog.count({ where: { ...where, action } }), action).toBe(n);
      expect(await ctx.prisma.domainEvent.count({ where: { ...where, name: action } }), action).toBe(n);
    }
    // Three different values typed, one added by the admin, and "Jaipr" typed again after the merge.
    expect(
      await ctx.prisma.auditLog.count({ where: { companyId: s.companyId, action: 'list.value_added' } }),
    ).toBe(5);
  });

  it('L5: "only admins add" makes the field a strict dropdown once the list has values', async () => {
    const s = await setup();
    const closed = { writeAllowed: false };
    const flowId = await makeFlow(
      s.api,
      s.memberId,
      'Room booking',
      [learn('room_type', 'Room type', closed)],
      [learn('bed', 'Bed', closed)],
    );
    const key = `flow:${flowId}:room_type`;
    // The form asks the server who may write: the member may not, the admin may.
    expect((await offer(s.member, key)).canAdd).toBe(false);
    expect((await offer(s.api, key)).canAdd).toBe(true);

    // Until the list has a value there is nothing to pick from, so the first one can be typed.
    expect((await start(s.member, flowId, { room_type: 'Deluxe' })).status).toBe(200);
    // Now it is closed: a member's new value is refused, on that field…
    const refused = await start(s.member, flowId, { room_type: 'Suite' });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { fields: { room_type: 'Room type: pick from the list' } },
    });
    expect(await offered(s.member, key)).toEqual(['Deluxe']);
    // …picking a listed value is fine…
    const picked = await start(s.member, flowId, { room_type: 'deluxe' });
    expect(picked.status).toBe(200);
    // …and an admin's new value is accepted and offered to everyone from then on.
    expect((await start(s.api, flowId, { room_type: 'Suite' })).status).toBe(200);
    expect(await offered(s.member, key)).toEqual(['Deluxe', 'Suite']);
    expect((await start(s.member, flowId, { room_type: 'Suite' })).status).toBe(200);

    // A hidden value is not on the list any more: a member can't use it either.
    const suite = (await adminValues(s.api, key)).find((v) => v.value === 'Suite')!;
    await s.api.patch(`/api/lists/values/${suite.id}`, { hidden: true });
    expect((await start(s.member, flowId, { room_type: 'Suite' })).status).toBe(400);

    // The same rule on a step's form.
    await s.api.post('/api/lists/values', { key: `flow:${flowId}:bed`, value: 'King' });
    const rec = (await s.api.get(`/api/fms/records/${picked.body.id}`)).body;
    const step = rec.steps.find((x: { status: string }) => x.status === 'OPEN');
    const bad = await s.member.post(`/api/fms/steps/${step.id}/complete`, { data: { bed: 'Bunk' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fields).toEqual({ bed: 'Bed: pick from the list' });
    expect(
      (await s.member.post(`/api/fms/steps/${step.id}/complete`, { data: { bed: 'King' } })).status,
    ).toBe(200);
    expect(await offered(s.member, `flow:${flowId}:bed`)).toEqual(['King']);
  });

  it('keeps each company to its own lists, and changes to admins (core.edit)', async () => {
    const a = await setup();
    const b = await setup();
    const flowId = await makeFlow(a.api, a.memberId, 'Orders', [
      learn('colour', 'Colour', { list: 'colours' }),
    ]);
    await start(a.member, flowId, { colour: 'Calacatta gold' });
    const key = 'list:colours';
    const row = (await adminValues(a.api, key))[0]!;

    // Another company reads nothing of it — by the form, by the choice source or on the admin screen…
    expect(await offer(b.api, key)).toMatchObject({ values: [], total: 0 });
    expect((await b.api.get(`/api/masters/options?source=${enc(`list:${key}`)}`)).body).toEqual([]);
    expect(await adminValues(b.api, key)).toEqual([]);
    expect((await b.api.get('/api/lists')).body).toEqual([]);
    expect((await b.api.get('/api/lists/names')).body).toEqual([]);
    // …and can't change it, even knowing the value's id.
    expect((await b.api.patch(`/api/lists/values/${row.id}`, { value: 'Hacked' })).status).toBe(404);
    expect((await b.api.patch(`/api/lists/values/${row.id}`, { hidden: true })).status).toBe(404);
    const theirs = (await b.api.post('/api/lists/values', { key, value: 'Statuario' })).body;
    expect((await b.api.post(`/api/lists/values/${row.id}/merge`, { into: theirs.id })).status).toBe(404);
    expect((await b.api.post(`/api/lists/values/${theirs.id}/merge`, { into: row.id })).status).toBe(404);
    expect(await adminValues(a.api, key)).toEqual([
      expect.objectContaining({ value: 'Calacatta gold', uses: 1 }),
    ]);
    expect(await offered(b.member, key)).toEqual(['Statuario']);

    // A member reads what a form offers, but the admin screen and every change need core.edit.
    expect(await offered(a.member, key)).toEqual(['Calacatta gold']);
    expect((await a.member.get('/api/lists')).status).toBe(403);
    expect((await a.member.get(`/api/lists/values?key=${enc(key)}`)).status).toBe(403);
    expect((await a.member.post('/api/lists/values', { key, value: 'Nope' })).status).toBe(403);
    expect((await a.member.patch(`/api/lists/values/${row.id}`, { value: 'Nope' })).status).toBe(403);
    expect((await a.member.patch(`/api/lists/values/${row.id}`, { hidden: true })).status).toBe(403);
    expect((await a.member.post(`/api/lists/values/${row.id}/merge`, { into: row.id })).status).toBe(403);
    // Nobody signed in: nothing.
    const anon = await ctx.app.inject({ method: 'GET', url: `/api/lists/offer?key=${enc(key)}` });
    expect(anon.statusCode).toBe(401);
  });
});
