import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient } from '../test/helpers';
import { forEachPage } from '../lib/paging';
import { remindChecklists, sweepChecklists } from './checklist/jobs';
import { flagOverdueTasks, remindUnaccepted } from './delegation/jobs';
import { sweepSlips } from './slip/jobs';
import { sweepTickets } from './ticket/jobs';

/**
 * Sweeps whose handled rows stay in the selected set must page through all of them. Each test makes more rows
 * than one page (page size 2), so a sweep that reads only a first batch would leave some of them untouched.
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const PAGE = 2;
const ROWS = 5;
const rnd = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

async function team(people = 2) {
  const o = await ownerClient(ctx.app);
  const ids: string[] = [];
  for (let i = 0; i < people; i++)
    ids.push((await o.api.post('/api/org/users', { name: `Person ${i}`, mobile: rnd() })).body.person.id);
  return { ...o, ids };
}

/** How many of `ids` got the event `name`. */
const reached = async (companyId: string, name: string, ids: string[]) =>
  new Set(
    (
      await ctx.prisma.domainEvent.findMany({
        where: { companyId, name, entityId: { in: ids } },
        select: { entityId: true },
      })
    ).map((e) => e.entityId),
  ).size;

describe('forEachPage', () => {
  it('hands over every page and stops on a short one', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}` }));
    const seen: string[][] = [];
    await forEachPage(
      async (after, take) => rows.filter((r) => !after || r.id > after).slice(0, take),
      async (page) => void seen.push(page.map((r) => r.id)),
      2,
    );
    expect(seen).toEqual([['r0', 'r1'], ['r2', 'r3'], ['r4']]);
  });
});

describe('sweeps page through every row', () => {
  it('delegation: overdue and unaccepted tasks', async () => {
    const { api, company, ids } = await team(1);
    const res = await api.post('/api/tasks/import', {
      tasks: Array.from({ length: ROWS }, (_, i) => ({
        doerId: ids[0],
        plannedAt: inHours(-30),
        description: `Late ${i}`,
      })),
    });
    expect(res.body.created).toBe(ROWS);
    const tasks = (
      await ctx.prisma.task.findMany({ where: { companyId: company.id }, select: { id: true, status: true } })
    ).map((t) => t.id);
    expect(tasks).toHaveLength(ROWS);

    await flagOverdueTasks(ctx.prisma, new Date(), PAGE);
    expect(await reached(company.id, 'delegation.overdue', tasks)).toBe(ROWS);

    // Still waiting for the doer to accept, past the 30 minutes.
    await remindUnaccepted(ctx.prisma, new Date(Date.now() + 2 * 3600_000), PAGE);
    expect(await reached(company.id, 'delegation.accept_late', tasks)).toBe(ROWS);
  });

  it('help slips: late notices', async () => {
    const { api, company, ids } = await team(1);
    await api.put('/api/work/settings/slip', { receiverUserId: ids[0], solutionsRequired: 1 });
    const slips: string[] = [];
    for (let i = 0; i < ROWS; i++)
      slips.push(
        (
          await api.post('/api/slips', {
            problem: `Water leak on floor ${i}`,
            solutions: ['Call the plumber'],
          })
        ).body.id,
      );
    await ctx.prisma.slip.updateMany({
      where: { id: { in: slips } },
      data: { stepSince: new Date(Date.now() - 30 * 3600_000) },
    });
    await sweepSlips(ctx.prisma, new Date(), PAGE);
    expect(await reached(company.id, 'slip.late', slips)).toBe(ROWS);
  });

  it('help tickets: escalations', async () => {
    const { api, company, ids } = await team(1);
    const tickets: string[] = [];
    for (let i = 0; i < ROWS; i++)
      tickets.push(
        (
          await api.post('/api/tickets', {
            title: `Printer jammed ${i}`,
            solverId: ids[0],
            plannedFixAt: inHours(48),
          })
        ).body.id,
      );
    await ctx.prisma.ticket.updateMany({
      where: { id: { in: tickets } },
      data: { createdAt: new Date(Date.now() - 5 * 3600_000) },
    });
    await sweepTickets(ctx.prisma, new Date(), PAGE);
    expect(await reached(company.id, 'ticket.escalated', tickets)).toBe(ROWS);
  });

  it('checklists: reminders', async () => {
    const { api, company, ids } = await team(ROWS);
    const master = await api.post('/api/checklists/masters', {
      name: 'Gate round',
      items: [{ key: 'a', text: 'Lock the gate' }],
      frequency: { type: 'daily' },
      dueTime: '10:00',
      windowHours: 4,
      doerIds: ids,
      startDate: '2031-01-01',
    });
    expect(master.status).toBe(200);
    // Monday 06/01/2031, 08:30 IST: one run per doer, due at 10:00.
    await sweepChecklists(ctx.prisma, new Date('2031-01-06T03:00:00Z'));
    const runs = await ctx.prisma.checklistRun.findMany({ where: { companyId: company.id } });
    expect(runs).toHaveLength(ROWS);
    await remindChecklists(ctx.prisma, new Date(runs[0]!.plannedAt.getTime() - 10 * 60_000), PAGE);
    expect(
      await reached(
        company.id,
        'checklist.reminder',
        runs.map((r) => r.id),
      ),
    ).toBe(ROWS);
  });
});
