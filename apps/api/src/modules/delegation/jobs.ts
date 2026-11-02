import type { Db } from '@mono/db';
import { localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { moduleSettings } from '../work/settings';
import { effectiveVerifier } from './service';

/**
 * Overdue detection (every 5 minutes): open tasks past their planned time raise `delegation.overdue`.
 * Then again once a day (local morning) while they stay overdue, so people aren't flooded.
 */
export async function flagOverdueTasks(db: Db, now = new Date()): Promise<number> {
  const late = await db.task.findMany({
    where: { deletedAt: null, status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] }, plannedAt: { lt: now } },
    take: 500,
  });
  let flagged = 0;
  const tzCache = new Map<string, string>();
  for (const t of late) {
    let tz = tzCache.get(t.companyId);
    if (!tz) {
      tz = (await db.company.findUniqueOrThrow({ where: { id: t.companyId }, select: { timezone: true } }))
        .timezone;
      tzCache.set(t.companyId, tz);
    }
    if (t.lastOverdueNotifiedAt && localDate(t.lastOverdueNotifiedAt, tz) === localDate(now, tz)) continue;
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
  return flagged;
}
