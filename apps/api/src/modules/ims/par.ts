import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import type { TransferLine } from './transfers';
import { routeFor } from './transfers';
import { itemsOf, needPlace, num, r3, reachPlaces } from './v2';

/**
 * Phase 13 — par levels: what a location should hold of an item. The reorder list of a location is everything
 * under its level (stock there + what is already coming), with where it comes from: the branch's supply route
 * (an indent) or, with none, a purchase.
 */
export const parSchema = z.object({
  locationId: z.string().default(''),
  levels: z
    .array(
      z.object({
        itemId: z.string(),
        par: z.number().min(0).max(1e9),
        min: z.number().min(0).max(1e9).nullish(),
      }),
    )
    .min(1)
    .max(500),
});
export async function savePar(db: Db, actor: Actor, input: z.input<typeof parSchema>) {
  need(actor, 'ims.edit', "You can't set levels");
  const p = parSchema.parse(input);
  const place = await needPlace(db, actor.companyId, p.locationId);
  await itemsOf(
    db,
    actor.companyId,
    p.levels.map((l) => l.itemId),
  );
  await db.$transaction(async (tx) => {
    for (const l of p.levels) {
      const where = { itemId_locationId: { itemId: l.itemId, locationId: place.id } };
      // A level of nothing takes the item off the location's list.
      if (l.par === 0) await tx.parLevel.deleteMany({ where: { itemId: l.itemId, locationId: place.id } });
      else
        await tx.parLevel.upsert({
          where,
          create: {
            companyId: actor.companyId,
            itemId: l.itemId,
            locationId: place.id,
            par: l.par,
            min: l.min ?? null,
          },
          update: { par: l.par, min: l.min ?? null },
        });
    }
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.par_saved',
      entityType: 'location',
      entityId: place.id || 'main',
      after: p,
    });
  });
  return reorderList(db, actor, place.id);
}

/** Every level of a location with what is there, what is coming, and what to ask for. */
export async function reorderList(db: Db, actor: Actor, locationId: string) {
  need(actor, 'ims.view', "You can't see stock");
  const place = await needPlace(db, actor.companyId, locationId);
  const levels = await db.parLevel.findMany({ where: { companyId: actor.companyId, locationId: place.id } });
  const ids = levels.map((l) => l.itemId);
  const items = new Map(
    (await db.item.findMany({ where: { companyId: actor.companyId, id: { in: ids } } })).map((i) => [
      i.id,
      i,
    ]),
  );
  const have = new Map<string, number>();
  for (const b of await db.stockBalance.findMany({
    where: { companyId: actor.companyId, locationId: place.id, itemId: { in: ids } },
  }))
    have.set(b.itemId, r3((have.get(b.itemId) ?? 0) + num(b.qty)));
  // Coming: transfers to this location that are not received yet, and open purchase orders delivered here.
  const coming = new Map<string, number>();
  const add = (itemId: string, qty: number) =>
    qty > 0 && coming.set(itemId, r3((coming.get(itemId) ?? 0) + qty));
  for (const t of await db.stockTransfer.findMany({
    where: {
      companyId: actor.companyId,
      toLocationId: place.id,
      status: { in: ['REQUESTED', 'APPROVED', 'DISPATCHED'] },
    },
  }))
    for (const l of t.lines as TransferLine[])
      add(l.substituteItemId ?? l.itemId, t.status === 'DISPATCHED' ? l.dispatched : (l.approved ?? l.asked));
  for (const l of await db.poLine.findMany({
    where: {
      companyId: actor.companyId,
      itemId: { in: ids },
      po: { status: { in: ['DRAFT', 'SENT', 'PARTLY_RECEIVED'] }, locationId: place.id },
    },
  }))
    add(l.itemId, num(l.qty) - num(l.receivedQty));
  const all = await reachPlaces(db, actor.companyId);
  const rows = [];
  for (const l of levels) {
    const item = items.get(l.itemId);
    if (!item || item.deletedAt) continue;
    const stock = have.get(l.itemId) ?? 0;
    const onWay = coming.get(l.itemId) ?? 0;
    const par = num(l.par);
    const floor = l.min === null ? par : num(l.min);
    const short = stock + onWay < floor;
    const route = await routeFor(db, actor.companyId, place.branchId, item.category);
    const supplier = route && route.fromLocationId !== place.id ? route.fromLocationId : null;
    rows.push({
      itemId: item.id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      par,
      min: l.min === null ? null : num(l.min),
      stock,
      coming: onWay,
      short,
      ask: short ? r3(Math.max(0, par - stock - onWay)) : 0,
      source:
        supplier !== null
          ? {
              type: 'indent' as const,
              fromLocationId: supplier,
              from: all.get(supplier)?.name ?? 'the supplying store',
            }
          : { type: 'purchase' as const, vendor: item.vendor },
    });
  }
  return {
    location: place,
    rows: rows.sort((a, b) => Number(b.short) - Number(a.short) || a.code.localeCompare(b.code)),
  };
}
