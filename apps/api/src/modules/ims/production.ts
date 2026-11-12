import type { Db } from '@mono/db';
import { explode, productionMachine, transition, type ProductionStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { ensureBatch } from './ledger';
import { applyMove } from './moves';
import { booksOf } from './recipes';
import { asStockItem, clockOf, needPlace, num, paperNumber, r3, reachPlaces } from './v2';

/**
 * Phase 13 — production at a kitchen (plan §3.6): recipe × quantity. Finishing the order takes the raw material
 * from the kitchen's stock, puts the made item in as a batch with its expiry and its real cost, and keeps the
 * yield variance (made against planned).
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const productionSchema = z.object({
  itemId: z.string(),
  qty: z.number().positive().max(1e9),
  locationId: z.string().default(''),
  note: z.string().trim().max(500).nullish(),
});
export const finishSchema = z.object({
  actualQty: z.number().positive().max(1e9),
  batchCode: z.string().trim().max(60).nullish(),
  expiry: day.nullish(),
});

export async function planProduction(db: Db, actor: Actor, input: z.input<typeof productionSchema>) {
  need(actor, 'ims.create', "You can't plan production");
  const p = productionSchema.parse(input);
  const place = await needPlace(db, actor.companyId, p.locationId);
  const item = await db.item.findFirst({
    where: { id: p.itemId, companyId: actor.companyId, deletedAt: null },
  });
  if (!item) throw notFound('Item');
  if (item.made !== 'MAKE')
    throw new AppError(
      409,
      'CONFLICT',
      `${item.name} is not a made item: only made, stocked items are produced`,
    );
  const recipe = await db.recipe.findFirst({
    where: { companyId: actor.companyId, itemId: item.id, active: true },
  });
  if (!recipe) throw new AppError(409, 'CONFLICT', `${item.name} has no recipe yet`);
  return db.$transaction(async (tx) => {
    const row = await tx.productionOrder.create({
      data: {
        companyId: actor.companyId,
        number: await paperNumber(tx, actor.companyId, 'PRD'),
        itemId: item.id,
        recipeId: recipe.id,
        locationId: place.id,
        plannedQty: p.qty,
        note: p.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.production_planned',
      entityType: 'production_order',
      entityId: row.id,
      after: p,
    });
    return { id: row.id, number: row.number, status: row.status };
  });
}

export async function finishProduction(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof finishSchema>,
) {
  need(actor, 'ims.create', "You can't record production");
  const f = finishSchema.parse(input);
  const order = await db.productionOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!order) throw notFound('Production order');
  await needPlace(db, actor.companyId, order.locationId);
  const status = transition(productionMachine, {
    from: order.status as ProductionStatus,
    action: 'finish',
    roles: ['maker'],
    ctx: {},
  }).to;
  const row = await db.item.findFirstOrThrow({ where: { id: order.itemId, companyId: actor.companyId } });
  const item = asStockItem(row);
  const recipe = await db.recipe.findUniqueOrThrow({ where: { id: order.recipeId } });
  // The version the order was planned on, with today's other recipes for its made-to-order parts.
  const books = await booksOf(db, actor.companyId);
  books.recipes.set(item.id, { outputQty: num(recipe.outputQty), lines: recipe.lines as never });
  const planned = num(order.plannedQty);
  const needs = explode(books, item.id, planned);
  const ctx = ctxOf(actor);
  const { today } = await clockOf(db, actor.companyId);
  return db.$transaction(async (tx) => {
    const consumed = [];
    for (const [itemId, qty] of needs) {
      const r = await applyMove(tx, ctx, {
        itemId,
        type: 'OUT',
        delta: -r3(qty),
        reason: 'PRODUCTION',
        locationId: order.locationId,
        refType: 'production_order',
        refId: order.id,
        note: order.number,
      });
      consumed.push({ itemId, qty: r3(qty), value: r.value });
    }
    const cost = consumed.reduce((n, c) => n + c.value, 0);
    const rate = Math.round(cost / f.actualQty);
    let batchId: string | null = null;
    if (item.tracking === 'BATCH' || item.tracking === 'LOT') {
      const expiry =
        f.expiry ??
        (item.shelfLifeDays
          ? new Date(Date.parse(`${today}T00:00:00Z`) + item.shelfLifeDays * 86_400_000)
              .toISOString()
              .slice(0, 10)
          : null);
      batchId = (await ensureBatch(tx, row, { code: f.batchCode || order.number, expiry, mfg: today, rate }))
        .id;
    }
    await applyMove(tx, ctx, {
      itemId: item.id,
      type: 'IN',
      delta: f.actualQty,
      rate: BigInt(rate),
      reason: 'PRODUCTION',
      locationId: order.locationId,
      batchId,
      refType: 'production_order',
      refId: order.id,
      note: order.number,
    });
    // What it really cost to make becomes the made item's rate (recipe costs above it read this).
    await tx.item.update({ where: { id: item.id }, data: { rate: BigInt(rate) } });
    await tx.productionOrder.update({
      where: { id },
      data: { status, actualQty: f.actualQty, batchId, consumed, doneById: actor.userId, doneAt: new Date() },
    });
    const variance = r3(f.actualQty - planned);
    await writeAudit(tx, ctx, {
      action: 'ims.production_done',
      entityType: 'production_order',
      entityId: id,
      after: { ...f, variance, cost },
    });
    await emitEvent(tx, ctx, {
      name: 'ims.production_done',
      entityType: 'production_order',
      entityId: id,
      payload: { number: order.number, item: item.name, made: f.actualQty, planned, variance },
    });
    return {
      id,
      status,
      batchId,
      cost,
      rate,
      variance,
      variancePct: Math.round((variance / planned) * 1000) / 10,
    };
  });
}

export async function cancelProduction(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.create', "You can't change production");
  const order = await db.productionOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!order) throw notFound('Production order');
  const status = transition(productionMachine, {
    from: order.status as ProductionStatus,
    action: 'cancel',
    roles: ['maker'],
    ctx: {},
  }).to;
  await db.$transaction(async (tx) => {
    await tx.productionOrder.update({ where: { id }, data: { status } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.production_cancelled',
      entityType: 'production_order',
      entityId: id,
    });
  });
  return { id, status };
}

export async function listProduction(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const rows = await db.productionOrder.findMany({
    where: { companyId: actor.companyId, locationId: { in: [...mine.keys()] } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: rows.map((r) => r.itemId) } },
        select: { id: true, name: true, unit: true, code: true },
      })
    ).map((i) => [i.id, i]),
  );
  const batches = new Map(
    (
      await db.stockBatch.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: rows.map((r) => r.batchId).filter((x): x is string => Boolean(x)) },
        },
      })
    ).map((b) => [b.id, b]),
  );
  return rows.map((r) => {
    const planned = num(r.plannedQty);
    const actual = r.actualQty === null ? null : num(r.actualQty);
    const consumed = (r.consumed as { itemId: string; qty: number; value: number }[] | null) ?? [];
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      item: items.get(r.itemId) ?? null,
      location: mine.get(r.locationId)?.name ?? '—',
      locationId: r.locationId,
      plannedQty: planned,
      actualQty: actual,
      variance: actual === null ? null : r3(actual - planned),
      cost: consumed.reduce((n, c) => n + c.value, 0),
      batch: r.batchId
        ? { code: batches.get(r.batchId)?.code ?? '', expiry: batches.get(r.batchId)?.expiry ?? null }
        : null,
      note: r.note,
      createdAt: r.createdAt,
      doneAt: r.doneAt,
    };
  });
}
