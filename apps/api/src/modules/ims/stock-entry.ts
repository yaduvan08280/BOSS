import type { Db, Tx } from '@mono/db';
import { factorOf, toStockQty } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { ensureBatch } from './ledger';
import { applyMove } from './moves';
import { checkAttrs } from './stock-attrs';
import { asStockItem, clockOf, needPlace, type StockItem } from './v2';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const batchInputSchema = z.object({
  code: z.string().trim().min(1).max(60),
  expiry: day.nullish(),
  mfg: day.nullish(),
  attrs: z.record(z.string(), z.unknown()).nullish(),
  barcode: z.string().trim().max(64).nullish(),
});
export const serialInputSchema = batchInputSchema.extend({
  /** The piece's own second-unit quantity (its weight) and cost. */
  qty2: z.number().positive().max(1e9).nullish(),
  ratePaise: z.number().int().min(0).max(1e13).nullish(),
});
export const stockEntrySchema = z
  .object({
    itemId: z.string().optional(),
    /** A scanned code in place of the item (and of the batch, when the code is a batch's or piece's). */
    barcode: z.string().trim().max(64).optional(),
    type: z.enum(['IN', 'OUT', 'TRANSFER']),
    qty: z.number().positive().max(1e9).optional(),
    unit: z.string().trim().max(12).nullish(),
    locationId: z.string().default(''),
    toLocationId: z.string().optional(),
    batchId: z.string().optional(),
    batch: batchInputSchema.optional(),
    serials: z.array(serialInputSchema).min(1).max(500).optional(),
    qty2: z.number().positive().max(1e9).nullish(),
    /** Cost per typed unit. */
    ratePaise: z.number().int().min(0).max(1e13).nullish(),
    note: z.string().trim().max(500).nullish(),
    reason: z.string().trim().max(40).nullish(),
  })
  .refine((m) => m.itemId || m.barcode, { message: 'Choose an item or scan a code' })
  .refine((m) => m.type !== 'TRANSFER' || m.toLocationId !== undefined, { message: 'Choose where it goes' })
  .refine((m) => m.qty !== undefined || m.serials?.length, { message: 'Enter a quantity' });
export type StockEntry = z.infer<typeof stockEntrySchema>;

/** The item (and batch) an entry is about: by id, or by a scanned code. */
export async function resolveEntry(
  db: Db | Tx,
  companyId: string,
  m: { itemId?: string; barcode?: string; batchId?: string },
) {
  let batchId = m.batchId;
  let itemId = m.itemId;
  if (m.barcode) {
    const batch = await db.stockBatch.findFirst({ where: { companyId, barcode: m.barcode } });
    if (batch) {
      batchId = batch.id;
      itemId = batch.itemId;
    } else {
      const byCode = await db.item.findFirst({
        where: { companyId, deletedAt: null, OR: [{ barcode: m.barcode }, { code: m.barcode }] },
      });
      if (!byCode) throw new AppError(404, 'NOT_FOUND', `Nothing has the code ${m.barcode}`);
      itemId = byCode.id;
    }
  }
  const row = await db.item.findFirst({ where: { id: itemId ?? '', companyId, deletedAt: null } });
  if (!row) throw notFound('Item');
  if (!row.active) throw new AppError(409, 'CONFLICT', `${row.name} is switched off`);
  if (batchId && !(await db.stockBatch.count({ where: { id: batchId, companyId, itemId: row.id } })))
    throw new AppError(400, 'VALIDATION_FAILED', 'That batch is not of this item');
  return { row, item: asStockItem(row), batchId };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Goods coming in, in the caller's transaction: batches and pieces are made as the item's tracking asks. */
export async function receiveIn(
  tx: Tx,
  actor: Actor,
  item: StockItem,
  row: Parameters<typeof ensureBatch>[1],
  m: Pick<
    StockEntry,
    'qty' | 'unit' | 'batch' | 'batchId' | 'serials' | 'qty2' | 'ratePaise' | 'note' | 'reason'
  > & {
    locationId: string;
    refType?: string;
    refId?: string;
  },
) {
  const ctx = ctxOf(actor);
  const factor = factorOf(item, m.unit);
  if (factor === null)
    throw new AppError(400, 'VALIDATION_FAILED', `${item.name} has no unit called ${m.unit}`);
  const perStock =
    m.ratePaise === null || m.ratePaise === undefined ? null : Math.round(m.ratePaise / factor);
  const { today } = await clockOf(tx, actor.companyId);
  const base = {
    itemId: item.id,
    type: 'IN' as const,
    locationId: m.locationId,
    note: m.note,
    reason: m.reason,
    refType: m.refType,
    refId: m.refId,
  };
  const out = [];
  if (item.tracking === 'SERIAL') {
    if (!m.serials?.length)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `${item.name} is kept piece by piece: give each piece's number`,
      );
    for (const s of m.serials) {
      const rate = s.ratePaise ?? perStock ?? item.rate;
      const batch = await ensureBatch(tx, row, {
        code: s.code,
        kind: 'SERIAL',
        rate,
        qty2: s.qty2 ?? null,
        attrs: await checkAttrs(tx, actor.companyId, item.category, s.attrs),
        barcode: s.barcode,
      });
      out.push(
        await applyMove(tx, ctx, {
          ...base,
          delta: 1,
          rate: BigInt(rate),
          batchId: batch.id,
          qty2: s.qty2 ?? null,
          unit: item.unit,
          unitQty: 1,
        }),
      );
    }
    return out;
  }
  if (m.qty === undefined) throw new AppError(400, 'VALIDATION_FAILED', 'Enter a quantity');
  const delta = toStockQty(item, m.qty, m.unit);
  let batchId = m.batchId ?? null;
  if (item.tracking === 'BATCH' || item.tracking === 'LOT') {
    if (!batchId) {
      if (!m.batch)
        throw new AppError(400, 'VALIDATION_FAILED', `${item.name} is kept by batch: give the batch number`);
      const expiry =
        m.batch.expiry ?? (item.shelfLifeDays ? addDays(m.batch.mfg ?? today, item.shelfLifeDays) : null);
      const batch = await ensureBatch(tx, row, {
        code: m.batch.code,
        expiry,
        mfg: m.batch.mfg,
        rate: perStock ?? item.rate,
        attrs: await checkAttrs(tx, actor.companyId, item.category, m.batch.attrs),
        barcode: m.batch.barcode,
      });
      batchId = batch.id;
    }
  }
  out.push(
    await applyMove(tx, ctx, {
      ...base,
      delta,
      rate: perStock === null ? null : BigInt(perStock),
      // A case at ₹12,000 is 9 000 ml at 133.33 paise: the value is kept exact, not 9 000 × 133.
      inValue: m.ratePaise === null || m.ratePaise === undefined ? null : Math.round(m.qty * m.ratePaise),
      batchId,
      qty2: m.qty2 ?? null,
      unit: m.unit ?? item.unit,
      unitQty: m.qty,
    }),
  );
  return out;
}

/** A stock entry at a location: in (with its batch or pieces), out (first expired first out, or the scanned batch), or a transfer. */
export async function postStock(db: Db, actor: Actor, input: z.input<typeof stockEntrySchema>) {
  need(actor, 'ims.create', "You can't enter stock moves");
  const m = stockEntrySchema.parse(input);
  const { row, item, batchId } = await resolveEntry(db, actor.companyId, m);
  const from = await needPlace(db, actor.companyId, m.locationId);
  const to = m.type === 'TRANSFER' ? await needPlace(db, actor.companyId, m.toLocationId) : null;
  if (to) {
    if (to.id === from.id) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a different location');
    // Between branches goods travel: that is a transfer paper with dispatch and receipt, not one entry.
    if (from.branchId && to.branchId && from.branchId !== to.branchId)
      throw new AppError(
        409,
        'CONFLICT',
        `${from.name} and ${to.name} are in different branches: raise a transfer`,
      );
  }
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    let results;
    if (m.type === 'IN') {
      results = await receiveIn(tx, actor, item, row, { ...m, batchId, locationId: from.id });
    } else {
      const qty = m.qty ?? m.serials?.length ?? 0;
      const stockQty = item.tracking === 'SERIAL' ? 1 : toStockQtyOr400(item, qty, m.unit);
      results = [
        await applyMove(tx, ctx, {
          itemId: item.id,
          type: m.type,
          delta: m.type === 'OUT' ? -stockQty : 0,
          lineQty: stockQty,
          locationId: from.id,
          toLocationId: to?.id,
          batchId: batchId ?? null,
          unit: m.unit ?? item.unit,
          unitQty: qty,
          note: m.note,
          reason: m.reason,
        }),
      ];
    }
    await writeAudit(tx, ctx, { action: 'ims.stock_entry', entityType: 'item', entityId: item.id, after: m });
    const last = results[results.length - 1]!;
    return {
      moveIds: results.map((r) => r.move.id),
      stock: last.stock,
      batchIds: results.map((r) => r.move.batchId).filter(Boolean),
      picks: results.flatMap((r) => r.picks.map((p) => ({ batchId: p.batchId, qty: p.qty }))),
    };
  });
}
export function toStockQtyOr400(item: StockItem, qty: number, unit?: string | null) {
  if (factorOf(item, unit) === null)
    throw new AppError(400, 'VALIDATION_FAILED', `${item.name} has no unit called ${unit}`);
  return toStockQty(item, qty, unit);
}
