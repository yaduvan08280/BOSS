import type { Db, Tx } from '@mono/db';
import { bandOf, itemSchema, parseItemRows, type Band } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { applyMove } from './moves';

const n = (d: unknown) => (d === null || d === undefined ? null : Number(d));
const saved = (i: { id: string; code: string; name: string }) => ({ id: i.id, code: i.code, name: i.name });
const OPEN_PO = ['DRAFT', 'SENT', 'PARTLY_RECEIVED'];

/** What is on order per item: ordered and not yet received, on open purchase orders (drafts too). */
export async function onOrderOf(db: Db | Tx, companyId: string, itemIds?: string[]) {
  const lines = await db.poLine.findMany({
    where: { companyId, po: { status: { in: OPEN_PO } }, ...(itemIds ? { itemId: { in: itemIds } } : {}) },
    select: { itemId: true, qty: true, receivedQty: true },
  });
  const out = new Map<string, number>();
  for (const l of lines)
    out.set(l.itemId, (out.get(l.itemId) ?? 0) + Math.max(0, Number(l.qty) - Number(l.receivedQty)));
  return out;
}

export type ItemRow = Awaited<ReturnType<typeof listItems>>['items'][number];

/** Stock today (§10.3): every item with its stock, MAX, band, value and what is on order. */
export async function listItems(db: Db, actor: Actor, opts: { includeOff?: boolean } = {}) {
  need(actor, 'ims.view', "You can't see stock");
  const items = await db.item.findMany({
    where: { companyId: actor.companyId, deletedAt: null, ...(opts.includeOff ? {} : { active: true }) },
    orderBy: [{ code: 'asc' }],
  });
  const onOrder = await onOrderOf(db, actor.companyId);
  const rows = items.map((i) => {
    const stock = Number(i.stock);
    const band: Band = bandOf(stock, n(i.maxQty), n(i.minQty));
    return {
      id: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      category: i.category,
      location: i.location,
      vendor: i.vendor,
      leadTimeDays: i.leadTimeDays,
      safetyFactor: Number(i.safetyFactor),
      maxQty: n(i.maxQty),
      minQty: n(i.minQty),
      stock,
      onOrder: onOrder.get(i.id) ?? 0,
      band,
      ratePaise: i.rate.toString(),
      valuePaise: String(Math.round(stock * Number(i.rate))),
      active: i.active,
      lastMovedAt: i.lastMovedAt,
      lastReviewAt: i.lastReviewAt,
    };
  });
  const counts = { red: 0, yellow: 0, green: 0, purple: 0, none: 0 } as Record<Band, number>;
  for (const r of rows) if (r.active) counts[r.band]++;
  const value = rows.reduce((s, r) => s + BigInt(r.valuePaise), 0n);
  return { items: rows, counts, valuePaise: value.toString() };
}

async function codeFree(db: Db | Tx, companyId: string, code: string, notId?: string) {
  const taken = await db.item.findFirst({
    where: {
      companyId,
      code: { equals: code, mode: 'insensitive' },
      deletedAt: null,
      ...(notId ? { id: { not: notId } } : {}),
    },
  });
  if (taken) throw new AppError(409, 'CONFLICT', `Code ${code} is already used by ${taken.name}`);
}

const dataOf = (i: z.infer<typeof itemSchema>) => ({
  code: i.code,
  name: i.name,
  unit: i.unit,
  category: i.category ?? null,
  location: i.location ?? null,
  leadTimeDays: i.leadTimeDays,
  safetyFactor: i.safetyFactor,
  maxQty: i.maxQty ?? null,
  minQty: i.minQty ?? null,
  rate: BigInt(i.ratePaise),
  vendor: i.vendor ?? null,
  active: i.active,
});

export const createItemSchema = itemSchema.extend({ openingQty: z.number().min(0).max(1e9).default(0) });

export async function createItem(db: Db, actor: Actor, input: z.input<typeof createItemSchema>) {
  need(actor, 'ims.edit', "You can't change the item master");
  const i = createItemSchema.parse(input);
  await codeFree(db, actor.companyId, i.code);
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const item = await tx.item.create({
      data: { companyId: actor.companyId, ...dataOf(i), band: bandOf(0, i.maxQty, i.minQty) },
    });
    if (i.openingQty > 0)
      await applyMove(tx, ctx, {
        itemId: item.id,
        type: 'IN',
        delta: i.openingQty,
        note: 'Opening stock',
        refType: 'import',
      });
    await writeAudit(tx, ctx, {
      action: 'ims.item_created',
      entityType: 'item',
      entityId: item.id,
      after: i,
    });
    return saved(item);
  });
}

export async function updateItem(db: Db, actor: Actor, id: string, input: z.input<typeof itemSchema>) {
  need(actor, 'ims.edit', "You can't change the item master");
  const i = itemSchema.parse(input);
  const before = await db.item.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!before) throw notFound('Item');
  await codeFree(db, actor.companyId, i.code, id);
  return db.$transaction(async (tx) => {
    const item = await tx.item.update({
      where: { id },
      data: { ...dataOf(i), band: bandOf(Number(before.stock), i.maxQty, i.minQty) },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.item_changed',
      entityType: 'item',
      entityId: id,
      before: { ...before, rate: before.rate.toString() },
      after: i,
    });
    return saved(item);
  });
}

/** Only an item with no stock and nothing on order can go (its moves stay as history). */
export async function deleteItem(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.edit', "You can't change the item master");
  const item = await db.item.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!item) throw notFound('Item');
  if (Number(item.stock) !== 0)
    throw new AppError(
      409,
      'CONFLICT',
      `${item.name} still has stock. Issue or adjust it to 0 first, or switch it off.`,
    );
  if ((await onOrderOf(db, actor.companyId, [id])).get(id))
    throw new AppError(409, 'CONFLICT', `${item.name} is on an open purchase order`);
  await db.$transaction(async (tx) => {
    await tx.item.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await writeAudit(tx, ctxOf(actor), { action: 'ims.item_deleted', entityType: 'item', entityId: id });
  });
  return { ok: true };
}

export const importSchema = z.object({
  table: z
    .array(z.array(z.string().max(300)).max(20))
    .min(1)
    .max(5001),
});

/** Item master + opening stock from Excel / CSV / a paste: all or nothing, every problem named by line. */
export async function importItems(db: Db, actor: Actor, input: z.infer<typeof importSchema>) {
  need(actor, 'ims.edit', "You can't change the item master");
  const existing = await db.item.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    select: { code: true },
  });
  const rows = parseItemRows(input.table, new Set(existing.map((e) => e.code.toLowerCase())));
  const bad = rows.filter((r) => r.errors.length);
  if (!rows.length) throw new AppError(400, 'VALIDATION_FAILED', 'Nothing to import');
  if (bad.length)
    throw new AppError(400, 'VALIDATION_FAILED', `${bad.length} line(s) need attention`, {
      lines: bad.map((r) => ({ line: r.line, errors: r.errors })),
    });
  const ctx = ctxOf(actor);
  await db.$transaction(
    async (tx) => {
      for (const r of rows) {
        const item = await tx.item.create({
          data: {
            companyId: actor.companyId,
            code: r.code,
            name: r.name,
            unit: r.unit,
            category: r.category,
            location: r.location,
            leadTimeDays: r.leadTimeDays,
            rate: BigInt(r.ratePaise),
            minQty: r.minQty,
            maxQty: r.maxQty,
            vendor: r.vendor,
            band: bandOf(0, r.maxQty, r.minQty),
          },
        });
        if (r.openingQty > 0)
          await applyMove(tx, ctx, {
            itemId: item.id,
            type: 'IN',
            delta: r.openingQty,
            note: 'Opening stock',
            refType: 'import',
          });
      }
      await writeAudit(tx, ctx, {
        action: 'ims.items_imported',
        entityType: 'item',
        entityId: actor.companyId,
        after: { count: rows.length },
      });
    },
    { timeout: 120_000 },
  );
  return { created: rows.length, opening: rows.filter((r) => r.openingQty > 0).length };
}

/** One item: its details, the last 100 moves and the MAX reviews. */
export async function itemDetail(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.view', "You can't see stock");
  const item = await db.item.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    include: {
      moves: { orderBy: { at: 'desc' }, take: 100 },
      reviews: { orderBy: { createdAt: 'desc' }, take: 10 },
      snapshots: { orderBy: { date: 'desc' }, take: 60 },
    },
  });
  if (!item) throw notFound('Item');
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    stock: Number(item.stock),
    maxQty: n(item.maxQty),
    band: bandOf(Number(item.stock), n(item.maxQty), n(item.minQty)),
    onOrder: (await onOrderOf(db, actor.companyId, [id])).get(id) ?? 0,
    moves: item.moves.map((m) => ({
      id: m.id,
      at: m.at,
      type: m.type,
      status: m.status,
      qty: Number(m.qty),
      balance: n(m.balance),
      reason: m.reason,
      note: m.note,
      refType: m.refType,
    })),
    reviews: item.reviews.map((r) => ({
      id: r.id,
      at: r.createdAt,
      status: r.status,
      change: r.change,
      safetyBefore: Number(r.safetyBefore),
      safetyAfter: Number(r.safetyAfter),
      maxBefore: n(r.maxBefore),
      maxAfter: Number(r.maxAfter),
    })),
    days: item.snapshots.map((s) => ({ date: s.date, qty: Number(s.qty), band: s.band })).reverse(),
  };
}
