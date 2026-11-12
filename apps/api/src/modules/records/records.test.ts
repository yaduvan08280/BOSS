import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { statusHooks } from './hooks';
import { FY, makeRecord, makeType, siteVisit, world } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('custom record types', () => {
  it('U1: a "Site visit" type is made through the API alone; records are numbered SV/FY/0001, 0002 and a number is never reused', async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    const type = (await w.api.get(`/api/records/types/${typeId}`)).body;
    expect(type).toMatchObject({
      name: 'Site visit',
      code: 'site_visit',
      prefix: 'SV',
      status: 'ACTIVE',
      records: 0,
    });
    // Left out: everyone views, makes and edits; heads of department approve.
    expect(type.permissions).toEqual({ view: ['*'], create: ['*'], edit: ['*'], approve: [w.role('HOD')] });

    const a = await makeRecord(w.api, typeId, {
      site: 'Tonk mine',
      visit_on: '2026-11-20',
      cost: '1,250.50',
    });
    const b = await makeRecord(w.api, typeId, { site: 'Niwai factory' });
    expect(a).toMatchObject({ code: `SV/${FY}/0001`, title: 'Tonk mine', status: 'planned' });
    expect(b.code).toBe(`SV/${FY}/0002`);
    // Checked like any form: a required field, a real date, a number.
    const bad = await w.api.post(`/api/records/types/${typeId}/records`, {
      data: { visit_on: '2026-02-31', cost: 'lots' },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual(['cost', 'site', 'visit_on']);
    // A deleted record keeps its number: the next one is 0003, not 0002 again.
    expect((await w.api.del(`/api/records/entries/${b.id}`)).status).toBe(200);
    expect((await w.api.get(`/api/records/entries/${b.id}`)).status).toBe(404);
    expect((await makeRecord(w.api, typeId, { site: 'Kishangarh plant' })).code).toBe(`SV/${FY}/0003`);

    const detail = (await w.api.get(`/api/records/entries/${a.id}`)).body;
    expect(detail.record).toMatchObject({ code: `SV/${FY}/0001`, data: { site: 'Tonk mine', cost: 1250.5 } });
    // Every change wrote an audit row and a domain event that webhooks can carry.
    const events = await ctx.prisma.domainEvent.findMany({
      where: { companyId: w.companyId, entityId: a.id },
    });
    expect(events.map((e) => e.name)).toEqual(['record.created']);
    expect(events[0]!.payload).toMatchObject({
      code: `SV/${FY}/0001`,
      type: 'Site visit',
      status: 'planned',
    });
    const audit = await ctx.prisma.auditLog.findMany({
      where: { companyId: w.companyId, entityType: { in: ['record', 'record_type'] } },
    });
    expect(audit.map((x) => x.action).sort()).toEqual([
      'record.created',
      'record.created',
      'record.created',
      'record.deleted',
      'record_type.created',
    ]);
  });

  it('U1: a type must be sound, and nothing destructive is allowed once records hold it', async () => {
    const w = await world(ctx.app);
    const broken = siteVisit();
    broken.definition.moves = broken.definition.moves.filter((m) => m.to !== 'approved');
    const res = await w.api.post('/api/records/types', broken);
    expect(res.status).toBe(400);
    expect(res.body.error.details.problems).toContain(
      'No move leads to "Approved": add a move to it, or remove the status',
    );
    const typeId = await makeType(w.api);
    // The same name or the same number prefix again is refused.
    expect((await w.api.post('/api/records/types', siteVisit({ prefix: 'SX' }))).status).toBe(409);
    expect((await w.api.post('/api/records/types', siteVisit({ name: 'Survey visit' }))).status).toBe(409);
    await makeRecord(w.api, typeId, { site: 'Tonk mine', cost: 500 });

    const def = siteVisit().definition;
    const patch = (definition: unknown) => w.api.patch(`/api/records/types/${typeId}`, { definition });
    // Removing a field that records hold, or turning it into a type its values don't fit: refused, saying why.
    const gone = await patch({ ...def, fields: def.fields.filter((f) => f.key !== 'cost') });
    expect(gone.status).toBe(409);
    expect(gone.body.error.message).toBe(
      '"Cost" is filled in 1 site visit: it can\'t be removed or given a new key, or that information would be lost',
    );
    const retyped = await patch({
      ...def,
      fields: def.fields.map((f) => (f.key === 'site' ? { ...f, type: 'number' } : f)),
    });
    expect(retyped.status).toBe(409);
    expect(retyped.body.error.message).toMatch(/its type can't change from text to number/);
    // A status that a record stands in can't go; one nobody is in can.
    const noPlanned = await patch({
      ...def,
      statuses: def.statuses.filter((s) => s.key !== 'planned' && s.key !== 'cancelled'),
      start: 'visited',
      moves: def.moves.filter((m) => m.from !== 'planned' && m.to !== 'planned'),
    });
    expect(noPlanned.status).toBe(409);
    expect(noPlanned.body.error.message).toMatch(/1 site visit is in the status "Planned"/);
    const fine = await patch({
      ...def,
      // An empty field goes, a new one comes, text becomes long text, a status nobody stands in goes.
      fields: [
        ...def.fields
          .filter((f) => f.key !== 'visit_on')
          .map((f) => (f.key === 'site' ? { ...f, type: 'longtext' } : f)),
        { key: 'engineer', label: 'Engineer', type: 'master', master: 'people' },
      ],
      statuses: def.statuses.filter((s) => s.key !== 'cancelled'),
      moves: def.moves.filter((m) => m.to !== 'cancelled'),
    });
    expect(fine.status).toBe(200);
    // Details change without touching the definition (a patch has no defaults).
    expect(
      (await w.api.patch(`/api/records/types/${typeId}`, { pluralName: 'Visits', prefix: 'VST' })).status,
    ).toBe(200);
    const type = (await w.api.get(`/api/records/types/${typeId}`)).body;
    expect(type).toMatchObject({ pluralName: 'Visits', prefix: 'VST', records: 1 });
    expect(type.definition.fields.map((f: { key: string }) => f.key)).toContain('engineer');
    // The series goes on under the new prefix.
    expect((await makeRecord(w.api, typeId, { site: 'Niwai' })).code).toBe(`VST/${FY}/0002`);

    // Archived: kept with its records, no new ones. A type with records can't be deleted.
    expect((await w.api.post(`/api/records/types/${typeId}/archive`)).body.status).toBe('ARCHIVED');
    expect((await w.api.post(`/api/records/types/${typeId}/archive`)).status).toBe(409);
    expect((await w.api.post(`/api/records/types/${typeId}/records`, { data: { site: 'X' } })).status).toBe(
      409,
    );
    expect((await w.api.del(`/api/records/types/${typeId}`)).status).toBe(409);
    expect((await w.api.post(`/api/records/types/${typeId}/restore`)).body.status).toBe('ACTIVE');
    // One nobody used is deleted, and its name and prefix are free again.
    const spare = await makeType(w.api, siteVisit({ name: 'Trip', pluralName: 'Trips', prefix: 'TR' }));
    expect((await w.api.del(`/api/records/types/${spare}`)).status).toBe(200);
    expect((await w.api.get(`/api/records/types/${spare}`)).status).toBe(404);
    await makeType(w.api, siteVisit({ name: 'Trip', pluralName: 'Trips', prefix: 'TR' }));
  });

  it("U2: moves are allowed or refused by the type's own table, by who may make them, and leave a history", async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    const gopal = await w.person('Gopal Prajapat');
    const ravi = await w.person('Ravi Sharma');
    const hod = await w.person('Sunita Jain', 'HOD');
    const rec = await makeRecord(gopal.api, typeId, { site: 'Tonk mine' });
    const move = (api: typeof w.api, action: string, note?: string) =>
      api.post(`/api/records/entries/${rec.id}/move`, { action, ...(note ? { note } : {}) });
    const moves = async (api: typeof w.api) =>
      ((await api.get(`/api/records/entries/${rec.id}`)).body.moves as { action: string }[]).map(
        (m) => m.action,
      );

    // The creator may visit or cancel; another editor only visits; an approver has nothing to do yet.
    expect(await moves(gopal.api)).toEqual(['visit', 'cancel']);
    expect(await moves(ravi.api)).toEqual(['visit']);
    expect(await moves(hod.api)).toEqual(['visit']);
    // Not from here, not this person, not without saying why.
    expect((await move(gopal.api, 'approve')).status).toBe(409);
    expect((await move(ravi.api, 'cancel', 'not needed')).status).toBe(403);
    const noWhy = await move(gopal.api, 'cancel');
    expect(noWhy.status).toBe(400);
    expect(noWhy.body.error.message).toBe('Write why, to cancel');
    expect((await move(gopal.api, 'fly')).status).toBe(409);

    expect((await move(ravi.api, 'visit')).body).toMatchObject({ status: 'visited', from: 'planned' });
    const refused = await move(gopal.api, 'approve');
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: 'FORBIDDEN_TRANSITION' });
    expect((await move(hod.api, 'send_back', 'Photos missing')).body.status).toBe('planned');
    expect((await move(gopal.api, 'visit')).status).toBe(200);
    expect((await move(hod.api, 'approve')).body.status).toBe('approved');
    // Approved is final: no more moves, and the fields are closed (notes still go on).
    expect(await moves(w.api)).toEqual([]);
    const late = await move(w.api, 'visit');
    expect(late.status).toBe(409);
    expect(late.body.error.message).toBe('This site visit is Approved: nothing more can be done with it');
    expect(
      (await gopal.api.patch(`/api/records/entries/${rec.id}`, { data: { site: 'Changed' } })).status,
    ).toBe(409);
    expect((await ravi.api.post(`/api/records/entries/${rec.id}/notes`, { note: 'Well done' })).status).toBe(
      200,
    );
    expect((await ravi.api.post(`/api/records/entries/${rec.id}/notes`, { note: '  ' })).status).toBe(400);
    // A closed record is deleted only by an admin.
    expect((await gopal.api.del(`/api/records/entries/${rec.id}`)).status).toBe(403);

    const detail = (await hod.api.get(`/api/records/entries/${rec.id}`)).body;
    expect(detail.record.status).toBe('approved');
    expect(detail.can).toEqual({ edit: false, files: true, delete: false });
    expect(
      detail.events.map(
        (e: { type: string; by: string; fromStatus: string; toStatus: string; note: string }) =>
          [e.type, e.by, e.fromStatus, e.toStatus, e.note].filter(Boolean).join(' | '),
      ),
    ).toEqual([
      'created | Gopal Prajapat',
      'status | Ravi Sharma | planned | visited',
      'status | Sunita Jain | visited | planned | Photos missing',
      'status | Gopal Prajapat | planned | visited',
      'status | Sunita Jain | visited | approved',
      'note | Ravi Sharma | Well done',
    ]);
    const names = (
      await ctx.prisma.domainEvent.findMany({
        where: { companyId: w.companyId, entityId: rec.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((e) => e.name);
    expect(names.filter((x) => x === 'record.status_changed')).toHaveLength(4);
    expect(names.at(-1)).toBe('record.note');
  });

  it('U2: a status change runs the hooks in its own transaction (a failing hook undoes the move)', async () => {
    const w = await world(ctx.app);
    const typeId = await makeType(w.api);
    const rec = await makeRecord(w.api, typeId, { site: 'Tonk mine' });
    const seen: string[] = [];
    statusHooks.push(async (_tx, c) => {
      seen.push(`${c.record.code}: ${c.from} → ${c.to} (${c.move.action})`);
      if (c.to === 'approved') throw new Error('the flow could not start');
    });
    try {
      expect((await w.api.post(`/api/records/entries/${rec.id}/move`, { action: 'visit' })).status).toBe(200);
      expect((await w.api.post(`/api/records/entries/${rec.id}/move`, { action: 'approve' })).status).toBe(
        500,
      );
    } finally {
      statusHooks.length = 0;
    }
    expect(seen).toEqual([
      `SV/${FY}/0001: planned → visited (visit)`,
      `SV/${FY}/0001: visited → approved (approve)`,
    ]);
    expect((await w.api.get(`/api/records/entries/${rec.id}`)).body.record.status).toBe('visited');
  });

  it('U1: a "unique" field and a "remember what people type" field on a record type do not break saving', async () => {
    const w = await world(ctx.app);
    const base = siteVisit();
    const typeId = await makeType(
      w.api,
      siteVisit({
        definition: {
          ...base.definition,
          fields: [
            ...base.definition.fields,
            { key: 'permit_no', label: 'Permit no.', type: 'text', unique: true },
            { key: 'city', label: 'City', type: 'text', learn: true },
            { key: 'route', label: 'Route', type: 'text', learn: true, list: 'routes', writeAllowed: false },
          ],
        },
      }),
    );
    const rec = await makeRecord(w.api, typeId, {
      site: 'Tonk mine',
      permit_no: 'P-77',
      city: 'Tonk',
      route: 'NH52',
    });
    const saved = await w.api.patch(`/api/records/entries/${rec.id}`, {
      data: { site: 'Tonk mine', permit_no: 'P-78', city: 'Jaipur', route: 'NH52' },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.changed).toEqual(['Permit no.', 'City']);
    expect((await w.api.del(`/api/records/entries/${rec.id}`)).status).toBe(200);
  });
});
