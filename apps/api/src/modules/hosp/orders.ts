import type { Db, Tx } from '@mono/db';
import {
  addItemsSchema,
  orderItemMachine,
  orderMachine,
  orderSchema,
  transition,
  type ItemStatus,
  type OrderItemInput,
  type OrderStatus,
  type PrintLine,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { menuFor } from './menu-read';
import {
  dayAt,
  dayNumber,
  firedCount,
  loadOrder,
  needOpenDay,
  posOutlet,
  type LoadedOrder,
  type PosOutlet,
} from './pos-core';
import { queuePrint } from './print';

/**
 * Phase 15 — orders. A steward opens an order (a table, takeaway, delivery, room service, a staff meal or a plain
 * counter sale), adds items with variants, add-ons, notes, a course and a seat, and fires them: each station gets
 * its own numbered kitchen ticket.
 */
const steward = (a: Actor) => need(a, 'hosp.create', "You can't take orders");
type Mod = {
  groupId: string;
  key: string;
  name: string;
  price: number;
  itemId?: string | null;
  qty?: number | null;
  unit?: string | null;
};

export async function openOrder(db: Db, actor: Actor, input: z.input<typeof orderSchema>) {
  steward(actor);
  const o = orderSchema.parse(input);
  const outlet = await posOutlet(db, actor, o.outletId);
  // The same order sent twice by a device that retried is made once.
  if (o.clientId) {
    const had = await db.posOrder.findUnique({
      where: { companyId_clientId: { companyId: actor.companyId, clientId: o.clientId } },
    });
    if (had) return { id: had.id, number: had.number, businessDay: had.businessDay, again: true };
  }
  const day = dayAt(outlet);
  await needOpenDay(db, outlet, day);
  if (o.type === 'DINE_IN' && !o.tableIds.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose a table');
  if (o.type === 'ROOM_SERVICE' && !o.roomNo)
    throw new AppError(400, 'VALIDATION_FAILED', 'Which room is it for?');
  if (o.tableIds.length) {
    const tables = await db.diningTable.count({
      where: { companyId: actor.companyId, outletId: outlet.id, id: { in: o.tableIds }, deletedAt: null },
    });
    if (tables !== new Set(o.tableIds).size)
      throw new AppError(400, 'VALIDATION_FAILED', 'A table is not one of this outlet’s');
    const busy = await db.posOrder.findFirst({
      where: {
        companyId: actor.companyId,
        outletId: outlet.id,
        status: { in: ['OPEN', 'BILLED'] },
        tableIds: { hasSome: o.tableIds },
      },
    });
    if (busy) throw new AppError(409, 'CONFLICT', 'That table already has an order running');
  }
  if (
    o.partyId &&
    !(await db.party.count({ where: { id: o.partyId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Party');
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const row = await tx.posOrder.create({
      data: {
        companyId: actor.companyId,
        branchId: outlet.branchId,
        outletId: outlet.id,
        number: await dayNumber(tx, actor.companyId, 'order', outlet.id, day),
        businessDay: day,
        type: o.type,
        tableIds: o.tableIds,
        covers: o.covers,
        stewardId: o.stewardId ?? actor.userId,
        guestName: o.guestName ?? null,
        partyId: o.partyId ?? null,
        roomNo: o.roomNo ?? null,
        note: o.note ?? null,
        clientId: o.clientId ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctx, {
      action: 'pos.order_opened',
      entityType: 'pos_order',
      entityId: row.id,
      after: o,
    });
    await emitEvent(tx, ctx, {
      name: 'pos.order_opened',
      entityType: 'pos_order',
      entityId: row.id,
      payload: { outletId: outlet.id, number: row.number, type: o.type, branchId: outlet.branchId },
    });
    return { id: row.id, number: row.number, businessDay: day, again: false };
  });
}

/** A kitchen ticket as print lines. */
export function ticketLines(
  outlet: string,
  kot: { number: number },
  order: { number: number; type: string },
  table: string,
  items: { name: string; qty: number; note: string | null; mods: string[] }[],
  title = 'KOT',
): PrintLine[] {
  return [
    { text: `${title} ${kot.number}`, bold: true, big: true, align: 'center' },
    { cols: [outlet, table || order.type.replace('_', ' ')] },
    { cols: [`Order ${order.number}`, new Date().toISOString().slice(11, 16)] },
    { rule: true },
    ...items.flatMap((i): PrintLine[] => [
      { text: `${i.qty} x ${i.name}`, bold: true },
      ...i.mods.map((m): PrintLine => ({ text: `   + ${m}` })),
      ...(i.note ? [{ text: `   * ${i.note}` } satisfies PrintLine] : []),
    ]),
  ];
}

/** Fire held items: one numbered ticket a station, printed where the station has a printer, shown on its display. */
export async function fireItems(
  tx: Tx,
  actor: Actor,
  outlet: PosOutlet,
  order: LoadedOrder,
  itemIds: string[],
) {
  const items = order.items.filter((i) => itemIds.includes(i.id) && i.status === 'HELD');
  if (!items.length) return [];
  const byStation = new Map<string, typeof items>();
  for (const i of items) byStation.set(i.stationId ?? '', [...(byStation.get(i.stationId ?? '') ?? []), i]);
  const stations = new Map(
    (
      await tx.station.findMany({
        where: { companyId: actor.companyId, outletId: outlet.id, deletedAt: null },
      })
    ).map((s) => [s.id, s]),
  );
  const tables = order.tableIds.length
    ? (await tx.diningTable.findMany({ where: { id: { in: order.tableIds } }, select: { name: true } }))
        .map((t) => t.name)
        .join('+')
    : '';
  const kots = [];
  for (const [stationId, list] of byStation) {
    const kot = await tx.kot.create({
      data: {
        companyId: actor.companyId,
        outletId: outlet.id,
        orderId: order.id,
        stationId: stationId || null,
        number: await dayNumber(tx, actor.companyId, 'kot', outlet.id, order.businessDay),
        businessDay: order.businessDay,
        firedById: actor.userId,
      },
    });
    for (const i of list) {
      const to = transition(orderItemMachine, {
        from: i.status as ItemStatus,
        action: 'fire',
        roles: ['steward'],
        ctx: {},
      }).to;
      await tx.posOrderItem.update({
        where: { id: i.id },
        data: { status: to, kotId: kot.id, firedAt: new Date() },
      });
    }
    await queuePrint(
      tx,
      actor.companyId,
      stations.get(stationId)?.printerId,
      'KOT',
      kot.id,
      ticketLines(
        outlet.name,
        kot,
        order,
        tables,
        list.map((i) => ({
          name: i.variantName ? `${i.name} (${i.variantName})` : i.name,
          qty: Number(i.qty),
          note: i.note,
          mods: ((i.modifiers as Mod[] | null) ?? []).map((m) => m.name),
        })),
      ),
    );
    kots.push({ id: kot.id, number: kot.number, stationId: stationId || null, items: list.length });
  }
  return kots;
}

/** Add items to an order (and fire the ones not held). Prices, stations and tax codes are taken from the menu now. */
export async function addItems(db: Db, actor: Actor, orderId: string, input: z.input<typeof addItemsSchema>) {
  steward(actor);
  const a = addItemsSchema.parse(input);
  const { order, outlet } = await loadOrder(db, actor, orderId);
  if (order.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This order is already billed');
  await needOpenDay(db, outlet, order.businessDay);
  const menu = await menuFor(db, actor, outlet.id);
  const byId = new Map(
    menu.categories.flatMap((c) => c.items.map((i) => [i.id, { item: i, category: c }] as const)),
  );
  const done = new Set(order.items.map((i) => i.clientId).filter(Boolean));
  const fresh = a.items.filter((i) => !i.clientId || !done.has(i.clientId));
  const rows = fresh.map((i: OrderItemInput) => {
    const hit = byId.get(i.menuItemId);
    if (!hit) throw new AppError(400, 'VALIDATION_FAILED', 'An item is not on this outlet’s menu');
    const { item, category } = hit;
    if (!item.available) throw new AppError(409, 'CONFLICT', `${item.name} is not served at this time`);
    const variant = item.variants.length ? item.variants.find((v) => v.key === i.variantKey) : null;
    if (item.variants.length && !variant)
      throw new AppError(400, 'VALIDATION_FAILED', `Choose a size for ${item.name}`);
    if (item.out === 'off' || (variant ? variant.out : item.out === 'stock'))
      throw new AppError(409, 'CONFLICT', `${item.name} is out (${item.outReason ?? 'not available'})`);
    const mods: Mod[] = i.modifiers.map((m) => {
      const group = item.modifierGroups.find((g) => g.id === m.groupId);
      const option = group?.options.find((o) => o.key === m.key);
      if (!group || !option)
        throw new AppError(400, 'VALIDATION_FAILED', `That add-on is not offered with ${item.name}`);
      return {
        groupId: group.id,
        key: option.key,
        name: option.name,
        price: option.price ?? 0,
        itemId: option.itemId,
        qty: option.qty,
        unit: option.unit,
      };
    });
    for (const g of item.modifierGroups) {
      const picked = mods.filter((m) => m.groupId === g.id).length;
      if (picked < g.min || picked > g.max)
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          `${item.name}: pick ${g.min === g.max ? g.min : `${g.min}–${g.max}`} of ${g.name}`,
        );
    }
    return {
      input: i,
      item,
      category,
      variant,
      mods,
      price: (variant?.price ?? item.price) + mods.reduce((n, m) => n + m.price, 0),
    };
  });
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const made: string[] = [];
    for (const r of rows) {
      const stock = await tx.menuItem.findUniqueOrThrow({
        where: { id: r.item.id },
        select: { variants: true },
      });
      const v = (
        (stock.variants as { key: string; itemId?: string | null; factor?: number }[] | null) ?? []
      ).find((x) => x.key === r.variant?.key);
      const row = await tx.posOrderItem.create({
        data: {
          companyId: actor.companyId,
          orderId: order.id,
          menuItemId: r.item.id,
          name: r.item.name,
          category: r.category.name,
          variantKey: r.variant?.key ?? '',
          variantName: r.variant?.name ?? null,
          qty: r.input.qty,
          price: BigInt(r.price),
          modifiers: r.mods,
          note: r.input.note ?? null,
          course: r.input.course ?? null,
          seat: r.input.seat ?? null,
          stationId: r.category.stationId,
          taxCode: r.item.taxCode,
          hsn: r.item.hsn,
          stockItemId: v?.itemId ?? r.item.itemId,
          factor: v?.itemId ? 1 : (v?.factor ?? 1),
          clientId: r.input.clientId ?? null,
          createdById: actor.userId,
        },
      });
      if (!r.input.hold) made.push(row.id);
    }
    const after = await tx.posOrder.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    const kots = a.fire ? await fireItems(tx, actor, outlet, after, made) : [];
    await writeAudit(tx, ctx, {
      action: 'pos.items_added',
      entityType: 'pos_order',
      entityId: order.id,
      after: { items: rows.length, kots: kots.map((k) => k.number) },
    });
    return { added: rows.length, skipped: a.items.length - fresh.length, kots };
  });
}

export const fireSchema = z.object({
  course: z.string().max(20).optional(),
  itemIds: z.array(z.string()).max(200).optional(),
});
/** Fire what was held: one course, some items, or everything. */
export async function fireOrder(
  db: Db,
  actor: Actor,
  orderId: string,
  input: z.input<typeof fireSchema> = {},
) {
  steward(actor);
  const f = fireSchema.parse(input);
  const { order, outlet } = await loadOrder(db, actor, orderId);
  if (order.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This order is already billed');
  const ids = order.items
    .filter(
      (i) =>
        i.status === 'HELD' &&
        (!f.course || i.course === f.course) &&
        (!f.itemIds || f.itemIds.includes(i.id)),
    )
    .map((i) => i.id);
  if (!ids.length) throw new AppError(409, 'CONFLICT', 'Nothing is waiting to be fired');
  return db.$transaction(async (tx) => ({ kots: await fireItems(tx, actor, outlet, order, ids) }));
}

/** An order with nothing sent to the kitchen is simply cancelled. */
export async function cancelOrder(db: Db, actor: Actor, orderId: string) {
  steward(actor);
  const { order } = await loadOrder(db, actor, orderId);
  const status = transition(orderMachine, {
    from: order.status as OrderStatus,
    action: 'cancel',
    roles: ['steward'],
    ctx: { fired: firedCount(order) > 0, allPaid: false },
  }).to;
  await db.$transaction(async (tx) => {
    await tx.posOrder.update({ where: { id: order.id }, data: { status, closedAt: new Date() } });
    await tx.posOrderItem.updateMany({
      where: { orderId: order.id, status: 'HELD' },
      data: { status: 'VOID', voidReason: 'Order cancelled' },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.order_cancelled',
      entityType: 'pos_order',
      entityId: order.id,
    });
  });
  return { id: order.id, status };
}
