import type { Db } from '@mono/db';
import { formatShortDateTime } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { moduleSettings } from '../work/settings';
import { autoCloseSlip, slipWaitingOn } from './service';

/**
 * Every 5 minutes: tell whoever is holding a slip (and the accountable person) once it passes its step's
 * time limit; close decided slips the raiser left open past theirs (approved ones once the task is done).
 */
export async function sweepSlips(db: Db, now = new Date()): Promise<{ late: number; closed: number }> {
  const rows = await db.slip.findMany({
    where: {
      deletedAt: null,
      status: { in: ['SUBMITTED', 'RETURNED', 'WITH_APPROVER', 'APPROVED', 'REJECTED'] },
    },
    take: 1000,
  });
  const settings = new Map<string, Awaited<ReturnType<typeof moduleSettings<'slip'>>>>();
  const zones = new Map<string, string>();
  let late = 0;
  let closed = 0;
  for (const slip of rows) {
    if (!settings.has(slip.companyId)) {
      settings.set(slip.companyId, await moduleSettings(db, slip.companyId, 'slip'));
      const c = await db.company.findUniqueOrThrow({
        where: { id: slip.companyId },
        select: { timezone: true },
      });
      zones.set(slip.companyId, c.timezone);
    }
    const s = settings.get(slip.companyId)!;
    const w = slipWaitingOn(slip, s);
    if (!w || w.dueAt > now) continue;

    if (slip.status === 'APPROVED' || slip.status === 'REJECTED') {
      if (slip.status === 'APPROVED' && slip.taskId) {
        const task = await db.task.findFirst({
          where: { id: slip.taskId },
          select: { status: true, doneAt: true },
        });
        const finished = task && ['DONE', 'CANCELLED'].includes(task.status);
        if (!finished) continue;
        if (task.doneAt && task.doneAt.getTime() + s.raiserCloseHours * 3600_000 > now.getTime()) continue;
      }
      if (await db.$transaction((tx) => autoCloseSlip(tx, slip))) closed++;
      continue;
    }
    if (slip.lateNotifiedAt) continue;
    await db.$transaction(async (tx) => {
      const res = await tx.slip.updateMany({
        where: { id: slip.id, lateNotifiedAt: null, status: slip.status },
        data: { lateNotifiedAt: now },
      });
      if (!res.count) return;
      late++;
      await emitEvent(
        tx,
        { companyId: slip.companyId, actorId: null },
        {
          name: 'slip.late',
          entityType: 'slip',
          entityId: slip.id,
          payload: {
            userId: w.userId,
            accountableId: slip.accountableId,
            raiserId: slip.raiserId,
            number: slip.number,
            problem: slip.problem.slice(0, 80),
            since: formatShortDateTime(slip.stepSince, zones.get(slip.companyId)!),
            link: `/help-slips?slip=${slip.id}`,
          },
        },
      );
    });
  }
  return { late, closed };
}
