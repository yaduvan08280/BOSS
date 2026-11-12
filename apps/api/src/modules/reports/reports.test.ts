import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asHeader, cookieHeader, makeApp, ORIGIN } from '../../test/helpers';
import { publish, start, task } from '../forms/test-kit';
import { makeRecord, makeType, siteVisit, world } from '../records/testkit';
import { dueOn, sendScheduledReports } from './schedule';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type World = Awaited<ReturnType<typeof world>>;
type Result = {
  grouped: boolean;
  columns: { key: string; label: string; kind: string }[];
  rows: (string | number | null)[][];
  totals: (number | null)[] | null;
  measures: string[];
  total: number;
  pending: string[];
};

/** Site visits with reportable site, date, cost and kind; six visits over three months. */
async function visits(w: World) {
  const base = siteVisit();
  const typeId = await makeType(w.api, {
    ...base,
    definition: {
      ...base.definition,
      fields: base.definition.fields.map((f) => (f.key === 'urgent' ? f : { ...f, reportable: true })),
    },
  });
  const rows: [string, string, number, string][] = [
    ['Tonk mine', '2026-10-05', 1000, 'Survey'],
    ['Tonk mine', '2026-10-20', 2500, 'Repair'],
    ['Niwai factory', '2026-11-02', 4000, 'Repair'],
    ['Kishangarh plant', '2026-11-18', 1500.5, 'Survey'],
    ['Niwai factory', '2026-11-30', 300, 'Survey'],
    ['Tonk mine', '2027-01-09', 700, 'Survey'],
  ];
  const made = [];
  for (const [site, visit_on, cost, kind] of rows)
    made.push(await makeRecord(w.api, typeId, { site, visit_on, cost, kind }));
  return { typeId, made };
}
const report = (typeId: string, over: Record<string, unknown> = {}) => ({
  source: { kind: 'recordType', id: typeId },
  columns: [],
  filters: [],
  measures: [{ fn: 'count' }],
  look: 'table',
  ...over,
});
const run = async (api: World['api'], definition: object) => {
  const r = await api.post('/api/reports/run', { definition });
  if (r.status !== 200) throw new Error(`run failed: ${JSON.stringify(r.body)}`);
  return r.body as Result;
};

describe('the report builder (plan §2.7)', () => {
  it('U10: "Site visits" grouped by month with a count and a total; quarters and years follow the financial year', async () => {
    const w = await world(ctx.app);
    const { typeId } = await visits(w);
    const fields = (await w.api.get(`/api/reports/fields?source=recordType:${typeId}`)).body.fields as {
      key: string;
      kind: string;
      builtin: boolean;
      ready: boolean;
    }[];
    expect(fields.map((f) => [f.key, f.kind, f.builtin, f.ready])).toEqual([
      ['code', 'text', true, true],
      ['title', 'text', true, true],
      ['status', 'text', true, true],
      ['created', 'date', true, true],
      ['by', 'text', true, true],
      ['site', 'text', false, true],
      ['visit_on', 'date', false, true],
      ['cost', 'number', false, true],
      ['kind', 'text', false, true],
    ]);
    const byMonth = await run(
      w.api,
      report(typeId, {
        groupBy: { field: 'visit_on', bucket: 'month' },
        measures: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }, { fn: 'avg', field: 'cost' }],
        look: 'bar',
      }),
    );
    expect(byMonth.columns.map((c) => c.label)).toEqual(['Visit on', 'Count', 'Total Cost', 'Average Cost']);
    expect(byMonth.rows).toEqual([
      ['Oct 2026', 2, 3500, 1750],
      ['Nov 2026', 3, 5800.5, 1933.5],
      ['Jan 2027', 1, 700, 700],
    ]);
    expect(byMonth.totals).toEqual([6, 10000.5, 1666.75]);
    expect(byMonth.total).toBe(6);
    const by = async (bucket: string) =>
      (await run(w.api, report(typeId, { groupBy: { field: 'visit_on', bucket } }))).rows;
    expect(await by('quarter')).toEqual([
      ['Q3 26-27', 5],
      ['Q4 26-27', 1],
    ]);
    expect(await by('fy')).toEqual([['FY 26-27', 6]]);
    expect((await by('week'))[0]).toEqual(['Week of 05/10/2026', 1]);
    expect((await by('day')).length).toBe(6);

    // By a text field: one row per value whatever the capitals, biggest first; or sorted the way the person asks.
    const bySite = await run(
      w.api,
      report(typeId, {
        groupBy: { field: 'site' },
        measures: [{ fn: 'count' }, { fn: 'max', field: 'cost' }],
      }),
    );
    expect(bySite.rows).toEqual([
      ['Tonk mine', 3, 2500],
      ['Niwai factory', 2, 4000],
      ['Kishangarh plant', 1, 1500.5],
    ]);
    const sorted = await run(
      w.api,
      report(typeId, {
        groupBy: { field: 'site' },
        measures: [{ fn: 'count' }, { fn: 'max', field: 'cost' }],
        sort: { by: 'm1', dir: 'desc' },
        limit: 2,
      }),
    );
    expect(sorted.rows.map((r) => r[0])).toEqual(['Niwai factory', 'Tonk mine']);
  });

  it('U10: a plain list with columns, filters, a sort and totals; statuses read as their labels', async () => {
    const w = await world(ctx.app);
    const { typeId, made } = await visits(w);
    await w.api.post(`/api/records/entries/${made[2]!.id}/move`, { action: 'visit' });
    const list = await run(
      w.api,
      report(typeId, {
        columns: ['code', 'site', 'visit_on', 'cost', 'status'],
        filters: [
          { field: 'visit_on', op: 'between', value: '2026-10-15', value2: '2026-11-30' },
          { field: 'cost', op: 'gte', value: '1000' },
          { field: 'site', op: 'contains', value: 'N' }, // "Tonk miNe", "Niwai", "KishaNgarh"
        ],
        measures: [{ fn: 'sum', field: 'cost' }],
        sort: { by: 'cost', dir: 'desc' },
      }),
    );
    expect(list.grouped).toBe(false);
    expect(list.rows).toEqual([
      [made[2]!.code, 'Niwai factory', '02/11/2026', 4000, 'Visited'],
      [made[1]!.code, 'Tonk mine', '20/10/2026', 2500, 'Planned'],
      [made[3]!.code, 'Kishangarh plant', '18/11/2026', 1500.5, 'Planned'],
    ]);
    expect(list.totals).toEqual([8000.5]);
    expect(list.total).toBe(3);
    const eq = async (filters: object[]) => (await run(w.api, report(typeId, { filters }))).total;
    expect(await eq([{ field: 'site', op: 'eq', value: '  TONK  mine ' }])).toBe(3);
    expect(await eq([{ field: 'status', op: 'eq', value: 'visited' }])).toBe(1);
    expect(
      await eq([
        { field: 'kind', op: 'eq', value: 'Repair' },
        { field: 'cost', op: 'lte', value: '2500' },
      ]),
    ).toBe(1);
    expect(await eq([{ field: 'visit_on', op: 'eq', value: '2027-01-09' }])).toBe(1);
    expect(await eq([{ field: 'created', op: 'this_fy' }])).toBe(6);
    expect(await eq([{ field: 'created', op: 'last_days', value: '1' }])).toBe(6);
    expect(await eq([{ field: 'kind', op: 'empty' }])).toBe(0);
    // A deleted record leaves every report.
    await w.api.del(`/api/records/entries/${made[0]!.id}`);
    expect(await eq([])).toBe(5);
  });

  it('U10: a process report — filtered by a date range and a linked customer', async () => {
    const w = await world(ctx.app);
    const sharma = (await w.api.post('/api/crm/customers', { name: 'Sharma Traders', city: 'Ajmer' })).body;
    const mehta = (await w.api.post('/api/crm/customers', { name: 'Mehta Interiors', city: 'Jaipur' })).body;
    const flowId = await publish(w.api, 'Orders', {
      startFields: [
        { key: 'customer', label: 'Customer', type: 'master', master: 'customers', reportable: true },
        { key: 'value', label: 'Value', type: 'amount', reportable: true },
        { key: 'due', label: 'Due', type: 'date', reportable: true },
        { key: 'remark', label: 'Remark', type: 'text' },
      ],
      steps: [task('pack', w.owner.id)],
    });
    const order = (c: { id: string; name: string }, value: number, due: string) =>
      start(w.api, flowId, { customer: c.name, value, due, _refs: { customer: `customer:${c.id}` } });
    await order(sharma, 45000, '2026-12-01');
    await order(sharma, 12000, '2026-12-20');
    await order(mehta, 30000, '2026-12-10');
    const cancelled = (await order(mehta, 99999, '2026-12-11')).body as { id: string };
    await w.api.post(`/api/fms/records/${cancelled.id}/actions`, { action: 'cancel', reason: 'test' });
    const def = (over: object) => ({
      source: { kind: 'flow', id: flowId },
      columns: [],
      filters: [],
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'value' }],
      look: 'table',
      ...over,
    });
    const byCustomer = await run(w.api, def({ groupBy: { field: 'customer' } }));
    expect(byCustomer.rows).toEqual([
      ['Sharma Traders', 2, 57000],
      ['Mehta Interiors', 1, 30000], // the cancelled order is not counted
    ]);
    const filtered = await run(
      w.api,
      def({
        columns: ['number', 'customer', 'due', 'value', 'status', 'by'],
        filters: [
          { field: 'due', op: 'between', value: '2026-12-01', value2: '2026-12-15' },
          { field: 'customer', op: 'eq', value: 'sharma traders' },
        ],
      }),
    );
    expect(filtered.rows).toEqual([[1, 'Sharma Traders', '01/12/2026', 45000, 'Running', 'Test Owner']]);
    expect(filtered.totals).toEqual([1, 45000]);
    // A field that is not marked reportable can't be used — the answer says so.
    const bad = await w.api.post('/api/reports/run', { definition: def({ columns: ['remark'] }) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toBe('The column "remark" is not a reportable field of this source');
  });

  it('U10: hostile names and operators are refused; another company gets nothing', async () => {
    const w = await world(ctx.app);
    const { typeId } = await visits(w);
    const tryRun = (definition: object) => w.api.post('/api/reports/run', { definition });
    for (const definition of [
      report(typeId, { columns: ['site"; DROP TABLE records; --'] }),
      report(typeId, { filters: [{ field: 'site', op: 'eq; DELETE', value: 'x' }] }),
      report(typeId, { groupBy: { field: 'site', bucket: "month'); DROP TABLE users; --" } }),
      report(typeId, { sort: { by: 'site', dir: 'asc; DROP' } }),
      report(typeId, { measures: [{ fn: 'sum', field: 'site' }] }), // not a number
      report(typeId, { groupBy: { field: 'site', bucket: 'month' } }), // not a date
      report(typeId, { filters: [{ field: 'cost', op: 'gte', value: '1 OR 1=1' }] }),
      report(typeId, { filters: [{ field: 'visit_on', op: 'eq', value: "2026-01-01'::date OR TRUE --" }] }),
      report(typeId, { look: 'bar' }), // a chart with nothing to draw
      { ...report(typeId), extra: 'x' },
    ])
      expect((await tryRun(definition)).status, JSON.stringify(definition)).toBe(400);
    // A value is only ever a value: this finds nothing and breaks nothing.
    const odd = await run(
      w.api,
      report(typeId, { filters: [{ field: 'site', op: 'eq', value: "x' OR '1'='1" }] }),
    );
    expect(odd.total).toBe(0);
    expect(await ctx.prisma.recordEntry.count({ where: { typeId } })).toBe(6);

    const other = await world(ctx.app);
    expect((await other.api.post('/api/reports/run', { definition: report(typeId) })).status).toBe(404);
    expect((await other.api.get(`/api/reports/fields?source=recordType:${typeId}`)).status).toBe(404);
    expect((await other.api.get('/api/reports/sources')).body).toEqual([]);
    // A member the type does not let in can't read it through a report either.
    await w.api.patch(`/api/records/types/${typeId}`, {
      permissions: { view: [w.role('HOD')], create: [w.role('HOD')], edit: [w.role('HOD')], approve: [] },
    });
    const gopal = await w.person('Gopal Prajapat');
    expect((await gopal.api.post('/api/reports/run', { definition: report(typeId) })).status).toBe(403);
  });

  it('U10: reports are saved, shared by role, exported as real Excel / PDF / CSV, and deleted by their maker', async () => {
    const w = await world(ctx.app);
    const { typeId } = await visits(w);
    const hod = await w.person('Mahesh Yadav', 'HOD');
    const member = await w.person('Gopal Prajapat');
    const definition = report(typeId, {
      groupBy: { field: 'visit_on', bucket: 'month' },
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }],
      look: 'bar',
    });
    // A member may open reports but not make them; a HOD makes one.
    expect((await member.api.post('/api/reports', { name: 'Mine', definition })).status).toBe(403);
    const made = await hod.api.post('/api/reports', { name: 'Visits by month', definition });
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    // Nobody else sees it until it is shared with their role (the owner looks after all reports).
    expect((await member.api.get('/api/reports')).body.reports).toEqual([]);
    expect((await member.api.get(`/api/reports/${id}/run`)).status).toBe(404);
    expect((await w.api.get('/api/reports')).body.reports.map((r: { name: string }) => r.name)).toEqual([
      'Visits by month',
    ]);
    expect(
      (
        await hod.api.put(`/api/reports/${id}`, {
          name: 'Visits by month',
          definition,
          sharedRoles: ['nope'],
        })
      ).status,
    ).toBe(400);
    await hod.api.put(`/api/reports/${id}`, {
      name: 'Visits by month',
      definition,
      sharedRoles: [w.role('MEMBER')],
    });
    const seen = (await member.api.get('/api/reports')).body.reports[0];
    expect(seen).toMatchObject({
      name: 'Visits by month',
      mine: false,
      canEdit: false,
      owner: 'Mahesh Yadav',
    });
    const ran = (await member.api.get(`/api/reports/${id}/run`)).body;
    expect(ran.result.rows[1]).toEqual(['Nov 2026', 3, 5800.5]);
    // Shared is view-only: the member can't change or delete it.
    expect((await member.api.put(`/api/reports/${id}`, { name: 'Hacked', definition })).status).toBe(403);
    expect((await member.api.del(`/api/reports/${id}`)).status).toBe(403);

    // A download as the browser gets it (the test client only reads JSON); the owner may open every report.
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: ORIGIN },
      payload: { identifier: w.mobile, password: w.password },
    });
    const file = (format: string) =>
      ctx.app.inject({
        method: 'GET',
        url: `/api/reports/${id}/export?format=${format}`,
        headers: { cookie: asHeader(cookieHeader(login)) },
      });
    const xlsx = await file('xlsx');
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK'); // a real zip
    expect(xlsx.headers['content-disposition']).toBe('attachment; filename="Visits-by-month.xlsx"');
    const pdf = await file('pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const csv = (await file('csv')).payload;
    // Every cell is quoted, as in the other exports.
    expect(
      csv
        .replace(/^\uFEFF/, '')
        .trim()
        .split(/\r?\n/)
        .map((line) => line.replace(/"/g, '')),
    ).toEqual([
      'Visit on,Count,Total Cost',
      'Oct 2026,2,3500',
      'Nov 2026,3,5800.5',
      'Jan 2027,1,700',
      'Total,6,10000.5',
    ]);

    expect((await hod.api.del(`/api/reports/${id}`)).status).toBe(200);
    expect((await w.api.get('/api/reports')).body.reports).toEqual([]);
    expect(await ctx.prisma.report.count({ where: { id, deletedAt: { not: null } } })).toBe(1); // kept as history
  });

  it('U10: a scheduled report is sent once per slot to the people chosen, with its numbers and a link', async () => {
    const w = await world(ctx.app);
    const { typeId } = await visits(w);
    const hod = await w.person('Mahesh Yadav', 'HOD');
    const definition = report(typeId, {
      groupBy: { field: 'site' },
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }],
    });
    // Recipients must be people of this company.
    const bad = await w.api.post('/api/reports', {
      name: 'Visits by site',
      definition,
      schedule: { every: 'day', at: 9 * 60, userIds: ['nobody'] },
    });
    expect(bad.status).toBe(400);
    const made = await w.api.post('/api/reports', {
      name: 'Visits by site',
      definition,
      schedule: { every: 'day', at: 9 * 60, userIds: [hod.id, w.owner.id] },
    });
    expect(made.status).toBe(200);
    const id = made.body.id as string;
    const events = () =>
      ctx.prisma.domainEvent.findMany({
        where: { companyId: w.companyId, name: 'report.scheduled' },
        orderBy: { occurredAt: 'asc' },
      });
    // 08:59 in Kolkata: not yet. 09:00: sent to both. A minute later, and all day: not again.
    await sendScheduledReports(ctx.prisma, new Date('2026-12-14T03:29:00.000Z'));
    expect(await events()).toHaveLength(0);
    await sendScheduledReports(ctx.prisma, new Date('2026-12-14T03:30:00.000Z'));
    await sendScheduledReports(ctx.prisma, new Date('2026-12-14T03:31:00.000Z'));
    await sendScheduledReports(ctx.prisma, new Date('2026-12-14T12:00:00.000Z'));
    const sent = await events();
    expect(sent.map((e) => (e.payload as { userId: string }).userId).sort()).toEqual(
      [hod.id, w.owner.id].sort(),
    );
    expect(sent[0]!.payload).toMatchObject({
      report: 'Visits by site',
      link: `/reports/${id}`,
      summary:
        'Count: 6 · Total Cost: 10,000.5. Tonk mine: 3 / 4,200; Niwai factory: 2 / 4,300; Kishangarh plant: 1 / 1,500.5',
    });
    // The next day it goes again; taking the schedule off stops it.
    await sendScheduledReports(ctx.prisma, new Date('2026-12-15T03:30:00.000Z'));
    expect(await events()).toHaveLength(4);
    await w.api.put(`/api/reports/${id}`, { name: 'Visits by site', definition, schedule: null });
    await sendScheduledReports(ctx.prisma, new Date('2026-12-16T03:30:00.000Z'));
    expect(await events()).toHaveLength(4);

    // Weekly and monthly slots.
    const weekly = { every: 'week' as const, at: 600, on: 1, userIds: ['x'] }; // Mondays 10:00
    expect(dueOn(weekly, '2026-12-14', 600)).toBe(true); // a Monday
    expect(dueOn(weekly, '2026-12-14', 599)).toBe(false);
    expect(dueOn(weekly, '2026-12-15', 700)).toBe(false);
    const monthly = { every: 'month' as const, at: 0, on: 5, userIds: ['x'] };
    expect(dueOn(monthly, '2026-12-05', 1)).toBe(true);
    expect(dueOn(monthly, '2026-12-06', 1)).toBe(false);

    // A report that can't run any more is told to its maker once, not sent to the others.
    const second = await w.api.post('/api/reports', {
      name: 'Broken',
      definition,
      schedule: { every: 'day', at: 0, userIds: [hod.id] },
    });
    await ctx.prisma.recordType.update({ where: { id: typeId }, data: { deletedAt: new Date() } });
    await sendScheduledReports(ctx.prisma, new Date('2026-12-20T03:30:00.000Z'));
    const broken = (await events()).filter((e) => e.entityId === second.body.id);
    expect(broken).toHaveLength(1);
    expect(broken[0]!.payload).toMatchObject({ userId: w.owner.id });
    expect((broken[0]!.payload as { summary: string }).summary).toContain('could not be sent');
  });
});
