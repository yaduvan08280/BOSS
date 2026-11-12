import { formatDate, localDate } from '@mono/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import {
  cancel,
  doStep,
  master,
  options,
  publish,
  row,
  start,
  stranger,
  task,
  team,
  type Ctx,
} from './test-kit';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const text = (key: string, label: string, more: object = {}) => ({ key, label, type: 'text', ...more });
const today = () => formatDate(new Date(), 'Asia/Kolkata');

describe('linked choices: values and records of another process', () => {
  it('L6: a dropdown offers the values typed in a field of another process', async () => {
    const t = await team(ctx);
    const purchase = await publish(t.api, 'Purchase request', {
      startFields: [text('vendor', 'Vendor name', { required: true })],
      steps: [task('quote', t.owner.id, [text('transporter', 'Transporter')])],
    });
    const a = (await start(t.api, purchase, { vendor: 'Shree Minerals' })).body;
    await start(t.api, purchase, { vendor: '  shree minerals ' });
    await start(t.member.api, purchase, { vendor: 'Shree Minerals' });
    await start(t.api, purchase, { vendor: 'Balaji Stones' });
    const ghost = (await start(t.api, purchase, { vendor: 'Ghost Vendor' })).body;
    await cancel(t.api, ghost.id);
    await doStep(t.api, a.id, { transporter: 'VRL Logistics' });

    // The field of another process reads them: one choice per value, most used first, cancelled left out.
    const receipt = await publish(t.api, 'Goods receipt', {
      startFields: [
        { key: 'vendor', label: 'Vendor', type: 'master', master: `fms:${purchase}:vendor` },
        { key: 'carrier', label: 'Carrier', type: 'master', master: `fms:${purchase}:transporter` },
      ],
      steps: [task('check', t.owner.id)],
    });
    const at = { owner: `flow:${receipt}`, field: 'vendor' };
    const all = await options(t.member.api, at);
    expect(all.list.map((o) => o.value)).toEqual(['Shree Minerals', 'Balaji Stones']);
    expect(all.list[0]!.ref).toBeUndefined();
    expect((await options(t.api, { ...at, q: 'bal' })).list.map((o) => o.value)).toEqual(['Balaji Stones']);
    // A value typed on a finished step counts too.
    expect(
      (await options(t.api, { owner: `flow:${receipt}`, field: 'carrier' })).list.map((o) => o.value),
    ).toEqual(['VRL Logistics']);
    // The same list by its source name (the editor).
    expect((await options(t.api, { source: `fms:${purchase}:vendor` })).list).toHaveLength(2);

    // It is saved as plain text (a typed value has no row to link to), and a new value may still be typed.
    const saved = (await start(t.api, receipt, { vendor: 'Balaji Stones', _refs: { vendor: 'row:nope' } }))
      .body;
    expect(saved.data).toEqual({ vendor: 'Balaji Stones' });
    expect((await start(t.api, receipt, { vendor: 'A new vendor' })).status).toBe(200);
  });

  it('L7: a field picks a whole record of another process — label, link and columns', async () => {
    const t = await team(ctx);
    const events = await publish(t.api, 'Banquet booking', {
      startFields: [
        text('party', 'Party', { required: true }),
        { key: 'guests', label: 'Guests', type: 'number' },
      ],
      steps: [task('confirm', t.owner.id, [text('hall', 'Hall')]), task('bill', t.owner.id)],
    });
    const rec = (await start(t.api, events, { party: 'Sharma wedding', guests: 250 })).body;
    await doStep(t.api, rec.id, { hall: 'Lotus' });
    await start(t.api, events, { party: 'Gupta reception' });

    const list = (await options(t.api, { source: `rec:${events}`, q: 'sharma' })).list;
    expect(list).toHaveLength(1);
    const o = list[0]!;
    // Decision 46: the date is DD/MM/YYYY, in the company's time zone.
    expect(o.label).toBe(`#1 · Sharma wedding · ${today()}`);
    expect(o.label).toMatch(/^#1 · Sharma wedding · \d{2}\/\d{2}\/\d{4}$/);
    expect(o.value).toBe(o.label);
    expect(o.ref).toBe(`rec:${rec.id}`);
    expect(o.sub).toBe('bill');
    // The start form, what finished steps added, and what MONO knows about the record.
    expect(o.columns).toMatchObject({
      party: 'Sharma wedding',
      guests: 250,
      hall: 'Lotus',
      number: 1,
      title: 'Sharma wedding',
      status: 'RUNNING',
      started: localDate(new Date(), 'Asia/Kolkata'),
    });
    // By number, with or without the #.
    expect(
      (await options(t.api, { source: `rec:${events}`, q: '#2' })).list.map((x) => x.columns?.party),
    ).toEqual(['Gupta reception']);
    // The editor is told which columns a record carries.
    const cols = (await t.api.get(`/api/masters/columns?source=rec:${events}`)).body as { key: string }[];
    expect(cols.map((c) => c.key)).toEqual([
      'number',
      'title',
      'status',
      'started',
      'party',
      'guests',
      'hall',
    ]);
  });

  it('L8: record choices are limited — at step X, only running, started by me, within N days', async () => {
    const t = await team(ctx);
    const bookings = await publish(t.api, 'Room booking', {
      startFields: [text('guest', 'Guest', { required: true })],
      steps: [task('confirm', t.owner.id), task('pay', t.owner.id)],
    });
    const fresh = (await start(t.api, bookings, { guest: 'Fresh, by the owner' })).body;
    const paying = (await start(t.member.api, bookings, { guest: 'Paying, by the member' })).body;
    await doStep(t.api, paying.id);
    const held = (await start(t.api, bookings, { guest: 'On hold' })).body;
    await t.api.post(`/api/fms/records/${held.id}/actions`, { action: 'hold', reason: 'guest away' });
    const old = (await start(t.api, bookings, { guest: 'Forty days old' })).body;
    await ctx.prisma.fmsRecord.update({
      where: { id: old.id },
      data: { startedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    const gone = (await start(t.api, bookings, { guest: 'Cancelled' })).body;
    await cancel(t.api, gone.id);

    const pick = (key: string, recFilter?: object) => ({
      key,
      label: key,
      type: 'master',
      master: `rec:${bookings}`,
      recFilter,
    });
    const desk = await publish(t.api, 'Guest request', {
      startFields: [
        pick('any'),
        pick('at_pay', { step: 'pay' }),
        pick('running', { running: true }),
        pick('mine', { mine: true }),
        pick('recent', { days: 30 }),
        pick('mine_running', { mine: true, running: true }),
      ],
      steps: [task('do', t.owner.id)],
    });
    const guests = async (api: typeof t.api, field: string, more: Record<string, string> = {}) =>
      (await options(api, { owner: `flow:${desk}`, field, ...more })).list
        .map((o) => String(o.columns?.guest))
        .sort();

    // No filter: every live record (never the cancelled one), newest first.
    expect(await guests(t.api, 'any')).toEqual([
      'Forty days old',
      'Fresh, by the owner',
      'On hold',
      'Paying, by the member',
    ]);
    expect(await guests(t.api, 'at_pay')).toEqual(['Paying, by the member']);
    expect(await guests(t.api, 'running')).toEqual([
      'Forty days old',
      'Fresh, by the owner',
      'Paying, by the member',
    ]);
    expect(await guests(t.member.api, 'mine')).toEqual(['Paying, by the member']);
    expect(await guests(t.api, 'mine')).toEqual(['Forty days old', 'Fresh, by the owner', 'On hold']);
    expect(await guests(t.api, 'recent')).toEqual([
      'Fresh, by the owner',
      'On hold',
      'Paying, by the member',
    ]);
    expect(await guests(t.api, 'mine_running')).toEqual(['Forty days old', 'Fresh, by the owner']);

    // The browser cannot widen a field: naming the whole source beside the field changes nothing.
    expect(await guests(t.member.api, 'mine', { source: `rec:${bookings}` })).toEqual([
      'Paying, by the member',
    ]);
    // …and on save, a link to a record the field would not offer is dropped (the text stays).
    const forged = (
      await start(t.member.api, desk, { mine: 'Someone else’s', _refs: { mine: `rec:${fresh.id}` } })
    ).body;
    expect(forged.data).toEqual({ mine: 'Someone else’s' });
    const fair = (await start(t.member.api, desk, { mine: 'x', _refs: { mine: `rec:${paying.id}` } })).body;
    expect(fair.data._refs).toEqual({ mine: `rec:${paying.id}` });
    expect(fair.data.mine).toBe(`#2 · Paying, by the member · ${today()}`);
  });
});

describe('linked choices: the link beside the text', () => {
  async function vendorsAndFlow() {
    const t = await team(ctx);
    const vendors = await master(t.api, 'Suppliers', [
      text('name', 'Name', { required: true }),
      text('city', 'City'),
    ]);
    const shree = await row(t.api, vendors, { name: 'Shree Minerals', city: 'Ajmer' });
    const flow = await publish(t.api, 'Goods receipt', {
      startFields: [
        { key: 'vendor', label: 'Vendor', type: 'master', master: `m:${vendors}`, required: true },
      ],
      steps: [task('check', t.owner.id)],
    });
    return { t, vendors, shree, flow };
  }
  const links = async (api: Awaited<ReturnType<typeof team>>['api'], refs: string[]) =>
    (await api.post('/api/masters/links', { refs })).body as Record<
      string,
      { label: string; to: string | null }
    >;

  it('L9: a picked value keeps a link to its row, and renaming the row does not break it', async () => {
    const { t, vendors, shree, flow } = await vendorsAndFlow();
    const picked = (await options(t.api, { owner: `flow:${flow}`, field: 'vendor', q: 'shree' })).list[0]!;
    expect(picked).toMatchObject({
      value: 'Shree Minerals',
      ref: `row:${shree.id}`,
      columns: { city: 'Ajmer' },
    });
    const rec = (await start(t.api, flow, { vendor: picked.value, _refs: { vendor: picked.ref } })).body;
    // The text people read stays the value; the link sits beside it under `_refs`.
    expect(rec.data).toEqual({ vendor: 'Shree Minerals', _refs: { vendor: `row:${shree.id}` } });
    expect(rec.title).toBe('Shree Minerals');

    await t.api.put(`/api/masters/${vendors}/rows/${shree.id}`, {
      name: 'Shree Minerals Pvt Ltd',
      city: 'Ajmer',
    });
    const after = (await t.api.get(`/api/fms/records/${rec.id}`)).body;
    expect(after.data.vendor).toBe('Shree Minerals'); // history is not rewritten
    // The drawer asks for the record's links together: the row's name today, and where it opens.
    expect(await links(t.api, [after.data._refs.vendor])).toEqual({
      [`row:${shree.id}`]: {
        label: 'Shree Minerals Pvt Ltd',
        to: `/masters/${vendors}?q=${encodeURIComponent('Shree Minerals Pvt Ltd')}`,
      },
    });
    // A row that is deleted later: the link no longer resolves, the saved text is still there.
    await t.api.del(`/api/masters/${vendors}/rows/${shree.id}`);
    expect(await links(t.api, [`row:${shree.id}`])).toEqual({});
    expect((await t.api.get(`/api/fms/records/${rec.id}`)).body.data.vendor).toBe('Shree Minerals');
  });

  it('L9: a forged link or another company’s link is dropped — the text stays', async () => {
    const { t, shree, flow } = await vendorsAndFlow();
    const other = await vendorsAndFlow();
    const customer = (await t.api.post('/api/crm/customers', { name: 'Sharma Traders' })).body;
    const cases: [string, string][] = [
      ['an id that does not exist', 'row:does-not-exist'],
      ['a row of another company', `row:${other.shree.id}`],
      ['a row of another source', `customer:${customer.id}`],
      ['not a link at all', 'javascript:alert(1)'],
    ];
    for (const [what, ref] of cases) {
      const rec = (await start(t.api, flow, { vendor: 'Typed by hand', _refs: { vendor: ref } })).body;
      expect(rec.data, what).toEqual({ vendor: 'Typed by hand' });
    }
    // A link on a field that is not "from a master", or on no field, never reaches the record.
    const stray = (await start(t.api, flow, { vendor: 'X', _refs: { nothing: `row:${shree.id}` } })).body;
    expect(stray.data).toEqual({ vendor: 'X' });
    // A real link wins over mismatching text: the two can never disagree.
    const real = (await start(t.api, flow, { vendor: 'Wrong name', _refs: { vendor: `row:${shree.id}` } }))
      .body;
    expect(real.data).toEqual({ vendor: 'Shree Minerals', _refs: { vendor: `row:${shree.id}` } });
    // Nobody resolves a link into another company.
    expect(await links((await stranger(ctx)).api, [`row:${shree.id}`, `rec:${real.id}`])).toEqual({});
  });

  it('L9: values saved before phase 11 (no links) still read, pick and resolve', async () => {
    const { t, flow } = await vendorsAndFlow();
    const rec = (await start(t.api, flow, { vendor: 'Old Supplier' })).body;
    // Exactly what an older record holds: the text, and no `_refs`.
    await ctx.prisma.fmsRecord.update({ where: { id: rec.id }, data: { data: { vendor: 'Old Supplier' } } });
    const detail = (await t.api.get(`/api/fms/records/${rec.id}`)).body;
    expect(detail.data).toEqual({ vendor: 'Old Supplier' });
    const o = (await options(t.api, { source: `rec:${flow}` })).list.find((x) => x.ref === `rec:${rec.id}`)!;
    expect(o.columns).toMatchObject({ vendor: 'Old Supplier', title: 'Old Supplier' });
    expect(o.columns).not.toHaveProperty('_refs');
    expect((await options(t.api, { source: `fms:${flow}:vendor` })).list.map((x) => x.value)).toEqual([
      'Old Supplier',
    ]);
    expect(await links(t.api, [])).toEqual({});
    // Its step still completes.
    expect((await doStep(t.api, rec.id)).status).toBe(200);
  });
});

describe('linked choices: who may read them', () => {
  it('another company gets nothing from a process of this one', async () => {
    const t = await team(ctx);
    const flow = await publish(t.api, 'Purchase request', {
      startFields: [text('vendor', 'Vendor name', { required: true })],
      steps: [task('quote', t.owner.id)],
    });
    const rec = (await start(t.api, flow, { vendor: 'Shree Minerals' })).body;
    const pick = await publish(t.api, 'Goods receipt', {
      startFields: [{ key: 'pr', label: 'Request', type: 'master', master: `rec:${flow}` }],
      steps: [task('check', t.owner.id)],
    });
    expect((await options(t.api, { source: `rec:${flow}` })).list).toHaveLength(1);

    const { api: far, ownerId } = await stranger(ctx);
    expect((await options(far, { source: `fms:${flow}:vendor` })).list).toEqual([]);
    expect((await options(far, { source: `rec:${flow}` })).list).toEqual([]);
    expect((await options(far, { owner: `flow:${pick}`, field: 'pr' })).status).toBe(400);
    expect((await far.get(`/api/masters/columns?source=rec:${flow}`)).body).toEqual([]);
    // …and cannot save a link to one of its records into a flow of its own.
    const own = await publish(far, 'Their flow', {
      startFields: [{ key: 'pr', label: 'Request', type: 'master', master: `rec:${flow}` }],
      steps: [task('do', ownerId)],
    });
    const saved = (await start(far, own, { pr: 'stolen', _refs: { pr: `rec:${rec.id}` } })).body;
    expect(saved.data).toEqual({ pr: 'stolen' });
  });

  it('reading another process needs fms.view; other lists only need a sign-in', async () => {
    const o = await team(ctx);
    const role = (await o.api.post('/api/org/roles', { name: 'Gate keeper', permissions: ['org.view'] }))
      .body;
    const guard = await o.person('Ram Gate', role.id);
    const flow = await publish(o.api, 'Purchase request', {
      startFields: [text('vendor', 'Vendor name')],
      steps: [task('quote', o.owner.id)],
    });
    const rec = (await start(o.api, flow, { vendor: 'Shree Minerals' })).body;
    const pick = await publish(o.api, 'Goods receipt', {
      startFields: [{ key: 'pr', label: 'Request', type: 'master', master: `rec:${flow}` }],
      steps: [task('check', o.owner.id)],
    });
    const closed: Record<string, string>[] = [
      { source: `fms:${flow}:vendor` },
      { source: `rec:${flow}` },
      { owner: `flow:${pick}`, field: 'pr' },
    ];
    for (const params of closed)
      expect((await options(guard.api, params)).status, JSON.stringify(params)).toBe(403);
    expect((await guard.api.get(`/api/masters/columns?source=rec:${flow}`)).status).toBe(403);
    expect((await guard.api.post('/api/masters/links', { refs: [`rec:${rec.id}`] })).body).toEqual({});
    expect((await options(guard.api, { source: 'people' })).status).toBe(200);
    expect((await options(o.member.api, { source: `rec:${flow}` })).status).toBe(200);
    // Nobody is let in without a sign-in.
    const anon = await ctx.app.inject({ method: 'GET', url: `/api/masters/options?source=rec:${flow}` });
    expect(anon.statusCode).toBe(401);
  });
});
