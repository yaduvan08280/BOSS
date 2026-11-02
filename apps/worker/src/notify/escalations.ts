import type { Db } from '@mono/db';
import { emitEvent } from '@mono/api/services';
import { hodOf } from './recipients';

/**
 * "If no reply in N minutes, escalate to …". A reply is any of: the person read the in-app notification
 * (or pressed "Seen" in Telegram), or they did anything on the same record since.
 */
export async function processEscalations(
  db: Db,
  batch = 50,
): Promise<{ answered: number; escalated: number }> {
  const due = await db.escalation.findMany({
    where: { status: 'WAITING', dueAt: { lte: new Date() } },
    orderBy: { dueAt: 'asc' },
    take: batch,
  });
  let answered = 0;
  let escalated = 0;
  for (const e of due) {
    const read = await db.notification.count({
      where: { eventId: e.eventId, userId: e.userId, readAt: { not: null } },
    });
    const acted =
      e.entityId &&
      (await db.domainEvent.count({
        where: {
          companyId: e.companyId,
          actorId: e.userId,
          entityId: e.entityId,
          occurredAt: { gt: e.createdAt },
          NOT: { name: { startsWith: 'notify.' } },
        },
      }));
    if (read || acted) {
      await db.escalation.update({
        where: { id: e.id },
        data: { status: 'ANSWERED', resolvedAt: new Date() },
      });
      answered++;
      continue;
    }
    const rule = await db.notificationRule.findUnique({ where: { id: e.ruleId } });
    const original = await db.domainEvent.findUnique({ where: { id: e.eventId } });
    const person = await db.user.findUnique({ where: { id: e.userId }, select: { name: true } });
    const subject = await db.notification.findFirst({
      where: { eventId: e.eventId, userId: e.userId },
      select: { title: true, link: true },
    });
    const target = await escalationTarget(
      db,
      e.companyId,
      rule?.escalateTo ?? 'hod',
      e.userId,
      (original?.payload ?? {}) as Record<string, unknown>,
    );

    await db.$transaction(async (tx) => {
      await tx.escalation.update({
        where: { id: e.id },
        data: {
          status: target ? 'ESCALATED' : 'CANCELLED',
          escalatedToUserId: target,
          resolvedAt: new Date(),
        },
      });
      if (!target) return;
      await emitEvent(
        tx,
        { companyId: e.companyId, actorId: null },
        {
          name: 'notify.escalation',
          entityType: e.entityType ?? undefined,
          entityId: e.entityId ?? undefined,
          payload: {
            userId: target,
            personId: e.userId,
            person: person?.name ?? '',
            subject: subject?.title ?? original?.name ?? '',
            minutes: rule?.escalateAfterMinutes ?? 0,
            link: subject?.link ?? '/notifications',
          },
        },
      );
    });
    if (target) escalated++;
  }
  return { answered, escalated };
}

async function escalationTarget(
  db: Db,
  companyId: string,
  to: string,
  userId: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  if (to.startsWith('user:')) return to.slice(5);
  if (to === 'owner')
    return (
      (
        await db.user.findFirst({
          where: { companyId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' } },
          select: { id: true },
        })
      )?.id ?? null
    );
  if (to === 'hod') return (await hodOf(db, companyId, userId))[0]?.id ?? null;
  const id = payload[`${to}Id`];
  return typeof id === 'string' && id !== userId ? id : null;
}
