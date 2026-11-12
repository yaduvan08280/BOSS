import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { sweepChecklists } from '../checklist/jobs';
import { publish, start, task } from '../forms/test-kit';
import { world } from '../records/testkit';
import { give, ok, twoOutlets, type World } from './testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('processes, checklists and the flow designer per branch (phase 12, stage A)', () => {
  it("G14: a step goes to its doer at the record's branch, then the region, and says so when it leaves", async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(ctx.prisma, w);
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
    const { g } = await twoOutlets(ctx.prisma, w);
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

  it('G16: a branch can have its own slip receiver, ticket coordinator and verifier', async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(ctx.prisma, w);
    const groupReceiver = await w.person('Group Receiver');
    const lakeReceiver = await g.at('Lake Receiver', g.b.lake.id);
    await ok(w.api.put('/api/work/settings/slip', { receiverUserId: groupReceiver.id }));
    await ok(w.api.put('/api/work/settings/ticket', { coordinatorUserId: groupReceiver.id }));
    const forLake = (module: string, people: object) =>
      w.api.put(`/api/work/settings/${module}/branches/${g.b.lake.id}`, people);
    // Only people can differ by branch — never a rule or a time; and only the company's admins set them.
    expect((await forLake('slip', { solutionsRequired: '1' })).status).toBe(400);
    const waiter = await g.at('Lake Waiter', g.b.lake.id);
    expect((await waiter.api.put(`/api/work/settings/slip/branches/${g.b.lake.id}`, {})).status).toBe(403);
    await ok(forLake('slip', { receiverUserId: lakeReceiver.id }));
    await ok(forLake('ticket', { coordinatorUserId: lakeReceiver.id }));
    const slipFrom = async (api: World['api']) => {
      const slip = await ok<{ id: string }>(
        api.post('/api/slips', {
          problem: 'Guests wait too long for the bill',
          solutions: ['A second billing counter', 'Bills at the table', 'A runner at peak hours'],
        }),
      );
      return (await ctx.prisma.slip.findUniqueOrThrow({ where: { id: slip.id } })).receiverId;
    };
    expect(await slipFrom(lake.api)).toBe(lakeReceiver.id);
    expect(await slipFrom(rooftop.api)).toBe(groupReceiver.id);
    const ticketFrom = async (api: World['api']) =>
      (
        await ok<{ coordinatorId: string }>(
          api.post('/api/tickets', {
            title: 'Fridge is warm',
            description: 'Cold room',
            solverId: w.owner.id,
          }),
        )
      ).coordinatorId;
    expect(await ticketFrom(lake.api)).toBe(lakeReceiver.id);
    expect(await ticketFrom(rooftop.api)).toBe(groupReceiver.id);
    // Clearing the branch's own people puts the company's back.
    await ok(forLake('slip', { receiverUserId: null }));
    expect(await slipFrom(lake.api)).toBe(groupReceiver.id);
    expect(await ok<unknown[]>(w.api.get('/api/work/settings/slip/branches'))).toEqual([]);
  });
  it('G17: stage counts and the weekly MIS stay inside the branch being looked at', async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(ctx.prisma, w);
    const cookRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const cookLake = await g.at('Cook Lake', g.b.lake.id);
    const flowId = await publish(w.api, 'Kitchen complaint', {
      startFields: [{ key: 'what', label: 'What', type: 'text', required: true }],
      steps: [{ ...task('fix', cookRooftop.id), doerIds: [cookLake.id, cookRooftop.id] }],
    });
    await start(rooftop.api, flowId, { what: 'Rooftop 1' });
    await start(lake.api, flowId, { what: 'Lake 1' });
    await start(lake.api, flowId, { what: 'Lake 2' });
    type Live = { stages: { count: number }[]; records: unknown[] };
    const live = (api: World['api'], only?: string) =>
      ok<Live>(api.get(`/api/fms/live?flowId=${flowId}`, only ? { 'x-mono-branch': only } : undefined));
    expect((await live(w.api)).stages[0]!.count).toBe(3);
    expect((await live(rooftop.api)).stages[0]!.count).toBe(1);
    expect((await live(w.api, g.b.lake.id)).stages[0]!.count).toBe(2);
    expect((await live(w.api, `r:${g.jaipur.id}`)).stages[0]!.count).toBe(1);
    // The weekly MIS lists the people of the branch being looked at.
    const mis = async (only?: string) =>
      (
        await ok<{ rows: { name: string }[] }>(
          w.api.get('/api/mis', only ? { 'x-mono-branch': only } : undefined),
        )
      ).rows.map((p) => p.name);
    expect(await mis()).toEqual(expect.arrayContaining(['Cook Rooftop', 'Cook Lake']));
    const atLake = await mis(g.b.lake.id);
    expect(atLake).toContain('Cook Lake');
    expect(atLake).not.toContain('Cook Rooftop');
  });
  it('G18: outlets are compared and ranked on attendance, checklist misses, ticket times and on-time work', async () => {
    const w = await world(ctx.app);
    const { g, rooftop, lake } = await twoOutlets(ctx.prisma, w);
    const cookRooftop = await g.at('Cook Rooftop', g.b.rooftop.id);
    const cookLake = await g.at('Cook Lake', g.b.lake.id);
    const companyId = w.companyId;
    const day = (n: number) => new Date(Date.UTC(2030, 0, n, 6));
    // Attendance: the rooftop cook worked 3 of 4 days, the lake cook 1 of 4.
    const mark = (userId: string, statuses: string[]) =>
      ctx.prisma.attendanceDay.createMany({
        data: statuses.map((status, i) => ({ companyId, userId, date: `2030-01-0${i + 1}`, status })),
      });
    await mark(cookRooftop.id, ['PRESENT', 'LATE', 'PRESENT', 'ABSENT']);
    await mark(cookLake.id, ['ABSENT', 'ABSENT', 'PRESENT', 'ABSENT']);
    // Tasks: rooftop on time, lake late.
    const task_ = async (doerId: string, n: number, late: boolean) => {
      const made = await give(w, doerId, `Task ${n}`);
      await ctx.prisma.task.update({
        where: { id: made.id },
        data: { status: 'DONE', plannedAt: day(3), doneAt: late ? day(5) : day(2) },
      });
    };
    await task_(cookRooftop.id, 1, false);
    await task_(cookLake.id, 2, true);
    type Row = {
      name: string;
      rank: number | null;
      attendance: number | null;
      onTime: number | null;
      score: number | null;
    };
    const rows = async (api: World['api']) =>
      (await ok<{ rows: Row[] }>(api.get('/api/branches/compare?from=2030-01-01&to=2030-01-08'))).rows;
    const all = await rows(w.api);
    expect(all.find((r) => r.name === 'Rooftop Jaipur')).toMatchObject({
      rank: 1,
      attendance: 75,
      onTime: 100,
      score: 88,
    });
    expect(all.find((r) => r.name === 'Lake View Ajmer')).toMatchObject({
      rank: 2,
      attendance: 25,
      onTime: 0,
      score: 13,
    });
    // Branches with nothing to grade are listed last, unranked.
    expect(all.at(-1)).toMatchObject({ rank: null, score: null });
    // A manager sees only their own branches in the comparison.
    expect((await rows(rooftop.api)).map((r) => r.name)).toEqual(['Rooftop Jaipur']);
    expect((await rows(lake.api)).map((r) => r.name)).toEqual(['Lake View Ajmer']);
  });
  it('G19: the header cards and the health check are about the branch being looked at', async () => {
    const w = await world(ctx.app);
    const { g } = await twoOutlets(ctx.prisma, w);
    await g.at('Cook Rooftop', g.b.rooftop.id);
    type Summary = {
      company: { people: number };
      counts: { users: number; branches: number };
      health: { gaps: { key: string; count: number }[] };
    };
    const summary = (only?: string) =>
      ok<Summary>(w.api.get('/api/system/summary', only ? { 'x-mono-branch': only } : undefined));
    const all = await summary();
    // The owner, two outlet managers and the cook; four branches, none with a manager yet.
    expect(all.company.people).toBe(4);
    expect(all.counts.branches).toBe(4);
    expect(all.health.gaps.find((x) => x.key === 'branchesWithoutManager')?.count).toBe(4);
    const rooftop = await summary(g.b.rooftop.id);
    expect(rooftop.company.people).toBe(2);
    expect(rooftop.counts).toMatchObject({ users: 2, branches: 1 });
    expect(rooftop.health.gaps.find((x) => x.key === 'branchesWithoutManager')?.count).toBe(1);
    // A manager set for the rooftop clears that gap there.
    const boss = await g.at('Farah Boss', g.b.rooftop.id);
    await ok(
      w.api.put('/api/branches/managers', { branchId: g.b.rooftop.id, role: 'MANAGER', userIds: [boss.id] }),
    );
    expect((await summary(g.b.rooftop.id)).health.gaps.some((x) => x.key === 'branchesWithoutManager')).toBe(
      false,
    );
  });
});
