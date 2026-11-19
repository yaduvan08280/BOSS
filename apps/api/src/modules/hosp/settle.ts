import type { Tx } from '@mono/db';
import {
  explode,
  kotMachine,
  orderMachine,
  stockPlaceFor,
  transition,
  type KotStatus,
  type OrderStatus,
} from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { applyMove } from '../ims/moves';
import { booksOf } from '../ims/recipes';
import type { Actor } from '../work/actor';
import { ctxOf } from './access';
import { finishForOrder } from './res-finish';
import { live, type LoadedOrder, type PosOutlet } from './pos-core';

/**
 * What follows the last payment of an order (decisions 167, 249): the order is PAID, its dishes are served,
 * tickets the kitchen never bumped leave its list, and the recipes' stock leaves the outlet's location.
 */
type Mod = { itemId?: string | null; qty?: number | null; name: string };

/** Stock for a paid order: each item's recipe, and add-ons that carry stock. What the location is short of is noted, never blocking. */
async function consumeOrder(tx: Tx, actor: Actor, outlet: PosOutlet, order: LoadedOrder) {
  const books = await booksOf(tx, actor.companyId);
  const ctx = ctxOf(actor);
  const heldAt = async (itemId: string, locationId: string) =>
    Number(
      (
        await tx.stockBalance.aggregate({
          where: { itemId, locationId, qty: { gt: 0 } },
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
    // A category with a stock route of its own (drinks → the bar) takes from there.
    const place = stockPlaceFor(outlet, i.category);
    for (const [itemId, n] of needs) {
      const qty = Math.round(n * 1000) / 1000;
      if ((await heldAt(itemId, place)) + 1e-9 < qty) {
        short.push(itemId);
        continue;
      }
      await applyMove(tx, ctx, {
        itemId,
        type: 'OUT',
        delta: -qty,
        reason: 'RECIPE',
        locationId: place,
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
    // The food has gone and the bill is paid: tickets the kitchen never bumped leave its "to make" list too
    // (no ready time is made up for them, so the kitchen-times report still counts them as never timed).
    const kotIds = [...new Set(order.items.map((i) => i.kotId).filter((id): id is string => Boolean(id)))];
    const now = new Date();
    for (const k of await tx.kot.findMany({
      where: { id: { in: kotIds }, status: { in: ['NEW', 'READY'] } },
    })) {
      const bumped = transition(kotMachine, {
        from: k.status as KotStatus,
        action: 'bump',
        roles: ['system'],
        ctx: {},
      }).to;
      await tx.kot.update({
        where: { id: k.id },
        data: { status: bumped, bumpedAt: now },
      });
    }
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
