import { withReachOf } from '@mono/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { sweepChecklists } from '../checklist/jobs';
import { publish, start, task } from '../forms/test-kit';
import { queueWebhooks } from '../platform/webhooks';
import { makeRecord, makeType, siteVisit, world } from '../records/testkit';
import { planSql } from '../ai/ask';
import { reachOfUser } from './reach';
import { give, group, ok, reachOf, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** Two outlets with a "my branches" manager each (HODs who may otherwise see every process and record). */
async function twoOutlets(w: World) {
  const g = await group(w);
  const hod = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('HOD') } });
  await ok(
    w.api.patch(`/api/org/roles/${hod.id}`, {
      permissions: [
        ...new Set([...hod.permissions, 'fms.admin', 'records.admin', 'reports.admin', 'core.admin']),
      ],
    }),
  );
  await reachOf(w, 'HOD', 'branches');
  const rooftop = await g.at('Farah Rooftop', g.b.rooftop.id, 'HOD');
  const lake = await g.at('Leela Lake', g.b.lake.id, 'HOD');
  return { g, rooftop, lake };
}

describe('work carries its branch, and reach holds everywhere (phase 12, stage A)', () => {
  it('G13: each new piece of work belongs to the branch of the person it starts with', async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(w);
    const branchOf = async (table: string, id: string) =>
      (
        await ctx.prisma.$queryRawUnsafe<{ branch_id: string | null }[]>(
          `SELECT branch_id FROM ${table} WHERE id = $1`,
          id,
        )
      )[0]?.branch_id;

    // A process record: the starter's branch; a paper made on its step: the record's branch.
    await ok(w.api.put('/api/document-types', { code: 'GRN', name: 'Goods receipt', prefix: 'GRN' }));
    const flowId = await publish(w.api, 'Receiving', {
      startFields: [{ key: 'what', label: 'What', type: 'text', required: true }],
      steps: [{ ...task('check', w.owner.id), documents: ['GRN'] }],
    });
    const rec = (await start(rooftop.api, flowId, { what: 'Linen' })).body as { id: string };
    expect(await branchOf('fms_records', rec.id)).toBe(g.b.rooftop.id);
    const step = await ctx.prisma.fmsRecordStep.findFirstOrThrow({
      where: { recordId: rec.id, status: 'OPEN' },
    });
    await ok(w.api.post(`/api/fms/steps/${step.id}/complete`, { data: {} }));
    const paper = await ctx.prisma.document.findFirstOrThrow({ where: { recordId: rec.id } });
    expect(paper.branchId).toBe(g.b.rooftop.id);

    // A help ticket and a help slip: the raiser's branch.
    const ticket = await ok<{ id: string }>(
      lake.api.post('/api/tickets', {
        title: 'Fridge is warm',
        description: 'Cold room at 9°C',
        solverId: w.owner.id,
      }),
    );
    expect(await branchOf('tickets', ticket.id)).toBe(g.b.lake.id);
    const slip = await ok<{ id: string }>(
      lake.api.post('/api/slips', {
        problem: 'Guests wait too long for the bill',
        solutions: ['A second billing counter', 'Bills at the table', 'A runner at peak hours'],
      }),
    );
    expect(await branchOf('slips', slip.id)).toBe(g.b.lake.id);

    // A record of a record type (also when imported): the maker's branch.
    const typeId = await makeType(w.api);
    const visit = await makeRecord(rooftop.api, typeId, { site: 'Rooftop terrace' });
    expect(await branchOf('records', visit.id)).toBe(g.b.rooftop.id);
    await ok(
      lake.api.post(`/api/records/types/${typeId}/import`, {
        table: [['Site'], ['Lake deck'], ['Lake jetty']],
      }),
    );
    const imported = await ctx.prisma.recordEntry.findMany({
      where: { typeId, title: { startsWith: 'Lake' } },
    });
    expect(imported.map((r) => r.branchId)).toEqual([g.b.lake.id, g.b.lake.id]);
    // A checklist run: the branch of the person whose run it is.
    const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
    await ok(
      w.api.post('/api/checklists/masters', {
        name: 'Opening round',
        items: [{ key: 'a', text: 'Gas valves checked' }],
        frequency: { type: 'daily' },
        dueTime: '10:00',
        windowHours: 4,
        doerIds: [cook.id],
        startDate: '2030-01-01',
      }),
    );
    await sweepChecklists(ctx.prisma, new Date('2030-01-07T03:00:00Z'));
    const run = await ctx.prisma.checklistRun.findFirstOrThrow({
      where: { companyId: w.companyId, doerId: cook.id },
    });
    expect(run.branchId).toBe(g.b.rooftop.id);

    // A purchase order and a sales order: the maker's branch.
    const item = await ok<{ id: string }>(
      w.api.post('/api/ims/items', { code: 'OIL-1', name: 'Cooking oil', unit: 'L' }),
    );
    const po = await ok<{ id: string }>(
      lake.api.post('/api/ims/po', {
        vendor: 'Ajmer Traders',
        lines: [{ itemId: item.id, qty: 10, rate: '12000' }],
      }),
    );
    expect(await branchOf('purchase_orders', po.id)).toBe(g.b.lake.id);
    const customer = await ok<{ id: string }>(
      w.api.post('/api/crm/customers', { name: 'Delta Homes', creditDays: 15 }),
    );
    await ok(
      w.api.put('/api/crm/setup', {
        page: 'seats',
        patch: { seats: { owner: [w.owner.id], crm: [w.owner.id] } },
      }),
    );
    await ok(
      w.api.put('/api/crm/setup', {
        page: 'afterOrder',
        patch: {
          afterOrder: [
            {
              key: 'confirm',
              name: 'Confirm order',
              seat: 'crm',
              time: { value: 2, unit: 'hours', anchor: 'start' },
              documents: [],
              proof: false,
            },
          ],
        },
      }),
    );
    const order = await ok<{ id: string }>(
      rooftop.api.post('/api/crm/orders', { customerId: customer.id, amount: 5_000_00 }),
    );
    expect(await branchOf('sales_orders', order.id)).toBe(g.b.rooftop.id);

    // The owner has no home branch: what they make belongs to the whole group.
    const hq = await makeRecord(w.api, typeId, { site: 'Head office' });
    expect(await branchOf('records', hq.id)).toBeNull();
  });

  it('G5: process records, record lists, exports and reports show a manager only their own branches', async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(w);
    const flowId = await publish(w.api, 'Complaints', {
      startFields: [{ key: 'guest', label: 'Guest', type: 'text', required: true, reportable: true }],
      steps: [task('call', w.owner.id)],
    });
    await start(rooftop.api, flowId, { guest: 'Rooftop guest' });
    await start(lake.api, flowId, { guest: 'Lake guest one' });
    await start(lake.api, flowId, { guest: 'Lake guest two' });
    const live = async (api: World['api']) =>
      await ok<{ records: { title: string }[]; tiles: { running: number } }>(
        api.get(`/api/fms/live?flowId=${flowId}`),
      );
    expect((await live(w.api)).tiles.running).toBe(3);
    const mine = await live(rooftop.api);
    expect(mine.records.map((r) => r.title)).toEqual(['Rooftop guest']);
    expect(mine.tiles.running).toBe(1);
    expect((await live(lake.api)).records.map((r) => r.title).sort()).toEqual([
      'Lake guest one',
      'Lake guest two',
    ]);

    const base = siteVisit();
    const typeId = await makeType(w.api, {
      ...base,
      definition: {
        ...base.definition,
        fields: base.definition.fields.map((f) => ({ ...f, reportable: true })),
      },
    });
    await makeRecord(rooftop.api, typeId, { site: 'Rooftop terrace', cost: 100 });
    await makeRecord(lake.api, typeId, { site: 'Lake deck', cost: 250 });
    await makeRecord(lake.api, typeId, { site: 'Lake jetty', cost: 50 });
    const list = async (api: World['api']) =>
      await ok<{ total: number; rows: { title: string }[]; counts: Record<string, number> }>(
        api.get(`/api/records/types/${typeId}/records`),
      );
    expect((await list(w.api)).total).toBe(3);
    expect((await list(rooftop.api)).rows.map((r) => r.title)).toEqual(['Rooftop terrace']);
    expect((await list(lake.api)).counts.planned).toBe(2);
    // A record of another branch can't be opened by its id.
    const lakeDeck = await ctx.prisma.recordEntry.findFirstOrThrow({ where: { typeId, title: 'Lake deck' } });
    expect((await rooftop.api.get(`/api/records/entries/${lakeDeck.id}`)).status).toBe(404);
    expect((await lake.api.get(`/api/records/entries/${lakeDeck.id}`)).status).toBe(200);

    // The same report gives each reader their own numbers; the owner sees the group.
    const definition = {
      source: { kind: 'recordType', id: typeId },
      columns: [],
      filters: [],
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'cost' }],
      look: 'table',
    };
    const totals = async (api: World['api']) =>
      (await ok<{ totals: number[] }>(api.post('/api/reports/run', { definition }))).totals;
    expect(await totals(w.api)).toEqual([3, 400]);
    expect(await totals(rooftop.api)).toEqual([1, 100]);
    expect(await totals(lake.api)).toEqual([2, 300]);
    const flowReport = {
      source: { kind: 'flow', id: flowId },
      columns: ['guest'],
      filters: [],
      measures: [{ fn: 'count' }],
      look: 'table',
    };
    const guests = async (api: World['api']) =>
      (await ok<{ rows: string[][] }>(api.post('/api/reports/run', { definition: flowReport }))).rows
        .flat()
        .sort();
    expect(await guests(rooftop.api)).toEqual(['Rooftop guest']);
    expect(await guests(lake.api)).toEqual(['Lake guest one', 'Lake guest two']);
    void g;
  });

  it("G5: Ask answers from inside the asker's branches", async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(w);
    const cook = await g.at('Cook Rooftop', g.b.rooftop.id);
    const steward = await g.at('Steward Lake', g.b.lake.id);
    await give(w, cook.id, 'Clean the rooftop grill');
    await give(w, steward.id, 'Polish the lake cutlery');
    await give(w, w.owner.id, 'Sign the lease');
    const plan = {
      view: 'tasks',
      columns: ['task'],
      filters: [],
      groupBy: null,
      aggregate: null,
      orderBy: null,
      limit: 50,
    } as unknown as Parameters<typeof planSql>[0];
    const asked = async (userId: string | null) => {
      const reach = userId ? await reachOfUser(ctx.prisma, w.companyId, userId) : null;
      return withReachOf(reach, async () =>
        (await ctx.prisma.$queryRaw<{ task: string }[]>(planSql(plan, w.companyId, 'Asia/Kolkata', null).sql))
          .map((r) => r.task)
          .sort(),
      );
    };
    // The owner's own task has no branch (group-wide), so everyone's answer may include it.
    expect(await asked(null)).toEqual([
      'Clean the rooftop grill',
      'Polish the lake cutlery',
      'Sign the lease',
    ]);
    expect(await asked(rooftop.id)).toEqual(['Clean the rooftop grill', 'Sign the lease']);
    expect(await asked(lake.id)).toEqual(['Polish the lake cutlery', 'Sign the lease']);
  });

  it("G14: a step goes to its doer at the record's branch, then the region, and says so when it leaves", async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(w);
    const cookRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const cookGarden = await g.at('Cook Garden', g.b.garden.id);
    const cookLake = await g.at('Cook Lake', g.b.lake.id);
    const flowId = await publish(w.api, 'Kitchen complaint', {
      startFields: [{ key: 'what', label: 'What', type: 'text', required: true }],
      steps: [{ ...task('fix', cookRooftop.id), doerIds: [cookLake.id, cookRooftop.id] }],
    });
    const doerOf = async (api: World['api'], what: string) => {
      const rec = (await start(api, flowId, { what })).body as { id: string };
      const step = await ctx.prisma.fmsRecordStep.findFirstOrThrow({
        where: { recordId: rec.id, status: 'OPEN' },
      });
      const notes = await ctx.prisma.fmsRecordEvent.count({
        where: { recordId: rec.id, type: 'doer_outside_branch' },
      });
      return { doerId: step.doerId, notes };
    };
    // Each outlet's record goes to that outlet's cook, however busy the other one is.
    for (const n of [1, 2, 3])
      expect(await doerOf(rooftop.api, `Rooftop ${n}`)).toEqual({ doerId: cookRooftop.id, notes: 0 });
    expect(await doerOf(lake.api, 'Lake 1')).toEqual({ doerId: cookLake.id, notes: 0 });
    // The garden has no cook on this step: the same region's cook (Jaipur) gets it, and the record says so.
    const gardenMgr = await g.at('Gita Garden', g.b.garden.id, 'HOD');
    expect(await doerOf(gardenMgr.api, 'Garden 1')).toEqual({ doerId: cookRooftop.id, notes: 1 });
    // A record with no branch (the owner's) keeps the old rule: the least busy doer.
    expect((await doerOf(w.api, 'Head office')).doerId).toBe(cookLake.id);
    void cookGarden;
  });

  it('G15: one checklist template makes a run per branch, by its people, at its own time and clock', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(w);
    const cookRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const cookLake = await g.at('Cook Lake', g.b.lake.id);
    // The lake outlet runs on Dubai time for this test (a branch abroad).
    await ok(w.api.patch(`/api/org/branches/${g.b.lake.id}`, { name: 'Lake View', timezone: 'Asia/Dubai' }));
    const master = {
      name: 'Opening round',
      items: [{ key: 'a', text: 'Gas valves checked' }],
      frequency: { type: 'daily' },
      dueTime: '10:00',
      windowHours: 4,
      doerIds: [w.owner.id],
      startDate: '2030-01-01',
      perBranch: [
        { branchId: g.b.rooftop.id, doerIds: [cookRooftop.id] },
        { branchId: g.b.lake.id, doerIds: [cookLake.id], dueTime: '11:30' },
      ],
    };
    // A branch can't be listed twice, and must be one of the company's.
    const twice = { ...master, perBranch: [master.perBranch[0], master.perBranch[0]] };
    expect((await w.api.post('/api/checklists/masters', twice)).status).toBe(400);
    const made = await ok<{ id: string }>(w.api.post('/api/checklists/masters', master));
    await sweepChecklists(ctx.prisma, new Date('2030-01-07T03:00:00Z'), made.id);
    const runs = await ctx.prisma.checklistRun.findMany({
      where: { masterId: made.id },
      orderBy: { plannedAt: 'asc' },
    });
    // Rooftop: 10:00 in India. Lake: 11:30 in Dubai. Nobody else gets a run (not the template's own doer).
    expect(runs.map((r) => [r.branchId, r.doerId, r.plannedAt.toISOString()])).toEqual([
      [g.b.rooftop.id, cookRooftop.id, '2030-01-07T04:30:00.000Z'],
      [g.b.lake.id, cookLake.id, '2030-01-07T07:30:00.000Z'],
    ]);
  });

  it('G6: an API key and a webhook see as far as the person who made them', async () => {
    const w = await world(ctx.app);
    const { rooftop, lake } = await twoOutlets(w);
    const typeId = await makeType(w.api);
    await makeRecord(rooftop.api, typeId, { site: 'Rooftop terrace' });
    const atLake = await makeRecord(lake.api, typeId, { site: 'Lake deck' });
    const key = async (api: World['api']) =>
      (await ok<{ key: string }>(api.post('/api/platform/keys', { name: 'App' }))).key;
    const sites = async (k: string) =>
      (
        (
          await ctx.app.inject({
            method: 'GET',
            url: `/api/v1/record-types/${typeId}/records`,
            headers: { authorization: `Bearer ${k}` },
          })
        ).json().records as { title: string }[]
      )
        .map((r) => r.title)
        .sort();
    expect(await sites(await key(w.api))).toEqual(['Lake deck', 'Rooftop terrace']);
    expect(await sites(await key(rooftop.api))).toEqual(['Rooftop terrace']);

    // Two webhooks on record events: the owner's gets every branch's, the rooftop manager's only their own.
    const hook = async (api: World['api'], url: string) =>
      (await ok<{ id: string }>(api.post('/api/platform/webhooks', { url, events: ['record.*'] }))).id;
    const ownerHook = await hook(w.api, 'https://93.184.216.34/all');
    const rooftopHook = await hook(rooftop.api, 'https://93.184.216.34/rooftop');
    await ok(lake.api.post(`/api/records/entries/${atLake.id}/notes`, { note: 'Railing is loose' }));
    const events = await ctx.prisma.domainEvent.findMany({
      where: { companyId: w.companyId, name: 'record.note' },
    });
    for (const e of events) await queueWebhooks(ctx.prisma, e);
    const sent = await ctx.prisma.webhookDelivery.findMany({
      where: { companyId: w.companyId, event: 'record.note' },
    });
    expect(sent.map((d) => d.webhookId)).toEqual([ownerHook]);
    expect(sent.map((d) => d.webhookId)).not.toContain(rooftopHook);
  });
});
