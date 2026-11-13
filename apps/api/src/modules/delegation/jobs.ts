import type { Db } from '@mono/db';
import { localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { afterId, forEachPage } from '../../lib/paging';
import { moduleSettings } from '../work/settings';
import { effectiveVerifier } from './service';

/**
 * Overdue detection (every 5 minutes): open tasks past their planned time raise `delegation.overdue`.
 * Then again once a day (local morning) while they stay overdue, so people aren't flooded.
 */
export async function flagOverdueTasks(db: Db, now = new Date(), pageSize = 500): Promise<number> {
  let flagged = 0;
  const tzCache = new Map<string, string>();
  // Flagged tasks stay overdue (and in this set), so every one is looked at, a page at a time.
  await forEachPage(
    (after, take) =>
      db.task.findMany({
        where: {
          deletedAt: null,
          status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] },
          plannedAt: { lt: now },
          ...afterId(after),
        },
        orderBy: { id: 'asc' },
        take,
      }),
    async (late) => {
      for (const t of late) {
        let tz = tzCache.get(t.companyId);
        if (!tz) {
          tz = (
            await db.company.findUniqueOrThrow({ where: { id: t.companyId }, select: { timezone: true } })
          ).timezone;
          tzCache.set(t.companyId, tz);
        }
        if (t.lastOverdueNotifiedAt && localDate(t.lastOverdueNotifiedAt, tz) === localDate(now, tz))
          continue;
        const s = await moduleSettings(db, t.companyId, 'delegation');
        await db.$transaction(async (tx) => {
          const res = await tx.task.updateMany({
            where: { id: t.id, lastOverdueNotifiedAt: t.lastOverdueNotifiedAt },
            data: { lastOverdueNotifiedAt: now },
          });
          if (!res.count) return;
          await emitEvent(
            tx,
            { companyId: t.companyId, actorId: null },
            {
              name: 'delegation.overdue',
              entityType: 'task',
              entityId: t.id,
              payload: {
                doerId: t.doerId,
                creatorId: t.creatorId,
                verifierId: effectiveVerifier(t, s),
                number: t.number,
                title: t.description.slice(0, 80),
                due: t.plannedAt.toISOString(),
                link: `/delegation?task=${t.id}`,
                telegramActions: t.status === 'OPEN' ? ['done', 'move'] : ['accept'],
              },
            },
          );
        });
        flagged++;
      }
    },
    pageSize,
  );
  return flagged;
}

/**
 * "Accept within N minutes": a task still waiting for its doer to accept after that time
 * reminds the doer and tells the creator, once per assignment.
 */
export async function remindUnaccepted(db: Db, now = new Date(), pageSize = 500): Promise<number> {
  let sent = 0;
  // Reminded (and not yet due) tasks keep waiting in this set, so every one is looked at, a page at a time.
  await forEachPage(
    (after, take) =>
      db.task.findMany({
        where: { deletedAt: null, status: 'AWAITING_ACCEPTANCE', ...afterId(after) },
        orderBy: { id: 'asc' },
        take,
      }),
    async (waiting) => {
      for (const t of waiting) {
        const s = await moduleSettings(db, t.companyId, 'delegation');
        const since = await db.taskEvent.findFirst({
          where: { taskId: t.id, toStatus: 'AWAITING_ACCEPTANCE' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        const from = since?.createdAt ?? t.createdAt;
        if (now.getTime() - from.getTime() < s.acceptWithinMinutes * 60_000) continue;
        if (
          await db.taskEvent.count({
            where: { taskId: t.id, type: 'accept_reminder', createdAt: { gte: from } },
          })
        )
          continue;
        await db.$transaction(async (tx) => {
          await tx.taskEvent.create({
            data: { companyId: t.companyId, taskId: t.id, type: 'accept_reminder', actorId: null },
          });
          await emitEvent(
            tx,
            { companyId: t.companyId, actorId: null },
            {
              name: 'delegation.accept_late',
              entityType: 'task',
              entityId: t.id,
              payload: {
                doerId: t.doerId,
                creatorId: t.creatorId,
                number: t.number,
                title: t.description.slice(0, 80),
                minutes: s.acceptWithinMinutes,
                link: `/delegation?task=${t.id}`,
                telegramActions: ['accept'],
              },
            },
          );
        });
        sent++;
      }
    },
    pageSize,
  );
  return sent;
}
