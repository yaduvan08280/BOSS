import type { Db, Tx } from '@mono/db';
import { boardPrice, pickPrice, rateOnBoard, type PriceListLite } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { resolveEntry } from './stock-entry';
import { clockOf, itemsOf, type StockItem } from './v2';

/**
 * Phase 13 — price lists (per kind of party, branch and date) and the rate board (a rate typed for the day
 * that prices items by weight). One rule answers "what does this cost this party here today?" for the counter,
 * transfers and, later, the POS.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const priceListSchema = z.object({
  name: z.string().trim().min(2).max(80),
  partyKind: z.string().trim().max(20).nullish(),
  branchId: z.string().nullish(),
  from: day,
  to: day.nullish(),
  active: z.boolean().default(true),
  lines: z.array(z.object({ itemId: z.string(), price: z.number().int().min(0).max(1e13) })).max(5000),
});

export async function savePriceList(
  db: Db,
  actor: Actor,
  input: z.input<typeof priceListSchema>,
  id?: string,
) {
  need(actor, 'ims.admin', 'Only inventory admins set prices');
  const p = priceListSchema.parse(input);
  if (p.to && p.to < p.from) throw new AppError(400, 'VALIDATION_FAILED', 'The list ends before it starts');
  if (p.branchId && !(await db.branch.count({ where: { id: p.branchId, companyId: actor.companyId } })))
    throw notFound('Branch');
  if (new Set(p.lines.map((l) => l.itemId)).size !== p.lines.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'An item is on the list twice');
  await itemsOf(
    db,
    actor.companyId,
    p.lines.map((l) => l.itemId),
  );
  if (id && !(await db.priceList.count({ where: { id, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Price list');
  return db.$transaction(async (tx) => {
    const head = {
      name: p.name,
      partyKind: p.partyKind || null,
      branchId: p.branchId || null,
      from: p.from,
      to: p.to ?? null,
      active: p.active,
    };
    const row = id
      ? await tx.priceList.update({ where: { id }, data: head })
      : await tx.priceList.create({ data: { companyId: actor.companyId, ...head } });
    await tx.priceListLine.deleteMany({ where: { listId: row.id } });
    if (p.lines.length)
      await tx.priceListLine.createMany({
        data: p.lines.map((l) => ({
          companyId: actor.companyId,
          listId: row.id,
          itemId: l.itemId,
          price: BigInt(l.price),
        })),
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.price_list_saved',
      entityType: 'price_list',
      entityId: row.id,
      after: p,
    });
    return { id: row.id };
  });
}
export async function deletePriceList(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.admin', 'Only inventory admins set prices');
  const done = await db.priceList.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Price list');
  return { ok: true };
}
export async function listPriceLists(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see prices");
  const rows = await db.priceList.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    include: { lines: true },
    orderBy: [{ from: 'desc' }, { name: 'asc' }],
  });
  const names = new Map(
    (
      await db.item.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: [...new Set(rows.flatMap((r) => r.lines.map((l) => l.itemId)))] },
        },
        select: { id: true, name: true, code: true, unit: true },
      })
    ).map((i) => [i.id, i]),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    partyKind: r.partyKind,
    branchId: r.branchId,
    from: r.from,
    to: r.to,
    active: r.active,
    lines: r.lines.map((l) => ({
      itemId: l.itemId,
      price: Number(l.price),
      item: names.get(l.itemId) ?? null,
    })),
  }));
}

export const rateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .transform((s) => s.toUpperCase()),
  date: day.optional(),
  rate: z.number().int().min(0).max(1e13),
  unit: z.string().trim().max(12).nullish(),
});
/** Today's (or a day's) rate on the board; typing it again that day replaces it. */
export async function setRate(db: Db, actor: Actor, input: z.input<typeof rateSchema>) {
  need(actor, 'ims.edit', "You can't set the day's rates");
  const r = rateSchema.parse(input);
  const date = r.date ?? (await clockOf(db, actor.companyId)).today;
  await db.$transaction(async (tx) => {
    await tx.rateBoard.upsert({
      where: { companyId_key_date: { companyId: actor.companyId, key: r.key, date } },
      create: {
        companyId: actor.companyId,
        key: r.key,
        date,
        rate: BigInt(r.rate),
        unit: r.unit ?? null,
        createdById: actor.userId,
      },
      update: { rate: BigInt(r.rate), unit: r.unit ?? null, createdById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.rate_set',
      entityType: 'rate_board',
      entityId: `${r.key}:${date}`,
      after: { ...r, date },
    });
  });
  return rateBoard(db, actor);
}
/** The board: each key's latest rate and its last few days. */
export async function rateBoard(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see prices");
  const rows = await db.rateBoard.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ key: 'asc' }, { date: 'desc' }],
    take: 2000,
  });
  const keys = new Map<
    string,
    {
      key: string;
      unit: string | null;
      rate: number;
      date: string;
      history: { date: string; rate: number }[];
    }
  >();
  for (const r of rows) {
    const k = keys.get(r.key) ?? {
      key: r.key,
      unit: r.unit,
      rate: Number(r.rate),
      date: r.date,
      history: [],
    };
    if (k.history.length < 10) k.history.push({ date: r.date, rate: Number(r.rate) });
    keys.set(r.key, k);
  }
  return [...keys.values()];
}

export type Priced = {
  /** Minor units for one priced unit (a stock unit, or one unit of weight for a rate-board item). */
  price: number;
  source: 'board' | 'list' | 'item' | 'none';
  listId: string | null;
  pricedBy: 'unit' | 'second';
};
/** What an item costs a party at a branch on a day: the rate board, then the best price list, then its own price. */
export async function priceFor(
  db: Db | Tx,
  companyId: string,
  item: StockItem,
  ask: { partyKinds: string[]; branchId: string | null; date: string },
): Promise<Priced> {
  const pricedBy = item.pricedBy === 'second' ? 'second' : 'unit';
  if (item.rateKey) {
    const rows = await db.rateBoard.findMany({
      where: { companyId, key: item.rateKey, date: { lte: ask.date } },
      orderBy: { date: 'desc' },
      take: 1,
    });
    const rate = rateOnBoard(
      rows.map((r) => ({ date: r.date, rate: Number(r.rate) })),
      ask.date,
    );
    if (rate === null)
      throw new AppError(
        409,
        'CONFLICT',
        `There is no ${item.rateKey} rate on the board for ${ask.date} yet`,
      );
    return { price: boardPrice(rate, 1, item.rateFactor ?? 1), source: 'board', listId: null, pricedBy };
  }
  const lists = await db.priceList.findMany({
    where: {
      companyId,
      deletedAt: null,
      active: true,
      from: { lte: ask.date },
      lines: { some: { itemId: item.id } },
    },
    include: { lines: { where: { itemId: item.id } } },
  });
  const lite: PriceListLite[] = lists.map((l) => ({
    id: l.id,
    partyKind: l.partyKind,
    branchId: l.branchId,
    from: l.from,
    to: l.to,
    prices: new Map(l.lines.map((x) => [x.itemId, Number(x.price)])),
  }));
  const best = pickPrice(lite, { itemId: item.id, ...ask });
  if (best) return { price: best.price, source: 'list', listId: best.listId, pricedBy };
  if (item.sellPrice !== null) return { price: item.sellPrice, source: 'item', listId: null, pricedBy };
  return { price: 0, source: 'none', listId: null, pricedBy };
}

export const quoteSchema = z
  .object({
    itemId: z.string().optional(),
    barcode: z.string().optional(),
    batchId: z.string().optional(),
    partyId: z.string().optional(),
    branchId: z.string().optional(),
    date: day.optional(),
  })
  .refine((m) => m.itemId || m.barcode, { message: 'Choose an item or scan a code' });
/** A price check: this item (or scanned piece) for this party at this branch on this day. */
export async function quote(db: Db, actor: Actor, input: z.input<typeof quoteSchema>) {
  need(actor, 'ims.view', "You can't see prices");
  const q = quoteSchema.parse(input);
  const { item, batchId } = await resolveEntry(db, actor.companyId, q);
  const party = q.partyId
    ? await db.party.findFirst({ where: { id: q.partyId, companyId: actor.companyId } })
    : null;
  const date = q.date ?? (await clockOf(db, actor.companyId)).today;
  const p = await priceFor(db, actor.companyId, item, {
    partyKinds: party?.kinds ?? [],
    branchId: q.branchId ?? null,
    date,
  });
  const batch = batchId ? await db.stockBatch.findUnique({ where: { id: batchId } }) : null;
  const weight = batch?.qty2 === null || batch?.qty2 === undefined ? null : Number(batch.qty2);
  return {
    item: { id: item.id, code: item.code, name: item.name, unit: item.unit, secondUnit: item.secondUnit },
    batch: batch ? { id: batch.id, code: batch.code, weight, attrs: batch.attrs } : null,
    ...p,
    /** One piece of a weight-priced item: the price × its weight. */
    amount: p.pricedBy === 'second' && weight !== null ? Math.round(p.price * weight) : p.price,
  };
}
