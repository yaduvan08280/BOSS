import type { Db, Reservation, Tx } from '@mono/db';
import {
  bookingPatchSchema,
  bookingSchema,
  depositOutcome,
  formatINR,
  localDate,
  reservationMachine,
  transition,
  type ReservationAction,
  type ReservationRole,
  type ReservationStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit, type ActorContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { createBillIn, voidBill } from '../money/bills';
import type { Actor } from '../work/actor';
import { ctxOf, hospOf, need } from './access';
import { openOrder } from './orders';
import { isApprover } from './pos-core';
import {
  bookedTables,
  guestParty,
  lockOutlet,
  newToken,
  resOutlet,
  tellGuest,
  whenOf,
  type ResOutlet,
} from './res-core';
import { host, staffOutlet, viewOf } from './reservations';

/**
 * Phase 16 — the life of a booking: confirmed, the guest arrives, is seated (the POS order opens on the table),
 * and it finishes when that order is paid; or it is cancelled, or the guest never comes. A deposit follows it:
 * due → paid → used on the bill, kept, or to be given back.
 */
const move = (
  r: Reservation,
  action: ReservationAction,
  role: ReservationRole,
  outlet: ResOutlet,
  now = Date.now(),
) =>
  transition(reservationMachine, {
    from: r.status as ReservationStatus,
    action,
    roles: [role],
    ctx: {
      depositDue: r.depositState === 'DUE',
      pastHold: now >= r.startAt.getTime() + outlet.booking.holdMin * 60_000,
    },
  }).to;

async function load(db: Db | Tx, companyId: string, id: string) {
  const r = await db.reservation.findFirst({ where: { id, companyId } });
  if (!r) throw notFound('Reservation');
  return r;
}
const guestOf = (db: Db | Tx, r: Reservation) => db.guest.findFirstOrThrow({ where: { id: r.guestId } });

/** A booking ends without a meal: what happens to its deposit, and the words the guest reads. */
function depositAfter(r: Reservation, outlet: ResOutlet, how: 'CANCEL' | 'NO_SHOW', now: number) {
  if (r.depositState !== 'PAID')
    return { state: r.depositState === 'DUE' ? null : r.depositState, words: '' };
  const hours = (r.startAt.getTime() - now) / 3_600_000;
  const keep = depositOutcome(outlet.booking, how, hours) === 'KEEP';
  const amount = formatINR(r.depositDue);
  return {
    state: keep ? 'KEPT' : 'REFUND_DUE',
    words: keep ? `The deposit of ${amount} is not returned.` : `The deposit of ${amount} will be returned.`,
  };
}

/** Cancel or no-show, by a person, the guest's own link, or the clock (in the caller's transaction). */
export async function endIn(
  tx: Tx,
  ctx: ActorContext,
  outlet: ResOutlet,
  r: Reservation,
  how: 'CANCEL' | 'NO_SHOW',
  role: ReservationRole,
  reason?: string | null,
  now = Date.now(),
) {
  const to = move(r, how === 'CANCEL' ? 'cancel' : 'noShow', role, outlet, now);
  const deposit = depositAfter(r, outlet, how, now);
  const row = await tx.reservation.update({
    where: { id: r.id },
    data: {
      status: to,
      depositState: deposit.state,
      ...(how === 'CANCEL' ? { cancelledAt: new Date(), cancelReason: reason ?? null } : {}),
    },
  });
  await writeAudit(tx, ctx, {
    action: how === 'CANCEL' ? 'reservation.cancelled' : 'reservation.no_show',
    entityType: 'reservation',
    entityId: r.id,
    before: { status: r.status },
    after: { status: to, by: role, reason: reason ?? null, deposit: deposit.state },
  });
  await tellGuest(
    tx,
    ctx,
    how === 'CANCEL' ? 'reservation.cancelled' : 'reservation.no_show',
    outlet,
    row,
    await guestOf(tx, r),
    { deposit: deposit.words },
  );
  return row;
}

export const actSchema = z.object({
  action: z.enum(['confirm', 'arrive', 'seat', 'cancel', 'noShow', 'restore', 'finish']),
  reason: z.string().trim().max(200).nullish(),
});
export async function actOnReservation(db: Db, actor: Actor, id: string, input: z.input<typeof actSchema>) {
  host(actor);
  const { action, reason } = actSchema.parse(input);
  const r = await load(db, actor.companyId, id);
  const outlet = await staffOutlet(db, actor, r.outletId);
  const ctx = ctxOf(actor);
  if (action === 'seat') return seat(db, actor, outlet, r);
  if (action === 'cancel' || action === 'noShow') {
    const row = await db.$transaction((tx) =>
      endIn(tx, ctx, outlet, r, action === 'cancel' ? 'CANCEL' : 'NO_SHOW', 'staff', reason),
    );
    return viewOf(db, row);
  }
  const to = move(r, action, 'staff', outlet);
  const row = await db.$transaction(async (tx) => {
    let depositState = r.depositState;
    if (action === 'restore') {
      // The guest turned up after all: only if nobody was given the table meanwhile.
      await lockOutlet(tx, outlet.id);
      const from = new Date(Math.max(Date.now(), r.startAt.getTime()));
      const busy = await bookedTables(tx, outlet, from, r.endAt, r.id);
      if (r.tableIds.some((t) => busy.has(t)))
        throw new AppError(409, 'CONFLICT', 'The table was given to another booking — choose another');
      if (depositState === 'KEPT' || depositState === 'REFUND_DUE') depositState = 'PAID';
    }
    const after = await tx.reservation.update({
      where: { id },
      data: {
        status: to,
        depositState,
        ...(action === 'arrive' ? { arrivedAt: new Date() } : {}),
        ...(action === 'finish' ? { finishedAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: `reservation.${action}`,
      entityType: 'reservation',
      entityId: id,
      before: { status: r.status },
      after: { status: to },
    });
    if (action === 'confirm')
      await tellGuest(tx, ctx, 'reservation.confirmed', outlet, after, await guestOf(tx, r));
    return after;
  });
  return viewOf(db, row);
}

/** Seat the party: the POS order opens on the booked table(s) with the covers and the guest's name. */
async function seat(db: Db, actor: Actor, outlet: ResOutlet, r: Reservation) {
  const to = move(r, 'seat', 'staff', outlet);
  if (!r.tableIds.length) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a table first');
  const guest = await guestOf(db, r);
  const partyId =
    r.depositState === 'PAID' ? await db.$transaction((tx) => guestParty(tx, guest)) : guest.partyId;
  const order = await openOrder(db, actor, {
    outletId: outlet.id,
    type: 'DINE_IN',
    tableIds: r.tableIds,
    covers: Math.min(200, r.partySize),
    guestName: guest.name,
    partyId,
    note: [r.occasion, r.requests, guest.allergies ? `Allergies: ${guest.allergies}` : null]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 300),
  });
  const row = await db.$transaction(async (tx) => {
    await tx.posOrder.update({ where: { id: order.id }, data: { guestId: guest.id, reservationId: r.id } });
    const after = await tx.reservation.update({
      where: { id: r.id },
      data: { status: to, seatedAt: new Date(), orderId: order.id, arrivedAt: r.arrivedAt ?? new Date() },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'reservation.seated',
      entityType: 'reservation',
      entityId: r.id,
      before: { status: r.status },
      after: { status: to, orderId: order.id },
    });
    return after;
  });
  return { ...(await viewOf(db, row)), order: { id: order.id, number: order.number } };
}

export const depositSchema = z.object({
  modeId: z.string().min(1).max(40),
  reference: z.string().trim().max(80).nullish(),
});
/**
 * The deposit was paid: an ADVANCE paper in the guest's name, and a booking that was waiting for it is confirmed.
 * (No payment gateway is connected yet — the money is taken by a person and recorded here.)
 */
export async function payDeposit(db: Db, actor: Actor, id: string, input: z.input<typeof depositSchema>) {
  host(actor);
  const p = depositSchema.parse(input);
  const r = await load(db, actor.companyId, id);
  const outlet = await staffOutlet(db, actor, r.outletId);
  if (r.depositState !== 'DUE') throw new AppError(409, 'CONFLICT', 'No deposit is due on this booking');
  if (['CANCELLED', 'NO_SHOW', 'FINISHED'].includes(r.status))
    throw new AppError(409, 'CONFLICT', 'This booking is closed');
  const mode = await db.paymentMode.findFirst({
    where: { id: p.modeId, companyId: actor.companyId, deletedAt: null, active: true },
  });
  if (!mode || ['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(mode.kind))
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose how the deposit was paid');
  if (mode.needsRef && !p.reference)
    throw new AppError(400, 'VALIDATION_FAILED', `${mode.name} needs a reference`);
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    const guest = await guestOf(tx, r);
    const advance = await createBillIn(
      tx,
      actor,
      {
        type: 'ADVANCE',
        partyId: await guestParty(tx, guest),
        date: localDate(new Date(), outlet.tz),
        branchId: outlet.branchId,
        lines: [],
        charges: [],
        discount: 0,
        taxInclusive: false,
        amount: Number(r.depositDue),
        modeId: mode.id,
        reference: p.reference ?? null,
        note: `Table deposit — ${outlet.name}, ${whenOf(r)}`,
      },
      { system: true, source: { type: 'reservation', id: r.id } },
    );
    const paid = { ...r, depositState: 'PAID' };
    const status = r.status === 'REQUESTED' ? move(paid, 'confirm', 'staff', outlet) : r.status;
    const after = await tx.reservation.update({
      where: { id },
      data: { depositState: 'PAID', depositBillId: advance.id, status },
    });
    await writeAudit(tx, ctx, {
      action: 'reservation.deposit_paid',
      entityType: 'reservation',
      entityId: id,
      after: { amount: Number(r.depositDue), advance: advance.number, status },
    });
    if (status !== r.status) await tellGuest(tx, ctx, 'reservation.confirmed', outlet, after, guest);
    return after;
  });
  return viewOf(db, row);
}

/**
 * Give a deposit back: the ADVANCE paper is voided with the reason. One that is owed back (cancelled in time)
 * any host may return; one the rules keep needs an approver's goodwill.
 */
export async function refundDeposit(db: Db, actor: Actor, id: string, input: { reason?: string | null }) {
  host(actor);
  const r = await load(db, actor.companyId, id);
  const outlet = await staffOutlet(db, actor, r.outletId);
  if (!r.depositBillId || !['REFUND_DUE', 'KEPT'].includes(r.depositState ?? ''))
    throw new AppError(409, 'CONFLICT', 'There is no deposit to give back on this booking');
  if (r.depositState === 'KEPT') {
    if (!(await isApprover(db, actor, (await hospOf(db, actor.companyId)).rules)))
      throw new AppError(403, 'FORBIDDEN', 'The rules keep this deposit — an approver may return it');
  }
  const reason = input.reason?.trim() || `Deposit returned — booking ${whenOf(r)} at ${outlet.name}`;
  await voidBill(
    db,
    { ...actor, permissions: [...actor.permissions, 'money.edit'] } as Actor,
    r.depositBillId,
    reason,
  );
  const row = await db.$transaction(async (tx) => {
    const after = await tx.reservation.update({ where: { id }, data: { depositState: 'REFUNDED' } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'reservation.deposit_refunded',
      entityType: 'reservation',
      entityId: id,
      before: { deposit: r.depositState },
      after: { deposit: 'REFUNDED', reason },
    });
    return after;
  });
  return viewOf(db, row);
}

/** An outlet's booking rules: only the parts sent change. Opening the public page gives the outlet its link. */
export async function saveBooking(
  db: Db,
  actor: Actor,
  outletId: string,
  input: z.input<typeof bookingPatchSchema>,
) {
  need(actor, 'hosp.edit', "You can't change hospitality set-up");
  const outlet = await staffOutlet(db, actor, outletId);
  const next = bookingSchema.parse({ ...outlet.booking, ...bookingPatchSchema.parse(input) });
  const token = outlet.bookingToken ?? (next.online ? newToken() : null);
  await db.$transaction(async (tx) => {
    await tx.outlet.update({ where: { id: outletId }, data: { booking: next, bookingToken: token } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'reservation.rules_saved',
      entityType: 'outlet',
      entityId: outletId,
      before: outlet.booking,
      after: next,
    });
  });
  return { booking: next, bookingToken: token };
}

/** The guest's own link: what they booked, and cancelling it. */
export async function byToken(db: Db, token: string) {
  const r = await db.reservation.findUnique({ where: { token } });
  const outlet = r ? await resOutlet(db, { id: r.outletId, companyId: r.companyId }) : null;
  if (!r || !outlet) throw notFound('Booking');
  return { r, outlet };
}
