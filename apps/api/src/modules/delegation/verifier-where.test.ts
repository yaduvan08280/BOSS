import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DelegationSettings } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { pendingCounts } from '../work/counts';
import { verifierWhere } from './queries';
import { effectiveVerifier } from './service';

/**
 * "What waits for my check" is counted by the database (verifierWhere). It must say exactly what the rule
 * in code says (effectiveVerifier) for every mix of verifier, creator, doer and settings.
 */
describe('who verifies a task, as a database condition', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp();
  });
  afterAll(async () => ctx.app.close());

  it('agrees with the rule in code for every combination, and no screen reads the waiting tasks themselves', async () => {
    const w = await world(ctx.app);
    const ids = [w.owner.id as string, (await w.person('Asha')).id, (await w.person('Bhanu')).id];
    const delegationDefaults = {
      acceptWithinMinutes: 30,
      verifyWithinMinutes: 60,
      reportsOpenOn: 'thisWeek' as const,
      doerMustAccept: true,
      allowReopen: true,
    };
    let number = 9000;
    const rows = [];
    for (const doerId of ids)
      for (const creatorId of ids)
        for (const verifierId of [null, ...ids])
          for (const status of ['PENDING_VERIFY', 'OPEN'])
            rows.push({
              companyId: w.companyId,
              number: number++,
              description: 'who checks this',
              doerId,
              creatorId,
              verifierId,
              status,
              plannedAt: new Date(),
              originalPlannedAt: new Date(),
            });
    await ctx.prisma.task.createMany({ data: rows });
    const waiting = rows.filter((r) => r.status === 'PENDING_VERIFY');
    const settings: DelegationSettings[] = [
      { ...delegationDefaults, eaVerifies: false, eaUserId: null },
      { ...delegationDefaults, eaVerifies: true, eaUserId: null },
      { ...delegationDefaults, eaVerifies: true, eaUserId: ids[1]! },
      { ...delegationDefaults, eaVerifies: false, eaUserId: ids[1]! },
    ];
    for (const s of settings)
      for (const me of ids) {
        const byRule = waiting.filter((t) => effectiveVerifier(t, s) === me).length;
        const byDatabase = await ctx.prisma.task.count({
          where: {
            companyId: w.companyId,
            number: { gte: 9000 },
            status: 'PENDING_VERIFY',
            ...verifierWhere(me, s),
          },
        });
        expect(byDatabase, `eaVerifies ${s.eaVerifies}, ea ${s.eaUserId}, me ${me}`).toBe(byRule);
      }
    // The counter in the top bar uses it (company settings as they are).
    const counts = await pendingCounts(ctx.prisma, w.companyId, ids[0]!);
    expect(counts.delegation).toBeGreaterThan(0);
  });
});

describe('the delegation sheet with years of old tasks', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp();
  });
  afterAll(async () => ctx.app.close());

  it('still shows today’s open task after 1,200 finished ones, and the tab counts are the real totals', async () => {
    const w = await world(ctx.app);
    const old = new Date(Date.now() - 400 * 86_400_000);
    await ctx.prisma.task.createMany({
      data: Array.from({ length: 1200 }, (_, i) => ({
        companyId: w.companyId,
        number: 5000 + i,
        description: `Old task ${i}`,
        doerId: w.owner.id as string,
        creatorId: w.owner.id as string,
        status: 'DONE',
        plannedAt: new Date(old.getTime() + i * 60_000),
        originalPlannedAt: old,
        doneAt: new Date(old.getTime() + i * 60_000),
      })),
    });
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const made = await w.api.post('/api/tasks', {
      doerId: w.owner.id,
      plannedAt: due,
      description: 'Today’s work',
    });
    expect(made.status).toBe(200);
    const pending = (await w.api.get('/api/tasks')).body as {
      counts: { pending: number; done: number };
      tasks: { id: string }[];
    };
    expect(pending.tasks.map((t) => t.id)).toContain(made.body.id);
    expect(pending.counts).toMatchObject({ pending: 1, done: 1200 });
    // Finished work: the latest first, a page of it; everything: the latest by planned date, today's included.
    const done = (await w.api.get('/api/tasks?tab=done')).body as { tasks: { number: number }[] };
    expect(done.tasks).toHaveLength(500);
    expect(done.tasks[0]!.number).toBe(6199);
    const all = (await w.api.get('/api/tasks?tab=all')).body as { tasks: { id: string }[] };
    expect(all.tasks.at(-1)!.id).toBe(made.body.id);
  });
});
