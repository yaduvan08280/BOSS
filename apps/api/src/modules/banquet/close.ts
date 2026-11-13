import type { Db } from '@mono/db';
import { banquetMachine, cancelOutcome, formatINR, transition, type BanquetStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { createBillIn, dueOf, voidBill } from '../money/bills';
import { applyCredit } from '../money/credit';
import type { Actor } from '../work/actor';
import { manager, sales } from './core';
import { advancesOf, eventOf, eventView, rolesOf } from './event-core';

import { mode, modeOf } from './day';

/** Phase 18 — after the event: settling the final bill, feedback, and losing an enquiry or cancelling a booking. */
export const settleSchema = z.object({
  payments: z.array(mode).max(10).default([]),
  /** Leave what is unpaid owed by the company that booked it. */
  onCredit: z.boolean().default(false),
});
/** Take the balance of the final bill; when nothing is left (or a company takes it on credit) the event closes. */
export async function settleEvent(db: Db, actor: Actor, id: string, input: z.input<typeof settleSchema>) {
  sales(actor);
  const p = settleSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  if (event.status !== 'COMPLETED')
    throw new AppError(409, 'CONFLICT', 'The final bill is settled after the event');
  const modes: Awaited<ReturnType<typeof modeOf>>[] = [];
  for (const x of p.payments) modes.push(await modeOf(db, actor, x));
  const guest = await db.guest.findFirstOrThrow({ where: { id: event.guestId } });
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    const bill = event.billId ? await tx.bill.findUniqueOrThrow({ where: { id: event.billId } }) : null;
    let due = bill ? Math.max(0, dueOf(bill)) : 0;
    const paying = p.payments.reduce((n, x) => n + x.amount, 0);
    if (paying > due)
      throw new AppError(400, 'VALIDATION_FAILED', `Only ${formatINR(BigInt(due))} is left to pay`);
    for (const [i, x] of p.payments.entries()) {
      await createBillIn(
        tx,
        actor,
        {
          type: 'RECEIPT',
          partyId: event.partyId,
          date: place.today,
          branchId: place.branchId,
          lines: [],
          charges: [],
          discount: 0,
          taxInclusive: false,
          amount: x.amount,
          modeId: modes[i]!.id,
          reference: x.reference ?? null,
          note: `Banquet ${event.number}`,
        },
        {
          system: true,
          allocate: [{ billId: bill!.id, amount: x.amount }],
          source: { type: 'banquet_bill', id },
        },
      );
      due -= x.amount;
    }
    // A guest pays in full; a company that booked it may be billed on credit.
    if (due > 0 && (!p.onCredit || event.partyId === guest.partyId))
      throw new AppError(400, 'VALIDATION_FAILED', `${formatINR(BigInt(due))} is still to pay`);
    const to = transition(banquetMachine, {
      from: 'COMPLETED',
      action: 'close',
      roles: rolesOf(actor),
      ctx: { advancePaid: true, checked: true, settled: true },
    }).to;
    const after = await tx.banquetEvent.update({ where: { id }, data: { status: to } });
    await writeAudit(tx, ctx, {
      action: 'banquet.closed',
      entityType: 'banquet_event',
      entityId: id,
      before: { status: event.status },
      after: { status: to, paid: paying, onCredit: due },
    });
    return after;
  });
  return eventView(db, place, row);
}

export const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comments: z.string().trim().max(1000).nullish(),
});
export async function saveFeedback(db: Db, actor: Actor, id: string, input: z.input<typeof feedbackSchema>) {
  sales(actor);
  const f = feedbackSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  if (!['COMPLETED', 'CLOSED'].includes(event.status))
    throw new AppError(409, 'CONFLICT', 'Feedback is taken after the event');
  const row = await db.$transaction(async (tx) => {
    const after = await tx.banquetEvent.update({
      where: { id },
      data: {
        feedback: {
          rating: f.rating,
          comments: f.comments ?? null,
          at: new Date().toISOString(),
          byId: actor.userId,
        },
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'banquet.feedback',
      entityType: 'banquet_event',
      entityId: id,
      after: f,
    });
    return after;
  });
  return eventView(db, place, row);
}

export const endSchema = z.object({ reason: z.string().trim().min(3).max(300) });
/**
 * An enquiry that went elsewhere is lost (any advance on it is returned). A confirmed booking is cancelled by a
 * manager: in time the advance is returned; later it is kept — invoiced as the cancellation charge.
 */
export async function endEvent(db: Db, actor: Actor, id: string, input: z.input<typeof endSchema>) {
  sales(actor);
  const { reason } = endSchema.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  const cancelling = event.status === 'CONFIRMED';
  if (cancelling) manager(actor);
  const to = transition(banquetMachine, {
    from: event.status as BanquetStatus,
    action: cancelling ? 'cancel' : 'lose',
    roles: rolesOf(actor),
    ctx: { advancePaid: true, checked: true, settled: true },
  }).to;
  const { bills, paid } = await advancesOf(db, event);
  const days = Math.round(
    (Date.parse(`${event.day}T00:00:00Z`) - Date.parse(`${place.today}T00:00:00Z`)) / 86_400_000,
  );
  const keep = cancelling && paid > 0 && cancelOutcome(place.rules.banquet, days) === 'KEEP';
  // Returned: each advance paper is voided. (Kept: they pay the cancellation invoice below.)
  if (!keep)
    for (const b of bills)
      await voidBill(
        db,
        { ...actor, permissions: [...actor.permissions, 'money.edit'] } as Actor,
        b.id,
        `Banquet ${event.number}: ${reason}`,
      );
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    let billId: string | null = null;
    if (keep) {
      const invoice = await createBillIn(
        tx,
        actor,
        {
          type: 'INVOICE',
          partyId: event.partyId,
          date: place.today,
          branchId: place.branchId,
          lines: [{ item: `Cancellation charge — banquet ${event.number}`, qty: 1, rate: paid }],
          charges: [],
          discount: 0,
          taxInclusive: true,
          note: reason,
        },
        { issue: true, system: true, source: { type: 'banquet_bill', id } },
      );
      for (const b of bills) await applyCredit(tx, actor.companyId, b.id, invoice.id, Number(b.total));
      billId = invoice.id;
    }
    const after = await tx.banquetEvent.update({
      where: { id },
      data: { status: to, closeReason: reason, ...(billId ? { billId } : {}) },
    });
    await writeAudit(tx, ctx, {
      action: cancelling ? 'banquet.cancelled' : 'banquet.lost',
      entityType: 'banquet_event',
      entityId: id,
      before: { status: event.status },
      after: { status: to, reason, advance: paid ? (keep ? 'KEPT' : 'RETURNED') : null },
    });
    return after;
  });
  return { ...(await eventView(db, place, row)), advance: paid ? (keep ? 'KEPT' : 'RETURNED') : null };
}
