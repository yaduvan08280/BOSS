import type { Db } from '@mono/db';
import { tableState } from '@mono/shared';
import type { Actor } from '../work/actor';
import { need } from './access';
import { dayAt, firedCount, live, loadOrder, posOutlet, type LoadedOrder } from './pos-core';

type Mod = { name: string; price: number };

export const orderView = (o: LoadedOrder) => ({
  id: o.id,
  number: o.number,
  businessDay: o.businessDay,
  type: o.type,
  status: o.status,
  tableIds: o.tableIds,
  covers: o.covers,
  stewardId: o.stewardId,
  guestName: o.guestName,
  partyId: o.partyId,
  roomNo: o.roomNo,
  note: o.note,
  split: o.split,
  openedAt: o.openedAt,
  total: live(o).reduce((n, i) => n + Math.round(Number(i.qty) * Number(i.price)), 0),
  items: o.items.map((i) => ({
    id: i.id,
    menuItemId: i.menuItemId,
    name: i.name,
    variantName: i.variantName,
    qty: Number(i.qty),
    price: Number(i.price),
    modifiers: ((i.modifiers as Mod[] | null) ?? []).map((m) => ({ name: m.name, price: m.price })),
    note: i.note,
    course: i.course,
    seat: i.seat,
    status: i.status,
    checkNo: i.checkNo,
    nc: i.nc,
    kotId: i.kotId,
    voidReason: i.voidReason,
    voidAsked: Boolean(i.voidAsk),
    stockNote: i.stockNote,
  })),
});
export async function getOrder(db: Db, actor: Actor, orderId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  return orderView((await loadOrder(db, actor, orderId)).order);
}

/** The floor of an outlet right now: every table with its state and running order, and orders without a table. */
export async function floorView(db: Db, actor: Actor, outletId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await posOutlet(db, actor, outletId);
  const [floors, tables, orders] = await Promise.all([
    db.floor.findMany({
      where: { companyId: actor.companyId, outletId, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    }),
    db.diningTable.findMany({
      where: { companyId: actor.companyId, outletId, deletedAt: null },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
    }),
    db.posOrder.findMany({
      where: { companyId: actor.companyId, outletId, status: { in: ['OPEN', 'BILLED'] } },
      include: { items: true },
      orderBy: { openedAt: 'asc' },
    }),
  ]);
  const brief = (o: LoadedOrder) => ({
    id: o.id,
    number: o.number,
    type: o.type,
    status: o.status,
    covers: o.covers,
    stewardId: o.stewardId,
    guestName: o.guestName,
    openedAt: o.openedAt,
    items: live(o).length,
    total: orderView(o).total,
  });
  return {
    outlet: { id: outlet.id, name: outlet.name },
    businessDay: dayAt(outlet),
    floors: floors.map((f) => ({
      id: f.id,
      name: f.name,
      tables: tables
        .filter((t) => t.floorId === f.id)
        .map((t) => {
          const order = orders.find((o) => o.tableIds.includes(t.id)) ?? null;
          return {
            id: t.id,
            name: t.name,
            seats: t.seats,
            shape: t.shape,
            x: t.x,
            y: t.y,
            state: tableState(order ? { status: order.status, fired: firedCount(order) } : null),
            order: order ? brief(order) : null,
          };
        }),
    })),
    others: orders.filter((o) => !o.tableIds.length).map(brief),
  };
}
