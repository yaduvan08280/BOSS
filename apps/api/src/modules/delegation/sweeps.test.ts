import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { counting, makeApp, ownerClient } from '../../test/helpers';
import { flagOverdueTasks, remindUnaccepted } from './jobs';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

/**
 * The five-minute sweeps on a company with years of work behind it: a task that was reminded, or told it is
 * late today, must not be read again on every pass (on 31,000 waiting tasks that cost 40 s of CPU a pass).
 */
describe('delegation sweeps ask only for tasks that still need a message', () => {
  it('reminds a waiting task once per assignment and does not look at it again', async () => {
    const o = await ownerClient(ctx.app);
    const doer = (await o.api.post('/api/org/users', { name: 'Waiting Doer', mobile: rnd() })).body.person;
    const mine = { companyId: o.company.id };
    for (const description of ['Waiting A', 'Waiting B', 'Waiting C'])
      expect(
        (
          await o.api.post('/api/tasks', {
            doerId: doer.id,
            plannedAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
            description,
          })
        ).status,
      ).toBe(200);
    expect(await ctx.prisma.task.count({ where: { ...mine, status: 'AWAITING_ACCEPTANCE' } })).toBe(3);

    // Just given: inside the 30 minutes, nobody is reminded.
    await remindUnaccepted(ctx.prisma);
    expect(await ctx.prisma.taskEvent.count({ where: { ...mine, type: 'accept_reminder' } })).toBe(0);

    // Two were given an hour ago: each is reminded once.
    const [a, b, c] = await ctx.prisma.task.findMany({ where: mine, orderBy: { description: 'asc' } });
    for (const t of [a!, b!]) {
      await ctx.prisma.task.update({ where: { id: t.id }, data: { createdAt: ago(60) } });
      await ctx.prisma.taskEvent.updateMany({ where: { taskId: t.id }, data: { createdAt: ago(60) } });
    }
    await remindUnaccepted(ctx.prisma);
    const reminded = () =>
      ctx.prisma.taskEvent
        .findMany({ where: { ...mine, type: 'accept_reminder' }, select: { taskId: true } })
        .then((r) => r.map((e) => e.taskId).sort());
    expect(await reminded()).toEqual([a!.id, b!.id].sort());

    // The next pass finds nothing to do, and reads no task and no task event to find that out.
    const watch = counting(ctx.prisma);
    await remindUnaccepted(watch.db);
    expect(await reminded()).toEqual([a!.id, b!.id].sort());
    expect(watch.seen.calls.filter((call) => call.startsWith('taskEvent.'))).toEqual([]);
    expect(watch.seen.calls).not.toContain('task.findMany');

    // Passed on to somebody else forty minutes ago: a new assignment, so one more reminder — for that task only.
    // (its first reminder went out before that)
    await ctx.prisma.taskEvent.updateMany({
      where: { taskId: a!.id, type: 'accept_reminder' },
      data: { createdAt: ago(50) },
    });
    await ctx.prisma.taskEvent.create({
      data: { ...mine, taskId: a!.id, type: 'status', toStatus: 'AWAITING_ACCEPTANCE', createdAt: ago(40) },
    });
    await remindUnaccepted(ctx.prisma);
    expect(await reminded()).toEqual([a!.id, a!.id, b!.id].sort());
    expect(await ctx.prisma.taskEvent.count({ where: { taskId: c!.id, type: 'accept_reminder' } })).toBe(0);
  });

  it('a late task already told today is not read again; tomorrow it is told once more', async () => {
    const o = await ownerClient(ctx.app);
    const doer = (await o.api.post('/api/org/users', { name: 'Late Doer', mobile: rnd() })).body.person;
    const made = await o.api.post('/api/tasks', {
      doerId: doer.id,
      plannedAt: new Date(Date.now() + 3_600_000).toISOString(),
      description: 'Late and told',
    });
    await ctx.prisma.task.update({ where: { id: made.body.id }, data: { plannedAt: ago(120) } });
    const told = () =>
      ctx.prisma.domainEvent.count({ where: { name: 'delegation.overdue', entityId: made.body.id } });
    const now = new Date();
    await flagOverdueTasks(ctx.prisma, now);
    expect(await told()).toBe(1);

    const watch = counting(ctx.prisma);
    await flagOverdueTasks(watch.db, now);
    expect(await told()).toBe(1);
    // Companies are listed (one read); not one task row comes back for any of them.
    const companies = await ctx.prisma.company.count({ where: { deletedAt: null } });
    expect(watch.seen.rows).toBe(companies);

    await flagOverdueTasks(ctx.prisma, new Date(now.getTime() + 24 * 3_600_000));
    expect(await told()).toBe(2);
  });
  it('the daily "still late" round is spread over passes; a task that has just become late never waits', async () => {
    const o = await ownerClient(ctx.app);
    const doer = (await o.api.post('/api/org/users', { name: 'Many Late', mobile: rnd() })).body.person;
    const ids: string[] = [];
    for (const description of ['Old late 1', 'Old late 2', 'Old late 3', 'Just late']) {
      const made = await o.api.post('/api/tasks', {
        doerId: doer.id,
        plannedAt: new Date(Date.now() + 3_600_000).toISOString(),
        description,
      });
      ids.push(made.body.id);
    }
    const yesterday = ago(26 * 60);
    await ctx.prisma.task.updateMany({ where: { id: { in: ids } }, data: { plannedAt: ago(48 * 60) } });
    await ctx.prisma.task.updateMany({
      where: { id: { in: ids.slice(0, 3) } },
      data: { lastOverdueNotifiedAt: yesterday },
    });
    const told = async () =>
      (
        await ctx.prisma.domainEvent.findMany({
          where: { companyId: o.company.id, name: 'delegation.overdue' },
          select: { entityId: true },
        })
      ).map((e) => e.entityId);
    const now = new Date();
    // At most two re-tells a pass: the new one and two of the three old ones go now…
    await flagOverdueTasks(ctx.prisma, now, 2);
    const first = await told();
    expect(first).toContain(ids[3]);
    expect(first).toHaveLength(3);
    // …and the third on the next pass. Nobody is told twice in a day.
    await flagOverdueTasks(ctx.prisma, now, 2);
    expect((await told()).sort()).toEqual([...ids].sort());
    await flagOverdueTasks(ctx.prisma, now, 2);
    expect(await told()).toHaveLength(4);
  });
});
