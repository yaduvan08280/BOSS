import type { Db } from '@mono/db';
import {
  kotMachine,
  orderItemMachine,
  ticketAge,
  transition,
  type ItemStatus,
  type KotStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { posOutlet } from './pos-core';

/**
 * Phase 15 — the kitchen display. Tickets per station with a timer that turns amber and red; an item or a whole
 * ticket is marked ready, a ticket is bumped off the display and can be recalled; "all day" counts say how many
 * of each dish are still to make; the expo screen shows every station together.
 */
const kitchen = (a: Actor) => need(a, 'hosp.create', "You can't use the kitchen display");
type Mod = { name: string };

export const kdsQuery = z.object({
  stationId: z.string().optional(),
  show: z.enum(['open', 'bumped']).default('open'),
});
export async function kitchenDisplay(
  db: Db,
  actor: Actor,
  outletId: string,
  q: z.input<typeof kdsQuery> = {},
) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const { stationId, show } = kdsQuery.parse(q);
  const outlet = await posOutlet(db, actor, outletId);
  const kots = await db.kot.findMany({
    where: {
      companyId: actor.companyId,
      outletId,
      status: show === 'open' ? { in: ['NEW', 'READY'] } : 'BUMPED',
      // The expo screen (no station) shows every station's tickets.
      ...(stationId ? { stationId } : {}),
    },
    orderBy: show === 'open' ? { firedAt: 'asc' } : { bumpedAt: 'desc' },
    take: show === 'open' ? 200 : 30,
  });
  const [items, orders, stations] = await Promise.all([
    db.posOrderItem.findMany({
      where: { companyId: actor.companyId, kotId: { in: kots.map((k) => k.id) } },
      orderBy: { createdAt: 'asc' },
    }),
    db.posOrder.findMany({
      where: { id: { in: [...new Set(kots.map((k) => k.orderId))] } },
      select: { id: true, number: true, type: true, tableIds: true, stewardId: true },
    }),
    db.station.findMany({
      where: { companyId: actor.companyId, outletId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const tables = new Map(
    (
      await db.diningTable.findMany({
        where: { id: { in: orders.flatMap((o) => o.tableIds) } },
        select: { id: true, name: true },
      })
    ).map((t) => [t.id, t.name]),
  );
  const order = new Map(orders.map((o) => [o.id, o]));
  const now = Date.now();
  const allDay = new Map<string, number>();
  for (const i of items)
    if (i.status === 'FIRED') allDay.set(i.name, (allDay.get(i.name) ?? 0) + Number(i.qty));
  return {
    outlet: { id: outlet.id, name: outlet.name },
    stations: stations.filter((s) => s.display).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    tickets: kots.map((k) => {
      const o = order.get(k.orderId);
      return {
        id: k.id,
        number: k.number,
        status: k.status,
        stationId: k.stationId,
        station: stations.find((s) => s.id === k.stationId)?.name ?? null,
        order: o
          ? { number: o.number, type: o.type, table: o.tableIds.map((t) => tables.get(t) ?? '').join('+') }
          : null,
        firedAt: k.firedAt,
        ...ticketAge(k.firedAt.getTime(), now),
        items: items
          .filter((i) => i.kotId === k.id)
          .map((i) => ({
            id: i.id,
            name: i.variantName ? `${i.name} (${i.variantName})` : i.name,
            qty: Number(i.qty),
            note: i.note,
            course: i.course,
            seat: i.seat,
            status: i.status,
            mods: ((i.modifiers as Mod[] | null) ?? []).map((m) => m.name),
          })),
      };
    }),
    /** Still to make, across the tickets shown: 6 × Butter naan. */
    allDay: [...allDay.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty),
  };
}

async function kotOf(db: Db, actor: Actor, id: string) {
  const kot = await db.kot.findFirst({ where: { id, companyId: actor.companyId } });
  if (!kot) throw notFound('Ticket');
  await posOutlet(db, actor, kot.outletId);
  return kot;
}

/** Ready, bump or recall a whole ticket. Its items follow: ready makes them ready, a recall sends them back. */
export async function kotAction(db: Db, actor: Actor, id: string, action: 'ready' | 'bump' | 'recall') {
  kitchen(actor);
  const kot = await kotOf(db, actor, id);
  const status = transition(kotMachine, {
    from: kot.status as KotStatus,
    action,
    roles: ['kitchen'],
    ctx: {},
  }).to;
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    const now = new Date();
    await tx.kot.update({
      where: { id },
      data: {
        status,
        ...(action === 'ready'
          ? { readyAt: now }
          : action === 'bump'
            ? { bumpedAt: now, readyAt: kot.readyAt ?? now }
            : { bumpedAt: null, readyAt: null }),
      },
    });
    if (action === 'recall')
      await tx.posOrderItem.updateMany({
        where: { kotId: id, status: 'READY' },
        data: { status: 'FIRED', readyAt: null },
      });
    else
      await tx.posOrderItem.updateMany({
        where: { kotId: id, status: 'FIRED' },
        data: { status: 'READY', readyAt: now },
      });
    await writeAudit(tx, ctx, {
      action: `pos.kot_${action}`,
      entityType: 'kot',
      entityId: id,
      before: { status: kot.status },
      after: { status },
    });
    if (action !== 'recall')
      await emitEvent(tx, ctx, {
        name: 'pos.kot_ready',
        entityType: 'kot',
        entityId: id,
        payload: { outletId: kot.outletId, number: kot.number, orderId: kot.orderId },
      });
  });
  return { id, status };
}

/** One item of a ticket is ready (or not ready after all); when the last one is ready, so is the ticket. */
export async function itemReady(db: Db, actor: Actor, itemId: string, ready: boolean) {
  kitchen(actor);
  const item = await db.posOrderItem.findFirst({ where: { id: itemId, companyId: actor.companyId } });
  if (!item || !item.kotId) throw notFound('Item');
  const kot = await kotOf(db, actor, item.kotId);
  const to = transition(orderItemMachine, {
    from: item.status as ItemStatus,
    action: ready ? 'ready' : 'recall',
    roles: ['kitchen'],
    ctx: {},
  }).to;
  await db.$transaction(async (tx) => {
    await tx.posOrderItem.update({
      where: { id: itemId },
      data: { status: to, readyAt: ready ? new Date() : null },
    });
    const waiting = await tx.posOrderItem.count({ where: { kotId: kot.id, status: 'FIRED' } });
    if (ready && waiting === 0 && kot.status === 'NEW')
      await tx.kot.update({ where: { id: kot.id }, data: { status: 'READY', readyAt: new Date() } });
    if (!ready && kot.status === 'READY')
      await tx.kot.update({ where: { id: kot.id }, data: { status: 'NEW', readyAt: null } });
  });
  return { id: itemId, status: to };
}
