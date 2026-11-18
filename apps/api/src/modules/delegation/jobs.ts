import type { Db } from '@mono/db';
import { localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { afterId, paged } from '../../lib/paged';
import { moduleSettings } from '../work/settings';
import { effectiveVerifier } from './service';

/**
 * Overdue detection (every 5 minutes): open tasks past their planned time raise `delegation.overdue`.
 * Then again once a day (local morning) while they stay overdue, so people aren't flooded.
 */
export async function flagOverdueTasks(db: Db, now = new Date()): Promise<number> {
  const late = paged((after, take) =>
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
  );
  let flagged = 0;
  const tzCache = new Map<string, string>();
  const settings = new Map<string, Awaited<ReturnType<typeof moduleSettings<'delegation'>>>>();
  for await (const t of late) {
    let tz = tzCache.get(t.companyId);
    if (!tz) {
      tz = (await db.company.findUniqueOrThrow({ where: { id: t.companyId }, select: { timezone: true } }))
        .timezone;
      tzCache.set(t.companyId, tz);
    }
    if (t.lastOverdueNotifiedAt && localDate(t.lastOverdueNotifiedAt, tz) === localDate(now, tz)) continue;
    let s = settings.get(t.companyId);
    if (!s) settings.set(t.companyId, (s = await moduleSettings(db, t.companyId, 'delegation')));
    const set = s;
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
            verifierId: effectiveVerifier(t, set),
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
  return flagged;
}

/**
 * "Accept within N minutes": a task still waiting for its doer to accept after that time
 * reminds the doer and tells the creator, once per assignment.
 */
export async function remindUnaccepted(db: Db, now = new Date()): Promise<number> {
  const waiting = paged((after, take) =>
    db.task.findMany({
      where: { deletedAt: null, status: 'AWAITING_ACCEPTANCE', ...afterId(after) },
      orderBy: { id: 'asc' },
      take,
    }),
  );
  let sent = 0;
  for await (const t of waiting) {
    const s = await moduleSettings(db, t.companyId, 'delegation');
    const since = await db.taskEvent.findFirst({
      where: { taskId: t.id, toStatus: 'AWAITING_ACCEPTANCE' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const from = since?.createdAt ?? t.createdAt;
    if (now.getTime() - from.getTime() < s.acceptWithinMinutes * 60_000) continue;
    if (
      await db.taskEvent.count({ where: { taskId: t.id, type: 'accept_reminder', createdAt: { gte: from } } })
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
  return sent;
}
