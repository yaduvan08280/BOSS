import type { Db } from '@mono/db';
import { ticketEscalation } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { hodFor, ownerOf } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { logTicket, ticketPayload } from './service';

const DAY = 24 * 3600_000;

/**
 * Every 5 minutes: raise the escalation level of tickets that missed their first reply or fix time
 * (level 1 → coordinator, or the solver's HOD when there is none; level 2 → HOD and owner),
 * and close resolved tickets after 24 h when the company chose "auto after 24 hrs".
 */
export async function sweepTickets(db: Db, now = new Date()): Promise<{ escalated: number; closed: number }> {
  const rows = await db.ticket.findMany({
    where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'RESOLVED'] } },
    take: 2000,
  });
  const cache = new Map<string, Awaited<ReturnType<typeof moduleSettings<'ticket'>>>>();
  let escalated = 0;
  let closed = 0;
  for (const t of rows) {
    if (!cache.has(t.companyId)) cache.set(t.companyId, await moduleSettings(db, t.companyId, 'ticket'));
    const s = cache.get(t.companyId)!;

    if (t.status === 'RESOLVED') {
      if (s.closeBy !== 'auto24h' || !t.resolvedAt || t.resolvedAt.getTime() + DAY > now.getTime()) continue;
      await db.$transaction(async (tx) => {
        const res = await tx.ticket.updateMany({
          where: { id: t.id, status: 'RESOLVED' },
          data: { status: 'CLOSED', closedAt: now, closedBy: 'auto' },
        });
        if (!res.count) return;
        closed++;
        await logTicket(tx, t, null, 'status', {
          fromStatus: 'RESOLVED',
          toStatus: 'CLOSED',
          note: 'Closed automatically',
        });
        await emitEvent(
          tx,
          { companyId: t.companyId, actorId: null },
          { name: 'ticket.closed', entityType: 'ticket', entityId: t.id, payload: ticketPayload(t) },
        );
      });
      continue;
    }

    const { level, reason } = ticketEscalation(t, s, now);
    if (level <= t.escalationLevel) continue;
    const hod = await hodFor(db, t.companyId, t.solverId);
    const to =
      level === 1 ? [t.coordinatorId ?? hod] : [hod, await ownerOf(db, t.companyId), t.coordinatorId];
    const userIds = [...new Set(to.filter((x): x is string => Boolean(x)))];
    const why =
      reason === 'noReply' ? `no reply in ${s.firstReplyHours} h` : 'the planned fix time has passed';
    await db.$transaction(async (tx) => {
      const res = await tx.ticket.updateMany({
        where: { id: t.id, escalationLevel: t.escalationLevel },
        data: { escalationLevel: level, escalatedAt: now },
      });
      if (!res.count) return;
      escalated++;
      await logTicket(tx, t, null, 'escalated', { note: `Level ${level}: ${why}` });
      await emitEvent(
        tx,
        { companyId: t.companyId, actorId: null },
        {
          name: 'ticket.escalated',
          entityType: 'ticket',
          entityId: t.id,
          payload: { ...ticketPayload(t), userId: userIds, level, why },
        },
      );
    });
  }
  return { escalated, closed };
}
