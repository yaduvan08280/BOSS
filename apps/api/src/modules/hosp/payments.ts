import type { Db, Tx } from '@mono/db';
import {
  checkMachine,
  explode,
  orderMachine,
  paymentSchema,
  transition,
  type CheckStatus,
  type OrderStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { applyMove } from '../ims/moves';
import { booksOf } from '../ims/recipes';
import { createBillIn, voidBill } from '../money/bills';
import { releaseCredit } from '../money/credit';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { checkView, creditOf, type Payment } from './checks-read';
import { finishForOrder } from './res-finish';
import { isApprover, live, loadOrder, needOpenDay, type LoadedOrder, type PosOutlet } from './pos-core';

/**
 * Phase 15 — taking money, and what follows. A bill may be paid by several modes; a mode that needs a reference
 * refuses without one. A room charge is taken against a room number; company credit leaves the invoice owed by
 * that company (it shows in receivables). When an order's last check is settled its items take their recipes
 * from the outlet's stock.
 */
type Mod = { itemId?: string | null; qty?: number | null; name: string };

/** Stock for a paid order: each item's recipe, and add-ons that carry stock. What the location is short of is noted, never blocking. */
async function consumeOrder(tx: Tx, actor: Actor, outlet: PosOutlet, order: LoadedOrder) {
  const books = await booksOf(tx, actor.companyId);
  const ctx = ctxOf(actor);
  const heldAt = async (itemId: string) =>
    Number(
      (
        await tx.stockBalance.aggregate({
          where: { itemId, locationId: outlet.locationId, qty: { gt: 0 } },
          _sum: { qty: true },
        })
      )._sum.qty ?? 0,
    );
  for (const i of live(order)) {
    const needs = new Map<string, number>();
    if (i.stockItemId) {
      const qty = Number(i.qty) * Number(i.factor);
      try {
        const part =
          books.items.get(i.stockItemId)?.made === 'DISH'
            ? explode(books, i.stockItemId, qty)
            : new Map([[i.stockItemId, qty]]);
        for (const [id, n] of part) needs.set(id, (needs.get(id) ?? 0) + n);
      } catch {
        await tx.posOrderItem.update({
          where: { id: i.id },
          data: { stockNote: 'No recipe: stock not taken' },
        });
        continue;
      }
    }
    for (const m of (i.modifiers as Mod[] | null) ?? [])
      if (m.itemId && m.qty) needs.set(m.itemId, (needs.get(m.itemId) ?? 0) + m.qty * Number(i.qty));
    const short: string[] = [];
    for (const [itemId, n] of needs) {
      const qty = Math.round(n * 1000) / 1000;
      if ((await heldAt(itemId)) + 1e-9 < qty) {
        short.push(itemId);
        continue;
      }
      await applyMove(tx, ctx, {
        itemId,
        type: 'OUT',
        delta: -qty,
        reason: 'RECIPE',
        locationId: outlet.locationId,
        refType: 'pos_order',
        refId: order.id,
        note: `Order ${order.number}`,
      });
    }
    if (short.length) {
      const names = await tx.item.findMany({ where: { id: { in: short } }, select: { name: true } });
      await tx.posOrderItem.update({
        where: { id: i.id },
        data: { stockNote: `Short: ${names.map((x) => x.name).join(', ')}` },
      });
    }
  }
}

/** After a check changes: the order is paid when every live item is on a paid check. */
export async function settleOrder(tx: Tx, actor: Actor, outlet: PosOutlet, orderId: string) {
  const order = await tx.posOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  if (order.status !== 'BILLED') return order.status;
  const checks = await tx.posCheck.findMany({ where: { orderId, status: { not: 'CANCELLED' } } });
  const paid = new Set(checks.filter((c) => c.status === 'PAID').map((c) => c.checkNo));
  const allPaid = live(order).every((i) => paid.has(i.checkNo));
  const to = transition(orderMachine, {
    from: order.status as OrderStatus,
    action: 'settle',
    roles: ['system'],
    ctx: { fired: true, allPaid },
  }).to;
  if (to === 'PAID') {
    await tx.posOrder.update({ where: { id: orderId }, data: { status: to, closedAt: new Date() } });
    await tx.posOrderItem.updateMany({
      where: { orderId, status: { in: ['FIRED', 'READY'] } },
      data: { status: 'SERVED' },
    });
    await consumeOrder(tx, actor, outlet, order);
    if (order.reservationId) await finishForOrder(tx, ctxOf(actor), order.reservationId);
    await emitEvent(tx, ctxOf(actor), {
      name: 'pos.order_paid',
      entityType: 'pos_order',
      entityId: orderId,
      payload: { outletId: outlet.id, number: order.number, branchId: outlet.branchId },
    });
  }
  return to;
}

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
  for (const x of p.payments) {
    const mode = modes.get(x.modeId);
    if (!mode) throw new AppError(400, 'VALIDATION_FAILED', 'That way of paying is not set up');
    if (mode.needsRef && !x.reference)
      throw new AppError(400, 'VALIDATION_FAILED', `${mode.name} needs a reference`);
    if (mode.kind === 'ROOM' && !(x.reference ?? order.roomNo))
      throw new AppError(400, 'VALIDATION_FAILED', 'A room charge needs the room number');
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
  return db.$transaction(async (tx) => {
    const taken: Payment[] = [...((check.payments as Payment[] | null) ?? [])];
    for (const x of p.payments) {
      const mode = modes.get(x.modeId)!;
      let receiptId: string | null = null;
      // Company credit is not money in: the invoice stays owed by the company (receivables).
      if (mode.kind !== 'COMPANY') {
        const receipt = await createBillIn(
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
            amount: x.amount,
            modeId: mode.id,
            reference: x.reference ?? (mode.kind === 'ROOM' ? order.roomNo : null),
          },
          {
            system: true,
            allocate: [{ billId: bill.id, amount: x.amount }],
            source: { type: 'pos_payment', id: check.id },
          },
        );
        receiptId = receipt.id;
      }
      taken.push({
        modeId: mode.id,
        mode: mode.name,
        kind: mode.kind,
        amount: x.amount,
        reference: x.reference ?? (mode.kind === 'ROOM' ? order.roomNo : null) ?? null,
        receiptId,
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
    const after = await tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
    const left = Number(after.total - after.credited - after.settled) - creditOf(taken);
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
    return { ...(await checkView(tx, outlet, check.id)), orderStatus };
  });
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
    } else if (p.receiptId) await voidBill(db, accounts, p.receiptId, 'Bill cancelled');
  }
}
