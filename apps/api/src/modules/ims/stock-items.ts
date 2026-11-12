import type { Db, Prisma } from '@mono/db';
import {
  MADE,
  TRACKING,
  daysToExpiry,
  packUnit,
  unitSchema,
  wholeAndOpen,
  type ItemUnit,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, imsRulesOf, need } from './access';
import { clockOf, num, r3, reachPlaces } from './v2';

/**
 * Phase 13 — what an item is beyond its code and rate: how it is tracked (chosen once), its other units, a
 * second unit, its barcode, how it is priced and taxed. And where its stock is: per location and batch.
 */
export const itemExtrasSchema = z.object({
  tracking: z.enum(TRACKING).optional(),
  made: z.enum(MADE).optional(),
  units: z.array(unitSchema).max(12).optional(),
  purchaseUnit: z.string().trim().max(12).nullish(),
  secondUnit: z.string().trim().max(12).nullish(),
  pricedBy: z.enum(['unit', 'second']).optional(),
  barcode: z.string().trim().max(64).nullish(),
  brand: z.string().trim().max(80).nullish(),
  hsn: z.string().trim().max(12).nullish(),
  taxCode: z.string().trim().max(20).nullish(),
  sellPrice: z.number().int().min(0).max(1e13).nullish(),
  rateKey: z.string().trim().max(30).nullish(),
  rateFactor: z.number().positive().max(100).nullish(),
  shelfLifeDays: z.number().int().min(0).max(3650).nullish(),
});

export async function saveItemExtras(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof itemExtrasSchema>,
) {
  need(actor, 'ims.edit', "You can't change items");
  const x = itemExtrasSchema.parse(input);
  const item = await db.item.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!item) throw notFound('Item');
  // The tracking mode is chosen once: changing it would orphan the batches and pieces already held.
  if (x.tracking && x.tracking !== item.tracking) {
    const held =
      Number(item.stock) !== 0 ||
      (await db.stockBatch.count({ where: { companyId: actor.companyId, itemId: id } }));
    if (held)
      throw new AppError(
        409,
        'CONFLICT',
        `${item.name} already has stock: how it is tracked can't change now`,
      );
  }
  if (x.units) {
    const names = x.units.map((u) => u.unit.toLowerCase());
    if (new Set(names).size !== names.length || names.includes(item.unit.toLowerCase()))
      throw new AppError(400, 'VALIDATION_FAILED', 'Each unit can be listed once, and not the stock unit');
  }
  if (
    x.purchaseUnit &&
    ![item.unit, ...(x.units ?? (item.units as ItemUnit[] | null) ?? []).map((u) => u.unit)]
      .map((u) => u.toLowerCase())
      .includes(x.purchaseUnit.toLowerCase())
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'The purchase unit must be one of the item’s units');
  if (x.barcode) {
    const taken = await db.item.count({
      where: { companyId: actor.companyId, barcode: x.barcode, deletedAt: null, NOT: { id } },
    });
    if (taken) throw new AppError(409, 'CONFLICT', 'Another item already has that barcode');
  }
  if (x.taxCode && !(await db.taxRate.count({ where: { companyId: actor.companyId, code: x.taxCode } })))
    throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate with the code ${x.taxCode}`);
  const data: Prisma.ItemUpdateInput = {
    ...(x.tracking ? { tracking: x.tracking } : {}),
    ...(x.made ? { made: x.made } : {}),
    ...(x.units ? { units: x.units } : {}),
    ...(x.pricedBy ? { pricedBy: x.pricedBy } : {}),
    ...Object.fromEntries(
      (
        [
          'purchaseUnit',
          'secondUnit',
          'barcode',
          'brand',
          'hsn',
          'taxCode',
          'rateKey',
          'rateFactor',
          'shelfLifeDays',
        ] as const
      )
        .filter((k) => x[k] !== undefined)
        .map((k) => [k, x[k] === '' ? null : x[k]]),
    ),
    ...(x.sellPrice !== undefined ? { sellPrice: x.sellPrice === null ? null : BigInt(x.sellPrice) } : {}),
  };
  return db.$transaction(async (tx) => {
    const saved = await tx.item.update({ where: { id }, data });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.item_extras',
      entityType: 'item',
      entityId: id,
      after: x,
    });
    return extrasOf(saved);
  });
}
type ItemRow = Awaited<ReturnType<Db['item']['findFirstOrThrow']>>;
export const extrasOf = (i: ItemRow) => ({
  id: i.id,
  tracking: i.tracking,
  made: i.made,
  units: (i.units as ItemUnit[] | null) ?? [],
  purchaseUnit: i.purchaseUnit,
  secondUnit: i.secondUnit,
  pricedBy: i.pricedBy,
  barcode: i.barcode,
  brand: i.brand,
  hsn: i.hsn,
  taxCode: i.taxCode,
  sellPrice: i.sellPrice === null ? null : Number(i.sellPrice),
  rateKey: i.rateKey,
  rateFactor: i.rateFactor === null ? null : Number(i.rateFactor),
  shelfLifeDays: i.shelfLifeDays,
});

export const stockQuery = z.object({
  locationId: z.string().optional(),
  itemId: z.string().optional(),
  /** Lot attributes to filter by, as JSON: {"grade":"A"}. */
  attrs: z.string().optional(),
});

/** Stock by location: every item a place holds, with its batches, value, and bottles + open ml where it helps. */
export async function stockByLocation(db: Db, actor: Actor, q: z.infer<typeof stockQuery>) {
  need(actor, 'ims.view', "You can't see stock");
  const where = await reachPlaces(db, actor.companyId);
  if (q.locationId !== undefined && !where.has(q.locationId))
    throw new AppError(403, 'FORBIDDEN', 'That location is not one of yours');
  const { today } = await clockOf(db, actor.companyId);
  const rules = await imsRulesOf(db, actor.companyId);
  const balances = await db.stockBalance.findMany({
    where: {
      companyId: actor.companyId,
      qty: { not: 0 },
      locationId: q.locationId !== undefined ? q.locationId : { in: [...where.keys()] },
      ...(q.itemId ? { itemId: q.itemId } : {}),
    },
  });
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: [...new Set(balances.map((b) => b.itemId))] } },
      })
    ).map((i) => [i.id, i]),
  );
  const batches = new Map(
    (
      await db.stockBatch.findMany({
        where: { companyId: actor.companyId, id: { in: balances.map((b) => b.batchId).filter(Boolean) } },
      })
    ).map((b) => [b.id, b]),
  );
  const want = q.attrs ? (JSON.parse(q.attrs) as Record<string, unknown>) : null;
  const rows = new Map<string, ReturnType<typeof blank>>();
  const blank = (itemId: string, locationId: string) => {
    const i = items.get(itemId)!;
    const p = where.get(locationId)!;
    return {
      itemId,
      code: i.code,
      name: i.name,
      unit: i.unit,
      tracking: i.tracking,
      secondUnit: i.secondUnit,
      locationId,
      location: p.name,
      branchId: p.branchId,
      branch: p.branch,
      qty: 0,
      qty2: 0,
      value: 0,
      /** Stock said in the item's biggest other unit: 11 bottles and 420 ml open. */
      whole: null as null | { unit: string; whole: number; open: number },
      batches: [] as {
        batchId: string;
        code: string;
        kind: string;
        expiry: string | null;
        daysLeft: number | null;
        expired: boolean;
        attrs: unknown;
        qty: number;
        qty2: number;
        barcode: string | null;
      }[],
    };
  };
  for (const b of balances) {
    const batch = b.batchId ? batches.get(b.batchId) : null;
    if (want) {
      const has = (batch?.attrs ?? {}) as Record<string, unknown>;
      if (!Object.entries(want).every(([k, v]) => String(has[k] ?? '') === String(v))) continue;
    }
    const k = `${b.itemId}|${b.locationId}`;
    const row = rows.get(k) ?? blank(b.itemId, b.locationId);
    row.qty = r3(row.qty + num(b.qty));
    row.qty2 = r3(row.qty2 + num(b.qty2));
    row.value += Number(b.value);
    if (batch) {
      const daysLeft = batch.expiry ? daysToExpiry(batch.expiry, today) : null;
      row.batches.push({
        batchId: batch.id,
        code: batch.code,
        kind: batch.kind,
        expiry: batch.expiry,
        daysLeft,
        expired: daysLeft !== null && daysLeft < 0,
        attrs: batch.attrs,
        qty: num(b.qty),
        qty2: num(b.qty2),
        barcode: batch.barcode,
      });
    }
    rows.set(k, row);
  }
  for (const row of rows.values()) {
    const open = packUnit(items.get(row.itemId)!.units as ItemUnit[] | null);
    if (open) row.whole = { unit: open.unit, ...wholeAndOpen(row.qty, open.factor) };
    row.batches.sort(
      (a, b) => (a.expiry ?? '9999').localeCompare(b.expiry ?? '9999') || a.code.localeCompare(b.code),
    );
  }
  return {
    valuation: rules.stock.valuation,
    places: [...where.values()],
    rows: [...rows.values()].sort(
      (a, b) => a.location.localeCompare(b.location) || a.code.localeCompare(b.code),
    ),
  };
}

/** Batches that have expired or will within N days (the rule's days when not said), with where they are. */
export async function expiryList(db: Db, actor: Actor, days?: number) {
  const { rows } = await stockByLocation(db, actor, {});
  const rules = await imsRulesOf(db, actor.companyId);
  const within = days ?? rules.stock.expiryAlertDays;
  return rows
    .flatMap((r) =>
      r.batches
        .filter((b) => b.daysLeft !== null && b.daysLeft <= within)
        .map((b) => ({
          ...b,
          itemId: r.itemId,
          code: r.code,
          item: r.name,
          unit: r.unit,
          locationId: r.locationId,
          location: r.location,
          batch: b.code,
        })),
    )
    .sort((a, b) => a.daysLeft! - b.daysLeft!);
}

/** A scanned code: a batch's or piece's own barcode first, then the item's barcode, then the item's code. */
export async function scan(db: Db, actor: Actor, code: string) {
  need(actor, 'ims.view', "You can't see stock");
  const c = code.trim();
  if (!c) throw new AppError(400, 'VALIDATION_FAILED', 'Nothing was scanned');
  const batch = await db.stockBatch.findFirst({ where: { companyId: actor.companyId, barcode: c } });
  const item = await db.item.findFirst({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...(batch ? { id: batch.itemId } : { OR: [{ barcode: c }, { code: c }] }),
    },
  });
  if (!item) throw new AppError(404, 'NOT_FOUND', `Nothing has the code ${c}`);
  return {
    item: { code: item.code, name: item.name, unit: item.unit, ...extrasOf(item) },
    batch: batch
      ? {
          id: batch.id,
          code: batch.code,
          kind: batch.kind,
          expiry: batch.expiry,
          attrs: batch.attrs,
          qty2: batch.qty2 === null ? null : Number(batch.qty2),
        }
      : null,
  };
}

/** One piece's or batch's story: every move that touched it, oldest first. */
export async function batchHistory(db: Db, actor: Actor, batchId: string) {
  need(actor, 'ims.view', "You can't see stock");
  const batch = await db.stockBatch.findFirst({ where: { id: batchId, companyId: actor.companyId } });
  if (!batch) throw notFound('Batch');
  const where = await reachPlaces(db, actor.companyId);
  const moves = await db.stockMove.findMany({
    where: {
      companyId: actor.companyId,
      itemId: batch.itemId,
      status: 'APPLIED',
      OR: [{ batchId }, { picks: { array_contains: [{ batchId }] } }],
    },
    orderBy: { at: 'asc' },
  });
  const held = await db.stockBalance.findMany({ where: { batchId, qty: { gt: 0 } } });
  return {
    batch: {
      id: batch.id,
      code: batch.code,
      kind: batch.kind,
      expiry: batch.expiry,
      attrs: batch.attrs,
      rate: Number(batch.rate),
      qty2: batch.qty2 === null ? null : Number(batch.qty2),
    },
    at: held.map((h) => ({
      locationId: h.locationId,
      location: where.get(h.locationId)?.name ?? '—',
      qty: num(h.qty),
    })),
    moves: moves.map((m) => ({
      id: m.id,
      at: m.at,
      type: m.type,
      qty: num(m.qty) || num(m.lineQty),
      reason: m.reason,
      from: where.get(m.locationId)?.name ?? '—',
      to: m.toLocationId === null ? null : (where.get(m.toLocationId)?.name ?? '—'),
      refType: m.refType,
      refId: m.refId,
    })),
  };
}
