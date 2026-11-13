import type { Tx } from '@mono/db';
import { reservationMachine, transition } from '@mono/shared';
import { writeAudit, type ActorContext } from '../../lib/audit';

/** The order a booking was seated on is paid: the booking is finished. Called by the POS when an order settles. */
export async function finishForOrder(tx: Tx, ctx: ActorContext, reservationId: string) {
  const r = await tx.reservation.findFirst({ where: { id: reservationId, companyId: ctx.companyId } });
  if (!r || r.status !== 'SEATED') return;
  await tx.reservation.update({
    where: { id: r.id },
    data: {
      status: transition(reservationMachine, {
        from: 'SEATED',
        action: 'finish',
        roles: ['system'],
        ctx: { depositDue: false, pastHold: true },
      }).to,
      finishedAt: new Date(),
    },
  });
  await writeAudit(tx, ctx, {
    action: 'reservation.finish',
    entityType: 'reservation',
    entityId: r.id,
    before: { status: r.status },
    after: { status: 'FINISHED' },
  });
}
