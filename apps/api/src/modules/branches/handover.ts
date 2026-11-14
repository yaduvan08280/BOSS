import type { Tx } from '@mono/db';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';

type Ctx = { companyId: string; actorId: string | null };
export type WorkChoice = { mode: 'keep' | 'handover' | 'manager'; toUserId?: string | null };

const LIVE_TASK = ['OPEN', 'AWAITING_ACCEPTANCE'];

/** What a person still holds: the numbers the transfer dialog shows before asking what should happen to it. */
export async function openWorkOf(tx: Tx, companyId: string, userId: string) {
  const [tasks, steps, tickets, runs, checklists] = await Promise.all([
    tx.task.count({ where: { companyId, deletedAt: null, doerId: userId, status: { in: LIVE_TASK } } }),
    tx.fmsRecordStep.count({
      where: {
        companyId,
        doerId: userId,
        status: 'OPEN',
        type: { not: 'AUTO' },
        record: { status: 'RUNNING', deletedAt: null },
      },
    }),
    tx.ticket.count({
      where: { companyId, deletedAt: null, solverId: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    tx.checklistRun.count({
      where: { companyId, doerId: userId, status: 'OPEN', master: { deletedAt: null } },
    }),
    tx.checklistMaster.count({
      where: { companyId, deletedAt: null, active: true, doerIds: { has: userId } },
    }),
  ]);
  return { tasks, steps, tickets, runs, checklists, total: tasks + steps + tickets + checklists };
}

/** Who the work goes back to at a branch: its manager (not the person themselves), else whom they report to. */
export async function managerFor(tx: Tx, companyId: string, userId: string, branchId: string | null) {
  if (branchId) {
    const managers = await tx.branchManager.findMany({
      where: { companyId, branchId, role: 'MANAGER', userId: { not: userId } },
      select: { userId: true },
    });
    const live = await tx.user.findFirst({
      where: { id: { in: managers.map((m) => m.userId) }, companyId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
    if (live) return live;
  }
  const person = await tx.user.findFirst({ where: { id: userId, companyId }, select: { reportsToId: true } });
  if (!person?.reportsToId) return null;
  return tx.user.findFirst({
    where: { id: person.reportsToId, companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, name: true },
  });
}

/**
 * A person's open work goes to someone else for good (a transfer to another branch): open tasks, process steps
 * and tickets change hands, and recurring checklists name the new person from now on. Work already done stays
 * in the first person's name. Returns how much moved.
 */
export async function handOverWork(tx: Tx, ctx: Ctx, fromUserId: string, toUserId: string, why: string) {
  if (fromUserId === toUserId) throw new AppError(400, 'BAD_REQUEST', 'Choose someone else to take the work');
  const to = await tx.user.findFirst({
    where: { id: toUserId, companyId: ctx.companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!to) throw new AppError(404, 'NOT_FOUND', 'The person taking the work was not found');
  const moved = { tasks: 0, steps: 0, tickets: 0, checklists: 0 };

  const tasks = await tx.task.findMany({
    where: { companyId: ctx.companyId, deletedAt: null, doerId: fromUserId, status: { in: LIVE_TASK } },
  });
  for (const t of tasks) {
    await tx.task.update({ where: { id: t.id }, data: { doerId: toUserId } });
    await tx.taskEvent.create({
      data: {
        companyId: t.companyId,
        taskId: t.id,
        type: 'reassigned',
        actorId: ctx.actorId,
        fromUserId,
        toUserId,
        note: why,
      },
    });
    await emitEvent(tx, ctx, {
      name: 'delegation.assigned',
      entityType: 'task',
      entityId: t.id,
      payload: {
        doerId: toUserId,
        creatorId: t.creatorId,
        number: t.number,
        title: t.description.slice(0, 80),
        due: t.plannedAt.toISOString(),
        link: `/delegation?task=${t.id}`,
        telegramActions: t.status === 'AWAITING_ACCEPTANCE' ? ['accept'] : ['done', 'move'],
      },
    });
    moved.tasks += 1;
  }

  const steps = await tx.fmsRecordStep.updateMany({
    where: {
      companyId: ctx.companyId,
      doerId: fromUserId,
      status: 'OPEN',
      record: { status: 'RUNNING', deletedAt: null },
    },
    data: { doerId: toUserId },
  });
  moved.steps = steps.count;

  const tickets = await tx.ticket.updateMany({
    where: {
      companyId: ctx.companyId,
      deletedAt: null,
      solverId: fromUserId,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    data: { solverId: toUserId },
  });
  moved.tickets = tickets.count;

  // Recurring checklists: the new person is named instead, and takes the runs not yet started.
  const masters = await tx.checklistMaster.findMany({
    where: { companyId: ctx.companyId, deletedAt: null, doerIds: { has: fromUserId } },
    select: { id: true, doerIds: true },
  });
  for (const m of masters) {
    await tx.checklistMaster.update({
      where: { id: m.id },
      data: { doerIds: [...new Set(m.doerIds.map((d) => (d === fromUserId ? toUserId : d)))] },
    });
    const runs = await tx.checklistRun.findMany({
      where: { masterId: m.id, doerId: fromUserId, status: 'OPEN' },
      select: { id: true, plannedAt: true },
    });
    for (const r of runs) {
      // The new person may already have their own run for that time: then the old one simply goes.
      const twin = await tx.checklistRun.count({
        where: { masterId: m.id, plannedAt: r.plannedAt, doerId: toUserId },
      });
      if (twin) {
        await tx.checklistRunItem.deleteMany({ where: { runId: r.id } });
        await tx.checklistRun.delete({ where: { id: r.id } });
      } else await tx.checklistRun.update({ where: { id: r.id }, data: { doerId: toUserId } });
    }
    moved.checklists += 1;
  }
  return moved;
}
