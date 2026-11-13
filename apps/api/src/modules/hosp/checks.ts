import type { Db, Tx } from '@mono/db';
import {
  checkSchema,
  discountDecision,
  mayNc,
  orderMachine,
  splitEqually,
  splitSchema,
  transition,
} from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { createBillIn } from '../money/bills';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import {
  firedCount,
  isApprover,
  live,
  loadOrder,
  needOpenDay,
  roleIdOf,
  walkIn,
  type LoadedOrder,
  type PosOutlet,
} from './pos-core';
import { billLines, checkView } from './checks-read';
import { queuePrint } from './print';

/**
 * Phase 15 — checks. Billing an order makes its check: one invoice in the money core with each item's tax, the
 * outlet's charges (a service charge the guest may refuse), any discount, and the round-off. An order can be
 * split into several checks by item or by seat, or stay one bill paid in equal parts or given amounts.
 */
const cashier = (a: Actor) => need(a, 'hosp.create', "You can't make bills");

export async function splitOrder(db: Db, actor: Actor, orderId: string, input: z.input<typeof splitSchema>) {
  cashier(actor);
  const s = splitSchema.parse(input);
  const { order } = await loadOrder(db, actor, orderId);
  if (order.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This order is already billed');
  const items = live(order);
  await db.$transaction(async (tx) => {
    if (s.by === 'ITEM') {
      for (const x of s.items)
        if (!items.some((i) => i.id === x.itemId))
          throw new AppError(400, 'VALIDATION_FAILED', 'An item is not on this order');
      await tx.posOrderItem.updateMany({ where: { orderId }, data: { checkNo: 1 } });
      for (const x of s.items)
        await tx.posOrderItem.update({ where: { id: x.itemId }, data: { checkNo: x.check } });
      await tx.posOrder.update({ where: { id: orderId }, data: { split: { by: 'ITEM' } } });
    } else if (s.by === 'SEAT') {
      if (!items.some((i) => i.seat)) throw new AppError(409, 'CONFLICT', 'No item has a seat number');
      for (const i of items)
        await tx.posOrderItem.update({ where: { id: i.id }, data: { checkNo: i.seat ?? 1 } });
      await tx.posOrder.update({ where: { id: orderId }, data: { split: { by: 'SEAT' } } });
    } else {
      // One bill, paid in parts: the parts are worked out when the bill is made.
      await tx.posOrderItem.updateMany({ where: { orderId }, data: { checkNo: 1 } });
      await tx.posOrder.update({ where: { id: orderId }, data: { split: s } });
    }
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.order_split',
      entityType: 'pos_order',
      entityId: orderId,
      after: s,
    });
  });
  const after = await loadOrder(db, actor, orderId);
  return { checks: [...new Set(live(after.order).map((i) => i.checkNo))].sort((a, b) => a - b) };
}

type Disc = { key?: string | null; kind: 'PERCENT' | 'AMOUNT'; value: number; reason?: string | null };
/** Make the bill of one check — in the caller's transaction, so an approved discount is applied the same way. */
export async function makeCheckIn(
  tx: Tx,
  actor: Actor,
  outlet: PosOutlet,
  order: LoadedOrder,
  c: z.infer<typeof checkSchema>,
  approvedById?: string,
) {
  const items = live(order).filter((i) => i.checkNo === c.check);
  if (!items.length) throw new AppError(409, 'CONFLICT', 'There is nothing on that check');
  if (items.some((i) => i.status === 'HELD'))
    throw new AppError(409, 'CONFLICT', 'Some items are still held: fire them or take them off first');
  if (items.some((i) => i.voidAsk))
    throw new AppError(409, 'CONFLICT', 'A void on this check is waiting for approval');
  if (
    await tx.posCheck.count({ where: { orderId: order.id, checkNo: c.check, status: { not: 'CANCELLED' } } })
  )
    throw new AppError(409, 'CONFLICT', 'That check is already billed');
  const subtotal = items.reduce((n, i) => n + (i.nc ? 0 : Math.round(Number(i.qty) * Number(i.price))), 0);
  const d = c.ncReason ? null : (c.discount as Disc | null | undefined);
  const discount = c.ncReason
    ? subtotal
    : d
      ? Math.min(
          subtotal,
          d.kind === 'PERCENT' ? Math.round((subtotal * d.value) / 100) : Math.round(d.value),
        )
      : 0;
  // The service charge is on what is charged for food and drink; the guest may refuse it. It is for table and
  // room service — not for takeaway, delivery, staff meals or a counter sale.
  const served = order.type === 'DINE_IN' || order.type === 'ROOM_SERVICE';
  const service =
    served && !c.noServiceCharge && !c.ncReason
      ? Math.round(((subtotal - discount) * outlet.charges.serviceChargePct) / 100)
      : 0;
  const charges = [
    ...(service ? [{ name: `Service charge ${outlet.charges.serviceChargePct}%`, amount: service }] : []),
    ...((order.type === 'TAKEAWAY' || order.type === 'DELIVERY') &&
    outlet.charges.packagingPaise &&
    !c.ncReason
      ? [{ name: 'Packaging', amount: outlet.charges.packagingPaise }]
      : []),
    ...(order.type === 'DELIVERY' && outlet.charges.deliveryPaise && !c.ncReason
      ? [{ name: 'Delivery', amount: outlet.charges.deliveryPaise }]
      : []),
  ].map((x) => ({ ...x, taxCode: outlet.charges.chargeTaxCode ?? null }));
  const partyId = c.partyId ?? order.partyId ?? (await walkIn(tx, actor.companyId)).id;
  // A number from the device's reserved block is used once.
  if (c.number) {
    const device = await tx.posDevice.findFirst({
      where: { companyId: actor.companyId, outletId: outlet.id, numbers: { has: c.number } },
    });
    if (!device)
      throw new AppError(409, 'CONFLICT', `${c.number} is not a number reserved for a device of this outlet`);
    await tx.posDevice.update({
      where: { id: device.id },
      data: { numbers: device.numbers.filter((n) => n !== c.number) },
    });
  }
  const bill = await createBillIn(
    tx,
    actor,
    {
      type: 'INVOICE',
      partyId,
      date: order.businessDay,
      branchId: outlet.branchId,
      lines: items.map((i) => ({
        item: i.variantName ? `${i.name} (${i.variantName})` : i.name,
        hsn: i.hsn ?? undefined,
        qty: Number(i.qty),
        rate: Number(i.price),
        ...(i.nc ? { discount: Math.round(Number(i.qty) * Number(i.price)) } : {}),
        ...(i.taxCode ? { taxCode: i.taxCode } : {}),
      })),
      charges,
      discount,
      taxInclusive: false,
      note: `${outlet.name} · order ${order.number}${c.ncReason ? ` · no charge: ${c.ncReason}` : ''}`,
    },
    {
      issue: true,
      system: true,
      ...(c.number ? { number: c.number } : {}),
      source: { type: 'pos_check', id: order.id },
    },
  );
  const total = Number(bill.total);
  const split = order.split as { by?: string; parts?: number; amounts?: number[] } | null;
  let parts: number[] | null = null;
  if (split?.by === 'EQUAL' && split.parts) parts = splitEqually(total, split.parts);
  if (split?.by === 'AMOUNT' && split.amounts) {
    if (split.amounts.reduce((a, b) => a + b, 0) !== total)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `The amounts must add up to the bill (${(total / 100).toFixed(2)})`,
      );
    parts = split.amounts;
  }
  const check = await tx.posCheck.create({
    data: {
      companyId: actor.companyId,
      outletId: outlet.id,
      orderId: order.id,
      checkNo: c.check,
      businessDay: order.businessDay,
      // A bill of nothing (no-charge) is settled as it is made.
      status: total === 0 ? 'PAID' : 'OPEN',
      billId: bill.id,
      number: bill.number!,
      total: BigInt(total),
      serviceCharge: BigInt(service),
      discount:
        discount && !c.ncReason
          ? { ...d, amount: discount, byId: actor.userId, approvedById: approvedById ?? null }
          : undefined,
      ncReason: c.ncReason ?? null,
      parts: parts ?? undefined,
      printed: 1,
      createdById: actor.userId,
      ...(total === 0 ? { paidAt: new Date() } : {}),
    },
  });
  if (order.status === 'OPEN')
    await tx.posOrder.update({
      where: { id: order.id },
      data: {
        status: transition(orderMachine, {
          from: 'OPEN',
          action: 'bill',
          roles: ['cashier'],
          ctx: { fired: firedCount(order) > 0, allPaid: false },
        }).to,
      },
    });
  await queuePrint(
    tx,
    actor.companyId,
    outlet.billPrinterId,
    'BILL',
    check.id,
    billLines(
      outlet,
      { number: check.number, total },
      order,
      items.map((i) => ({
        name: i.name,
        qty: Number(i.qty),
        amount: i.nc ? 0 : Math.round(Number(i.qty) * Number(i.price)),
      })),
      [
        ...charges.map((x): [string, number] => [x.name, x.amount]),
        ...(discount ? [['Discount', -discount] as [string, number]] : []),
        ['Tax', Number(bill.tax)],
      ],
      false,
    ),
  );
  await writeAudit(tx, ctxOf(actor), {
    action: 'pos.check_made',
    entityType: 'pos_check',
    entityId: check.id,
    after: {
      number: check.number,
      total,
      discount,
      service,
      nc: c.ncReason ?? null,
      approvedById: approvedById ?? null,
    },
  });
  return check;
}

/** Bill a check. A discount above the person's limit (or a no-charge they may not give) waits for an approver. */
export async function makeCheck(
  db: Db,
  actor: Actor,
  orderId: string,
  input: z.input<typeof checkSchema> = {},
) {
  cashier(actor);
  const c = checkSchema.parse(input);
  const { order, outlet } = await loadOrder(db, actor, orderId);
  if (order.status !== 'OPEN' && order.status !== 'BILLED')
    throw new AppError(409, 'CONFLICT', 'This order is closed');
  await needOpenDay(db, outlet, order.businessDay);
  if (
    c.partyId &&
    !(await db.party.count({ where: { id: c.partyId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Party');
  if (c.ncReason && !outlet.rules.ncReasons.includes(c.ncReason))
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose one of the no-charge reasons');
  const approver = await isApprover(db, actor, outlet.rules);
  const roleId = await roleIdOf(db, actor);
  const subtotal = live(order)
    .filter((i) => i.checkNo === c.check)
    .reduce((n, i) => n + Math.round(Number(i.qty) * Number(i.price)), 0);
  let needs = false;
  if (c.ncReason) needs = !approver && !mayNc(outlet.rules, roleId);
  else if (c.discount) {
    const amount =
      c.discount.kind === 'PERCENT'
        ? Math.round((subtotal * c.discount.value) / 100)
        : Math.round(c.discount.value);
    const pct = subtotal > 0 ? (amount / subtotal) * 100 : 0;
    needs = !approver && discountDecision(outlet.rules, roleId, { pct, paise: amount }) === 'needs_approval';
  }
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    if (needs) {
      const approval = await tx.posApproval.create({
        data: {
          companyId: actor.companyId,
          outletId: outlet.id,
          orderId,
          kind: 'DISCOUNT',
          ask: { check: c, subtotal },
          askedById: actor.userId,
        },
      });
      await emitEvent(tx, ctx, {
        name: 'pos.approval_asked',
        entityType: 'pos_approval',
        entityId: approval.id,
        payload: {
          kind: 'DISCOUNT',
          outletId: outlet.id,
          branchId: outlet.branchId,
          approverIds: outlet.rules.approverIds,
          what: `Order ${order.number}`,
          reason: c.ncReason ?? c.discount?.reason ?? '',
          link: '/hosp/pos',
        },
      });
      return { pending: true as const, approvalId: approval.id };
    }
    const check = await makeCheckIn(tx, actor, outlet, order, c);
    return { pending: false as const, ...(await checkView(tx, outlet, check.id)) };
  });
}
