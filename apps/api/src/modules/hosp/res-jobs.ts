import type { Db } from '@mono/db';
import { reservationMachine, transition } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { resOutlet, tellGuest, type ResOutlet } from './res-core';
import { endIn } from './res-flow';

/**
 * Phase 16 — what the clock does to bookings (worker, every minute): the reminder some hours before, a no-show
 * once the hold time after the booking has passed, and a request nobody confirmed lapses at its time.
 */
export async function reservationSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const rows = await db.reservation.findMany({
    where: {
      ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}),
      status: { in: ['REQUESTED', 'CONFIRMED', 'REMINDED'] },
      startAt: { lt: new Date(now.getTime() + 72 * 3_600_000) },
    },
    orderBy: { startAt: 'asc' },
    take: 500,
  });
  const outlets = new Map<string, ResOutlet | null>();
  const out = { reminded: 0, noShows: 0, lapsed: 0 };
  for (const r of rows) {
    if (!outlets.has(r.outletId))
      outlets.set(r.outletId, await resOutlet(db, { id: r.outletId, companyId: r.companyId }));
    const outlet = outlets.get(r.outletId);
    if (!outlet) continue;
    const ctx = { companyId: r.companyId, actorId: null };
    const start = r.startAt.getTime();
    const t = now.getTime();
    if (r.status === 'REQUESTED') {
      if (t < start) continue;
      await db.$transaction((tx) =>
        endIn(tx, ctx, outlet, r, 'CANCEL', 'system', 'Not confirmed in time', t),
      );
      out.lapsed++;
    } else if (t >= start + outlet.booking.holdMin * 60_000) {
      await db.$transaction((tx) => endIn(tx, ctx, outlet, r, 'NO_SHOW', 'system', null, t));
      out.noShows++;
    } else if (r.status === 'CONFIRMED' && !r.remindedAt && t < start) {
      const window = outlet.booking.reminderHours * 3_600_000;
      // A booking made inside the reminder window was just confirmed: it gets no second message.
      if (!window || t < start - window || r.createdAt.getTime() > start - window) continue;
      await db.$transaction(async (tx) => {
        const status = transition(reservationMachine, {
          from: 'CONFIRMED',
          action: 'remind',
          roles: ['system'],
          ctx: { depositDue: false, pastHold: false },
        }).to;
        const after = await tx.reservation.update({
          where: { id: r.id },
          data: { status, remindedAt: now },
        });
        await writeAudit(tx, ctx, {
          action: 'reservation.remind',
          entityType: 'reservation',
          entityId: r.id,
          before: { status: r.status },
          after: { status },
        });
        await tellGuest(
          tx,
          ctx,
          'reservation.reminder',
          outlet,
          after,
          await tx.guest.findFirstOrThrow({ where: { id: r.guestId } }),
        );
      });
      out.reminded++;
    }
  }
  return out;
}
