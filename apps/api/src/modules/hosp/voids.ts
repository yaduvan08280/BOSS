import { Prisma, type Db, type Tx } from '@mono/db';
import {
  explode,
  kotMachine,
  orderItemMachine,
  transition,
  type ItemStatus,
  type KotStatus,
  stockPlaceFor,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { applyMove } from '../ims/moves';
import { booksOf } from '../ims/recipes';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { isApprover, loadOrder, needOpenDay, posOutlet, roleIdOf, type PosOutlet } from './pos-core';

/**
 * Phase 15 — voids. An item that was never sent to the kitchen is simply taken off. One that was fired needs a
 * reason; above the role's limit it waits for an approver. A dish that was already cooked is written off as
 * waste (its ingredients leave the outlet's stock); one cancelled before cooking takes nothing.
 */
export const voidSchema = z.object({
  reason: z.string().trim().max(200).nullish(),
  cooked: z.boolean().default(false),
});
type Ask = { reason: string; cooked: boolean; askedById: string; askedAt: string };

export async function applyVoid(
  tx: Tx,
  actor: Actor,
  outlet: PosOutlet,
  itemId: string,
  reason: string | null,
  cooked: boolean,
  approvedById?: string,
) {
  const item = await tx.posOrderItem.findUniqueOrThrow({ where: { id: itemId } });
  const to = transition(orderItemMachine, {
    from: item.status as ItemStatus,
    action: 'void',
    roles: ['manager'],
    ctx: {},
  }).to;
  await tx.posOrderItem.update({
    where: { id: itemId },
    data: {
      status: to,
      voidReason: reason,
      voidById: approvedById ?? actor.userId,
      voidAsk: Prisma.DbNull,
      cooked,
    },
  });
  // Cooked, then cancelled: the ingredients are gone — they leave stock as a returned dish.
  if (cooked && item.stockItemId) {
    const books = await booksOf(tx, actor.companyId);
    const stock = books.items.get(item.stockItemId);
    const qty = Number(item.qty) * Number(item.factor);
    let needs: Map<string, number>;
    try {
      needs =
        stock?.made === 'DISH' ? explode(books, item.stockItemId, qty) : new Map([[item.stockItemId, qty]]);
    } catch {
      needs = new Map();
    }
    const place = stockPlaceFor(outlet, item.category);
    for (const [stockId, n] of needs) {
      const held = await tx.stockBalance.aggregate({
        where: { itemId: stockId, locationId: place, qty: { gt: 0 } },
        _sum: { qty: true },
      });
      if (Number(held._sum.qty ?? 0) + 1e-9 < n) continue;
      await applyMove(tx, ctxOf(actor), {
        itemId: stockId,
        type: 'ADJUST',
        delta: -Math.round(n * 1000) / 1000,
        reason: 'RETURNED_DISH',
        refType: 'wastage',
        refId: item.orderId,
        locationId: place,
        note: `Voided: ${item.name}`,
        allowExpired: true,
      });
    }
  }
  // A ticket with nothing left on it is cancelled.
  if (item.kotId) {
    const left = await tx.posOrderItem.count({ where: { kotId: item.kotId, status: { not: 'VOID' } } });
    const kot = await tx.kot.findUniqueOrThrow({ where: { id: item.kotId } });
    if (left === 0 && (kot.status === 'NEW' || kot.status === 'READY'))
      await tx.kot.update({
        where: { id: kot.id },
        data: {
          status: transition(kotMachine, {
            from: kot.status as KotStatus,
            action: 'cancel',
            roles: ['system'],
            ctx: {},
          }).to,
        },
      });
  }
  await writeAudit(tx, ctxOf(actor), {
    action: 'pos.item_voided',
    entityType: 'pos_order_item',
    entityId: itemId,
    after: {
      reason,
      cooked,
      approvedById: approvedById ?? null,
      value: Math.round(Number(item.qty) * Number(item.price)),
    },
  });
}

export async function voidItem(
  db: Db,
  actor: Actor,
  orderId: string,
  itemId: string,
  input: z.input<typeof voidSchema> = {},
) {
  need(actor, 'hosp.create', "You can't change orders");
  const v = voidSchema.parse(input);
  const { order, outlet } = await loadOrder(db, actor, orderId);
  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Item');
  if (order.status !== 'OPEN')
    throw new AppError(409, 'CONFLICT', 'This order is already billed: cancel the bill first');
  if (item.status === 'VOID') throw new AppError(409, 'CONFLICT', 'That item is already voided');
  await needOpenDay(db, outlet, order.businessDay);
  const fired = item.status !== 'HELD';
  if (fired && !v.reason) throw new AppError(400, 'VALIDATION_FAILED', 'Say why it is being voided');
  const value = Math.round(Number(item.qty) * Number(item.price));
  const roleId = await roleIdOf(db, actor);
  const allowed =
    !fired ||
    (await isApprover(db, actor, outlet.rules)) ||
    value <= (outlet.rules.limits.find((l) => l.roleId === roleId)?.voidPaise ?? 0);
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    if (allowed) {
      await applyVoid(tx, actor, outlet, itemId, v.reason ?? null, fired && v.cooked);
      return { id: itemId, status: 'VOID', pending: false };
    }
    const ask: Ask = {
      reason: v.reason!,
      cooked: v.cooked,
      askedById: actor.userId,
      askedAt: new Date().toISOString(),
    };
    await tx.posOrderItem.update({ where: { id: itemId }, data: { voidAsk: ask } });
    const approval = await tx.posApproval.create({
      data: {
        companyId: actor.companyId,
        outletId: outlet.id,
        orderId,
        kind: 'VOID',
        ask: { itemId, name: item.name, qty: Number(item.qty), value, ...ask },
        askedById: actor.userId,
      },
    });
    await emitEvent(tx, ctx, {
      name: 'pos.approval_asked',
      entityType: 'pos_approval',
      entityId: approval.id,
      payload: {
        kind: 'VOID',
        outletId: outlet.id,
        branchId: outlet.branchId,
        approverIds: outlet.rules.approverIds,
        what: `${item.name} × ${Number(item.qty)}`,
        reason: v.reason,
        link: '/hosp/pos',
      },
    });
    return { id: itemId, status: item.status, pending: true, approvalId: approval.id };
  });
}

/** What waits for an approver at an outlet (voids, discounts, bill cancellations). */
export async function listApprovals(db: Db, actor: Actor, outletId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await posOutlet(db, actor, outletId);
  const rows = await db.posApproval.findMany({
    where: { companyId: actor.companyId, outletId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  const may = await isApprover(db, actor, outlet.rules);
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: rows.map((r) => r.askedById) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    orderId: r.orderId,
    ask: r.ask,
    askedBy: names.get(r.askedById) ?? '',
    createdAt: r.createdAt,
    canDecide: may && r.askedById !== actor.userId,
  }));
}

/** The void report of a business day: what was voided, by whom, why, whether it was cooked, what it was worth. */
export async function voidReport(db: Db, actor: Actor, outletId: string, businessDay: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  await posOutlet(db, actor, outletId);
  const items = await db.posOrderItem.findMany({
    where: {
      companyId: actor.companyId,
      status: 'VOID',
      firedAt: { not: null },
      order: { outletId, businessDay },
    },
    include: { order: { select: { number: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: items.map((i) => i.voidById).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const rows = items.map((i) => ({
    order: i.order.number,
    name: i.name,
    qty: Number(i.qty),
    value: Math.round(Number(i.qty) * Number(i.price)),
    reason: i.voidReason,
    cooked: i.cooked,
    by: i.voidById ? (names.get(i.voidById) ?? '') : '',
  }));
  return { rows, count: rows.length, value: rows.reduce((n, r) => n + r.value, 0) };
}
