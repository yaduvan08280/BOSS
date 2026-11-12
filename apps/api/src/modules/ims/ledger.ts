import type { Item, Prisma, Tx, Db } from '@mono/db';
import { IN_TRANSIT, MAIN_STORE, pickFefo } from '@mono/shared';
import { AppError } from '../../lib/errors';

/**
 * Phase 13 — the stock ledger per location. `Item.stock` is the total; these rows say where it is and, for
 * batch / serial / lot items, which batch. Every change goes through `applyMove` (moves.ts), which calls
 * `putIn`, `takeOut` or `moveBetween` here in the same transaction. A decrease is one guarded UPDATE per
 * balance row, so two people taking the last unit at a location can't both succeed.
 */
const show = (q: number) => String(Math.round(q * 1000) / 1000);
const key = (itemId: string, locationId: string, batchId: string) => ({
  itemId_locationId_batchId: { itemId, locationId, batchId },
});

/** Stock from before locations (or written straight into the table by a seed) is taken as the main store's. */
export async function adopt(tx: Tx, item: Pick<Item, 'id' | 'companyId' | 'stock' | 'rate'>) {
  const stock = Number(item.stock);
  if (stock === 0) return;
  if (await tx.stockBalance.count({ where: { itemId: item.id } })) return;
  await tx.stockBalance.create({
    data: {
      companyId: item.companyId,
      itemId: item.id,
      locationId: MAIN_STORE,
      batchId: '',
      qty: stock,
      value: BigInt(Math.round(stock * Number(item.rate))),
    },
  });
}

export async function putIn(
  tx: Tx,
  item: Pick<Item, 'id' | 'companyId'>,
  at: { locationId: string; batchId?: string | null },
  qty: number,
  value: number,
  qty2 = 0,
) {
  const batchId = at.batchId ?? '';
  await tx.stockBalance.upsert({
    where: key(item.id, at.locationId, batchId),
    create: {
      companyId: item.companyId,
      itemId: item.id,
      locationId: at.locationId,
      batchId,
      qty,
      qty2,
      value: BigInt(Math.round(value)),
    },
    update: {
      qty: { increment: qty },
      qty2: { increment: qty2 },
      value: { increment: BigInt(Math.round(value)) },
    },
  });
}

export type Pick_ = { batchId: string; qty: number; value: number; qty2: number };

/**
 * Take a quantity out of a location. With a batch named, from that batch; otherwise first expired first out
 * over the location's batches (an expired batch is never taken unless `allowExpired`, e.g. to write it off).
 */
export async function takeOut(
  tx: Tx,
  item: Pick<Item, 'id' | 'name' | 'unit' | 'tracking'>,
  at: { locationId: string; batchId?: string | null },
  qty: number,
  opts: { today: string; allowExpired?: boolean; where?: string } = { today: '9999-12-31' },
): Promise<Pick_[]> {
  const rows = await tx.stockBalance.findMany({
    where: {
      itemId: item.id,
      locationId: at.locationId,
      qty: { gt: 0 },
      ...(at.batchId ? { batchId: at.batchId } : {}),
    },
  });
  if (item.tracking === 'SERIAL' && !at.batchId)
    throw new AppError(400, 'VALIDATION_FAILED', `Say which piece of ${item.name} it is`);
  const batchIds = rows.map((r) => r.batchId).filter(Boolean);
  const expiry = new Map(
    batchIds.length
      ? (
          await tx.stockBatch.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, expiry: true },
          })
        ).map((b) => [b.id, b.expiry])
      : [],
  );
  const { picks, short, expired } = pickFefo(
    rows.map((r) => ({ batchId: r.batchId, qty: Number(r.qty), expiry: expiry.get(r.batchId) ?? null })),
    qty,
    opts.allowExpired ? '0000-01-01' : opts.today,
  );
  if (short > 0) {
    const have = qty - short;
    const where = opts.where ? ` at ${opts.where}` : '';
    throw new AppError(
      409,
      'CONFLICT',
      expired > 0
        ? `Only ${show(have)} ${item.unit} of ${item.name} can be used${where}: ${show(expired)} ${item.unit} has expired`
        : `Only ${show(have)} ${item.unit} of ${item.name} in stock${where}`,
      { short, expired },
    );
  }
  const out: Pick_[] = [];
  for (const p of picks) {
    const row = rows.find((r) => r.batchId === p.batchId)!;
    const whole = Number(row.qty);
    const share = whole > 0 ? p.qty / whole : 0;
    const value = Math.round(Number(row.value) * share);
    const qty2 = Math.round(Number(row.qty2) * share * 1000) / 1000;
    const done = await tx.stockBalance.updateMany({
      where: { id: row.id, qty: { gte: p.qty } },
      data: { qty: { decrement: p.qty }, qty2: { decrement: qty2 }, value: { decrement: BigInt(value) } },
    });
    if (!done.count)
      throw new AppError(409, 'CONFLICT', `${item.name} was just taken by someone else — try again`);
    out.push({ batchId: p.batchId, qty: p.qty, value, qty2 });
  }
  return out;
}

/** Take from one location and put the same batches, value and weight into another. */
export async function moveBetween(
  tx: Tx,
  item: Pick<Item, 'id' | 'companyId' | 'name' | 'unit' | 'tracking'>,
  from: { locationId: string; batchId?: string | null },
  toLocationId: string,
  qty: number,
  opts: { today: string; allowExpired?: boolean; where?: string },
) {
  const picks = await takeOut(tx, item, from, qty, opts);
  for (const p of picks)
    await putIn(tx, item, { locationId: toLocationId, batchId: p.batchId }, p.qty, p.value, p.qty2);
  return picks;
}

export type BatchInput = {
  code: string;
  kind?: 'BATCH' | 'SERIAL' | 'LOT';
  expiry?: string | null;
  mfg?: string | null;
  rate?: bigint | number | null;
  attrs?: Prisma.InputJsonValue | null;
  qty2?: number | null;
  barcode?: string | null;
};
/** The batch / piece with this number for the item — made when it is new. A serial number is one piece, once. */
export async function ensureBatch(
  tx: Tx,
  item: Pick<Item, 'id' | 'companyId' | 'tracking' | 'name'>,
  b: BatchInput,
) {
  const code = b.code.trim();
  if (!code) throw new AppError(400, 'VALIDATION_FAILED', 'The batch needs a number');
  const kind = b.kind ?? (item.tracking === 'SERIAL' ? 'SERIAL' : item.tracking === 'LOT' ? 'LOT' : 'BATCH');
  const had = await tx.stockBatch.findUnique({
    where: { companyId_itemId_code: { companyId: item.companyId, itemId: item.id, code } },
  });
  if (had) {
    if (kind === 'SERIAL')
      throw new AppError(409, 'CONFLICT', `${item.name} already has a piece numbered ${code}`);
    return had;
  }
  return tx.stockBatch.create({
    data: {
      companyId: item.companyId,
      itemId: item.id,
      kind,
      code,
      expiry: b.expiry ?? null,
      mfg: b.mfg ?? null,
      rate: BigInt(b.rate ?? 0),
      attrs: b.attrs ?? undefined,
      qty2: b.qty2 ?? null,
      barcode: b.barcode?.trim() || null,
    },
  });
}

export type Place = {
  id: string;
  name: string;
  kind: string;
  branchId: string | null;
  branch: string | null;
};
const MAIN: Place = { id: MAIN_STORE, name: 'Main store', kind: 'STORE', branchId: null, branch: null };
const TRANSIT: Place = { id: IN_TRANSIT, name: 'In transit', kind: 'TRANSIT', branchId: null, branch: null };

/** Every place stock can be: the main store, the company's locations (with their branch), goods in transit. */
export async function places(db: Db | Tx, companyId: string): Promise<Map<string, Place>> {
  const rows = await db.location.findMany({
    where: { companyId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  const branches = new Map(
    (
      await db.branch.findMany({
        where: { companyId, id: { in: [...new Set(rows.map((r) => r.branchId))] } },
        select: { id: true, name: true },
      })
    ).map((b) => [b.id, b.name]),
  );
  const out = new Map<string, Place>([[MAIN.id, MAIN]]);
  for (const r of rows)
    out.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      branchId: r.branchId,
      branch: branches.get(r.branchId) ?? null,
    });
  out.set(TRANSIT.id, TRANSIT);
  return out;
}
/** One place by id; a location that is not this company's is refused. */
export async function placeOf(db: Db | Tx, companyId: string, id: string | null | undefined): Promise<Place> {
  if (!id) return MAIN;
  if (id === IN_TRANSIT) return TRANSIT;
  const p = (await places(db, companyId)).get(id);
  if (!p) throw new AppError(400, 'VALIDATION_FAILED', 'That location is not one of yours');
  return p;
}
