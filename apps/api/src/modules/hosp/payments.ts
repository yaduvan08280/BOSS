import type { Db, Tx } from '@mono/db';
import { checkMachine, orderMachine, paymentSchema, transition, type CheckStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { createBillIn, voidBill } from '../money/bills';
import { chargeRoom, roomTarget, unchargeRoom, type RoomTarget } from '../hotel/pos-hook';
import { releaseCredit } from '../money/credit';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { checkView, creditOf, type Payment } from './checks-read';
import { isApprover, loadOrder, needOpenDay, type PosOutlet } from './pos-core';
import { settleOrder } from './settle';

/**
 * Phase 15 — taking money, and what follows. A bill may be paid by several modes; a mode that needs a reference
 * refuses without one. A room charge is taken against a room number; company credit leaves the invoice owed by
 * that company (it shows in receivables). When an order's last check is settled its items take their recipes
 * from the outlet's stock.
 */

export async function payCheck(db: Db, actor: Actor, checkId: string, input: z.input<typeof paymentSchema>) {
  need(actor, 'hosp.create', "You can't take payments");
  const p = paymentSchema.parse(input);
  const check = await db.posCheck.findFirst({ where: { id: checkId, companyId: actor.companyId } });
  if (!check) throw notFound('Bill');
  const { order, outlet } = await loadOrder(db, actor, check.orderId);
  if (check.status !== 'OPEN')
    throw new AppError(
      409,
      'CONFLICT',
      check.status === 'PAID' ? 'This bill is already paid' : 'This bill is cancelled',
    );
  await needOpenDay(db, outlet, check.businessDay);
  const modes = new Map(
    (
      await db.paymentMode.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: p.payments.map((x) => x.modeId) },
          deletedAt: null,
          active: true,
        },
      })
    ).map((m) => [m.id, m]),
  );
  const bill = await db.bill.findUniqueOrThrow({ where: { id: check.billId } });
  const due = Number(bill.total - bill.credited - bill.settled) - creditOf(check.payments);
  if (p.payments.reduce((n, x) => n + x.amount, 0) > due)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `Only ${(due / 100).toFixed(2)} is left to pay on this bill`,
    );
  const rooms = new Map<(typeof p.payments)[number], RoomTarget>();
  for (const x of p.payments) {
    const mode = modes.get(x.modeId);
    if (!mode) throw new AppError(400, 'VALIDATION_FAILED', 'That way of paying is not set up');
    if (mode.needsRef && !x.reference)
      throw new AppError(400, 'VALIDATION_FAILED', `${mode.name} needs a reference`);
    if (mode.kind === 'ROOM') {
      const roomNo = x.reference ?? order.roomNo;
      if (!roomNo) throw new AppError(400, 'VALIDATION_FAILED', 'A room charge needs the room number');
      // At a hotel the bill goes on the folio of whoever is in that room (nobody there → refused).
      const target = await roomTarget(db, actor.companyId, outlet.branchId, roomNo);
      if (target) rooms.set(x, target);
    }
    if (mode.kind === 'COMPLIMENTARY')
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        'A complimentary bill is made no-charge with a reason, not paid',
      );
    if (mode.kind === 'COMPANY' && bill.partyId === `walkin_${actor.companyId}`)
      throw new AppError(409, 'CONFLICT', 'Company credit needs the bill to be in the company’s name');
  }
  const ctx = ctxOf(actor);
  const orderStatus = await db.$transaction(async (tx) => {
    const taken: Payment[] = [...((check.payments as Payment[] | null) ?? [])];
    // Receipts are made LAST (below): a receipt takes the next number of its series, and that series stays
    // locked until this transaction ends — so everything that does not need the number (the room's folio, the
    // order, the stock) is done first and other cashiers wait as briefly as possible.
    const receipts: { at: number; amount: number; modeId: string; reference: string | null }[] = [];
    for (const x of p.payments) {
      const mode = modes.get(x.modeId)!;
      const room = rooms.get(x);
      const folioLineId = room
        ? await chargeRoom(tx, ctx, room, {
            checkId: check.id,
            number: check.number,
            outlet: outlet.name,
            amount: x.amount,
          })
        : undefined;
      const reference = x.reference ?? (mode.kind === 'ROOM' ? order.roomNo : null) ?? null;
      // Company credit is not money in: the invoice stays owed by the company (receivables). Nor is a bill sent
      // to a hotel room: it is paid with the folio at check-out.
      if (mode.kind !== 'COMPANY' && !room)
        receipts.push({ at: taken.length, amount: x.amount, modeId: mode.id, reference });
      taken.push({
        modeId: mode.id,
        mode: mode.name,
        kind: mode.kind,
        amount: x.amount,
        reference,
        receiptId: null,
        ...(room ? { stayId: room.stayId, folioLineId } : {}),
        byId: actor.userId,
        at: new Date().toISOString(),
      });
    }
    const tips = [
      ...((check.tips as { amount: number; stewardId: string | null; modeId: string | null }[] | null) ?? []),
    ];
    if (p.tip)
      tips.push({
        amount: p.tip.amount,
        stewardId: p.tip.stewardId ?? order.stewardId,
        modeId: p.tip.modeId ?? null,
      });
    // What will be left once the receipts below are set against the invoice (checked again after they are).
    const before = await tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
    const left =
      Number(before.total - before.credited - before.settled) -
      receipts.reduce((n, r) => n + r.amount, 0) -
      creditOf(taken);
    const status = transition(checkMachine, {
      from: check.status as CheckStatus,
      action: 'settle',
      roles: ['cashier'],
      ctx: { due: left },
    }).to;
    await tx.posCheck.update({
      where: { id: check.id },
      data: { payments: taken, tips, status, ...(status === 'PAID' ? { paidAt: new Date() } : {}) },
    });
    await writeAudit(tx, ctx, {
      action: 'pos.check_paid',
      entityType: 'pos_check',
      entityId: check.id,
      after: { payments: p.payments, tip: p.tip ?? null, status },
    });
    const orderStatus = status === 'PAID' ? await settleOrder(tx, actor, outlet, order.id) : order.status;
    // Each receipt takes its number as the very last thing it does (`finishIssue`); what this payment still
    // has to do — note the receipt on the check, and make sure the invoice is settled as counted on above —
    // is handed over to run just before the last receipt's number, so only the commit follows it.
    for (const [i, r] of receipts.entries()) {
      await createBillIn(
        tx,
        actor,
        {
          type: 'RECEIPT',
          partyId: bill.partyId,
          date: check.businessDay,
          branchId: outlet.branchId,
          lines: [],
          charges: [],
          discount: 0,
          taxInclusive: false,
          amount: r.amount,
          modeId: r.modeId,
          reference: r.reference,
        },
        {
          system: true,
          allocate: [{ billId: bill.id, amount: r.amount }],
          source: { type: 'pos_payment', id: check.id },
          beforeNumber: async (receipt) => {
            taken[r.at]!.receiptId = receipt.id;
            if (i < receipts.length - 1) return;
            // The receipts must have settled exactly what was counted on above; anything else undoes the payment.
            const after = await tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
            if (Number(after.total - after.credited - after.settled) - creditOf(taken) !== left)
              throw new AppError(409, 'CONFLICT', 'This bill changed while it was being paid. Try again.');
            await tx.posCheck.update({ where: { id: check.id }, data: { payments: taken } });
          },
        },
      );
    }
    return orderStatus;
  });
  // Read back after the transaction has ended: the receipt series is free again by then.
  return { ...(await checkView(db, outlet, checkId)), orderStatus };
}

/** Cancel a bill (in the caller's transaction): its receipts are voided, a credit note undoes the invoice, the table is open again. */
export async function cancelCheckIn(
  tx: Tx,
  actor: Actor,
  outlet: PosOutlet,
  checkId: string,
  reason: string,
  approvedById: string,
) {
  const check = await tx.posCheck.findUniqueOrThrow({ where: { id: checkId } });
  const status = transition(checkMachine, {
    from: check.status as CheckStatus,
    action: 'cancel',
    roles: ['approver'],
    ctx: { due: 0 },
  }).to;
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: check.billId } });
  const open = Number(bill.total - bill.credited);
  let creditNoteId: string | null = null;
  if (open > 0)
    creditNoteId = (
      await createBillIn(
        tx,
        actor,
        {
          type: 'CREDIT_NOTE',
          partyId: bill.partyId,
          date: check.businessDay,
          branchId: outlet.branchId,
          againstId: bill.id,
          lines: [{ item: `Bill ${check.number} cancelled`, qty: 1, rate: open }],
          charges: [],
          discount: 0,
          taxInclusive: false,
          note: reason,
        },
        { issue: true, system: true, source: { type: 'pos_check_cancel', id: check.id } },
      )
    ).id;
  await tx.posCheck.update({
    where: { id: checkId },
    data: { status, cancelReason: reason, cancelledById: approvedById, creditNoteId },
  });
  const order = await tx.posOrder.findUniqueOrThrow({ where: { id: check.orderId } });
  if (
    order.status === 'BILLED' &&
    !(await tx.posCheck.count({ where: { orderId: order.id, status: { not: 'CANCELLED' } } }))
  )
    await tx.posOrder.update({
      where: { id: order.id },
      data: {
        status: transition(orderMachine, {
          from: 'BILLED',
          action: 'reopen',
          roles: ['system'],
          ctx: { fired: true, allPaid: false },
        }).to,
      },
    });
  await writeAudit(tx, ctxOf(actor), {
    action: 'pos.check_cancelled',
    entityType: 'pos_check',
    entityId: checkId,
    after: { reason, approvedById, creditNoteId },
  });
}

export const cancelSchema = z.object({ reason: z.string().trim().min(3).max(200) });
/** Cancel a bill: only with an approver's yes and a reason. Money already taken on it is voided first (a refund). */
export async function cancelCheck(
  db: Db,
  actor: Actor,
  checkId: string,
  input: z.input<typeof cancelSchema>,
) {
  need(actor, 'hosp.create', "You can't change bills");
  const { reason } = cancelSchema.parse(input);
  const check = await db.posCheck.findFirst({ where: { id: checkId, companyId: actor.companyId } });
  if (!check) throw notFound('Bill');
  const { order, outlet } = await loadOrder(db, actor, check.orderId);
  if (check.status === 'CANCELLED') throw new AppError(409, 'CONFLICT', 'This bill is already cancelled');
  if (order.status === 'PAID')
    throw new AppError(
      409,
      'CONFLICT',
      'The order is closed: its stock is already taken. Raise a credit note in Money instead',
    );
  await needOpenDay(db, outlet, check.businessDay);
  if (!(await isApprover(db, actor, outlet.rules))) {
    const approval = await db.posApproval.create({
      data: {
        companyId: actor.companyId,
        outletId: outlet.id,
        orderId: order.id,
        kind: 'CANCEL_BILL',
        ask: { checkId, number: check.number, total: Number(check.total), reason },
        askedById: actor.userId,
      },
    });
    return { pending: true, approvalId: approval.id };
  }
  await refund(db, actor, check.payments);
  await db.$transaction((tx) => cancelCheckIn(tx, actor, outlet, checkId, reason, actor.userId));
  return { pending: false, status: 'CANCELLED' };
}
/** Money taken on a bill that is being cancelled is voided in the money core (which puts back what it settled). */
export async function refund(db: Db, actor: Actor, payments: unknown) {
  const accounts = { ...actor, permissions: [...actor.permissions, 'money.edit'] } as Actor;
  for (const p of (payments as Payment[] | null) ?? []) {
    // A deposit that was used on the bill is not money to hand back here: it is the guest's unused advance again.
    if (p.advanceId && p.billId) {
      const { advanceId, billId } = p;
      await db.$transaction(async (tx) => {
        await releaseCredit(tx, actor.companyId, advanceId, billId);
        await tx.reservation.updateMany({
          where: { companyId: actor.companyId, depositBillId: advanceId, depositState: 'USED' },
          data: { depositState: 'PAID' },
        });
      });
    } else if (p.folioLineId) {
      const { folioLineId } = p;
      await db.$transaction((tx) => unchargeRoom(tx, folioLineId));
    } else if (p.receiptId) await voidBill(db, accounts, p.receiptId, 'Bill cancelled');
  }
}
