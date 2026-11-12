import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { FY, makeRecord, makeType, siteVisit, world } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** A "Site" type, and a "Site visit" type that links to one site, a customer, and many sites in its lines. */
async function linked(w: Awaited<ReturnType<typeof world>>) {
  const siteType = await makeType(w.api, {
    name: 'Site',
    pluralName: 'Sites',
    prefix: 'SITE',
    definition: {
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'city', label: 'City', type: 'text' },
      ],
      statuses: [
        { key: 'open', label: 'Open', kind: 'ok' },
        { key: 'closed', label: 'Closed', kind: 'neutral', final: true },
      ],
      start: 'open',
      moves: [{ from: 'open', action: 'close', label: 'Close', to: 'closed', who: ['edit'] }],
    },
    menu: { section: null, icon: 'building' },
    permissions: { view: [w.role('HOD')], create: [w.role('HOD')], edit: [w.role('HOD')], approve: [] },
  });
  const base = siteVisit();
  const visitType = await makeType(
    w.api,
    siteVisit({
      definition: {
        ...base.definition,
        fields: [
          { key: 'site', label: 'Site', type: 'master', master: `rt:${siteType}`, required: true },
          { key: 'customer', label: 'Customer', type: 'master', master: 'customers' },
          { key: 'visit_on', label: 'Visit on', type: 'date' },
        ],
        tables: [
          {
            key: 'findings',
            label: 'Findings',
            fields: [
              { key: 'what', label: 'What', type: 'text', required: true },
              { key: 'qty', label: 'Qty', type: 'number' },
              { key: 'other_site', label: 'Also at', type: 'master', master: `rt:${siteType}` },
            ],
          },
        ],
      },
    }),
  );
  return { siteType, visitType };
}

describe('record links and child lines', () => {
  it('U3: a record links to a record of another type and to a customer; the rt: source respects permissions', async () => {
    const w = await world(ctx.app);
    const { siteType, visitType } = await linked(w);
    const tonk = await makeRecord(w.api, siteType, { name: 'Tonk mine', city: 'Tonk' });
    const niwai = await makeRecord(w.api, siteType, { name: 'Niwai factory', city: 'Niwai' });
    await w.api.post(`/api/records/entries/${niwai.id}/move`, { action: 'close' });
    const customer = (await w.api.post('/api/crm/customers', { name: 'Sharma Traders', city: 'Ajmer' })).body;
    expect(customer.id).toBeTruthy();

    // What a form offers for the link: "number · title", the link itself, and the record's values as columns.
    const options = (await w.api.get(`/api/masters/options?source=rt:${siteType}`)).body;
    expect(options).toHaveLength(2);
    const pick = options.find((o: { ref: string }) => o.ref === `rt:${tonk.id}`);
    expect(pick).toMatchObject({
      value: `SITE/${FY}/0001 · Tonk mine`,
      label: `SITE/${FY}/0001 · Tonk mine`,
      sub: 'Open',
      columns: {
        name: 'Tonk mine',
        city: 'Tonk',
        code: `SITE/${FY}/0001`,
        status: 'Open',
        status_key: 'open',
      },
    });
    const found = (await w.api.get(`/api/masters/options?source=rt:${siteType}&q=niwai`)).body;
    expect(found.map((o: { sub: string }) => o.sub)).toEqual(['Closed']);
    // Sites are for heads of department: a member can't pick one, and another company's type is not found.
    const gopal = await w.person('Gopal Prajapat');
    expect((await gopal.api.get(`/api/masters/options?source=rt:${siteType}`)).status).toBe(403);
    const other = await world(ctx.app);
    expect((await other.api.get(`/api/masters/options?source=rt:${siteType}`)).status).toBe(404);

    // The value stays the text people read; the links sit beside it under _refs (README contract 2).
    const visit = await makeRecord(w.api, visitType, {
      site: pick.value,
      customer: 'Sharma Traders',
      visit_on: '2026-11-20',
      _refs: { site: pick.ref, customer: `customer:${customer.id}`, ghost: 'rt:nothing' },
    });
    expect(visit.title).toBe(`SITE/${FY}/0001 · Tonk mine`);
    const saved = (await w.api.get(`/api/records/entries/${visit.id}`)).body.record;
    expect(saved.data).toEqual({
      site: `SITE/${FY}/0001 · Tonk mine`,
      customer: 'Sharma Traders',
      visit_on: '2026-11-20',
      _refs: { site: `rt:${tonk.id}`, customer: `customer:${customer.id}` },
    });
    // The event carries the readable values (no _refs inside `data`).
    const event = await ctx.prisma.domainEvent.findFirst({
      where: { companyId: w.companyId, entityId: visit.id, name: 'record.created' },
    });
    expect((event!.payload as { data: object }).data).toEqual({
      site: `SITE/${FY}/0001 · Tonk mine`,
      customer: 'Sharma Traders',
      visit_on: '2026-11-20',
    });
  });

  it('U3: child lines are checked like small forms, saved, kept when left out, and may link to many records', async () => {
    const w = await world(ctx.app);
    const { siteType, visitType } = await linked(w);
    const tonk = await makeRecord(w.api, siteType, { name: 'Tonk mine' });
    const niwai = await makeRecord(w.api, siteType, { name: 'Niwai factory' });
    const data = { site: tonk.code, _refs: { site: `rt:${tonk.id}` } };

    // Line 2 has no "what" and a quantity that is not a number: refused, naming the table, the line and the column.
    const bad = await w.api.post(`/api/records/types/${visitType}/records`, {
      data,
      lines: { findings: [{ what: 'Crack in wall', qty: 2 }, { qty: 'many' }, {}] },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('Findings, line 2: What is required');
    expect(bad.body.error.details.lines).toEqual({
      findings: { 2: { what: 'What is required', qty: 'Qty must be a number' } },
    });
    expect((await w.api.get(`/api/records/types/${visitType}/records`)).body.total).toBe(0);

    const visit = await makeRecord(w.api, visitType, data, {
      findings: [
        { what: 'Crack in wall', qty: '2', other_site: niwai.code, _refs: { other_site: `rt:${niwai.id}` } },
        {},
        { what: 'Loose wiring', other_site: tonk.code, _refs: { other_site: `rt:${tonk.id}` } },
      ],
    });
    const read = async () => (await w.api.get(`/api/records/entries/${visit.id}`)).body.record;
    expect((await read()).lines).toEqual({
      findings: [
        { what: 'Crack in wall', qty: 2, other_site: niwai.code, _refs: { other_site: `rt:${niwai.id}` } },
        { what: 'Loose wiring', other_site: tonk.code, _refs: { other_site: `rt:${tonk.id}` } },
      ],
    });
    // Changing the fields alone keeps the lines; sending a table replaces it; an empty table empties it.
    const fields = await w.api.patch(`/api/records/entries/${visit.id}`, {
      data: { ...data, visit_on: '2026-12-01' },
    });
    expect(fields.body.changed).toEqual(['Visit on']);
    expect((await read()).lines.findings).toHaveLength(2);
    const one = await w.api.patch(`/api/records/entries/${visit.id}`, {
      data: { ...data, visit_on: '2026-12-01' },
      lines: { findings: [{ what: 'Loose wiring', qty: 5 }] },
    });
    expect(one.body.changed).toEqual(['Findings']);
    expect((await read()).lines).toEqual({ findings: [{ what: 'Loose wiring', qty: 5 }] });
    expect(
      (
        await w.api.patch(`/api/records/entries/${visit.id}`, {
          data: { ...data, visit_on: '2026-12-01' },
          lines: { findings: [{ qty: 1 }] },
        })
      ).status,
    ).toBe(400);
    await w.api.patch(`/api/records/entries/${visit.id}`, { data, lines: { findings: [] } });
    const end = await read();
    expect(end.lines).toEqual({ findings: [] });
    expect(end.data.visit_on).toBeUndefined();
    // Nothing changed: nothing written.
    expect((await w.api.patch(`/api/records/entries/${visit.id}`, { data })).body.changed).toEqual([]);
    const history = (await w.api.get(`/api/records/entries/${visit.id}`)).body.events;
    expect(history.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'changed',
      'changed',
      'changed',
    ]);
    // A table with lines can't be dropped from the type; an empty one can.
    const def = (await w.api.get(`/api/records/types/${visitType}`)).body.definition;
    await w.api.patch(`/api/records/entries/${visit.id}`, {
      data,
      lines: { findings: [{ what: 'Back again' }] },
    });
    const drop = await w.api.patch(`/api/records/types/${visitType}`, { definition: { ...def, tables: [] } });
    expect(drop.status).toBe(409);
    expect(drop.body.error.message).toBe(
      'The table "Findings" has lines in 1 site visit: it can\'t be removed',
    );
  });
});
