import { nextCounter, currentReach, type Db, type Tx } from '@mono/db';
import { financialYear, localDate, type ItemUnit, type Made, type Tracking } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { places, type Place } from './ledger';

/** Small helpers shared by the phase-13 stock services. */
export const num = (d: unknown) => (d === null || d === undefined ? 0 : Number(d));
export const r3 = (n: number) => Math.round(n * 1000) / 1000;

export async function clockOf(db: Db | Tx, companyId: string) {
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  return { tz: c.timezone, today: localDate(new Date(), c.timezone), fyStart: c.fyStartMonth ?? 4 };
}
/** IND/26-27/0001 and the like, through `Counter`. */
export async function paperNumber(tx: Tx, companyId: string, prefix: string) {
  const c = await clockOf(tx, companyId);
  const fy = financialYear(new Date(), c.tz, c.fyStart).short;
  const n = await nextCounter(tx, companyId, prefix.toLowerCase(), fy);
  return `${prefix}/${fy}/${String(n).padStart(4, '0')}`;
}

export type StockItem = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  unit: string;
  units: ItemUnit[];
  tracking: Tracking;
  made: Made;
  rate: number;
  category: string | null;
  secondUnit: string | null;
  pricedBy: string;
  taxCode: string | null;
  hsn: string | null;
  sellPrice: number | null;
  rateKey: string | null;
  rateFactor: number | null;
  shelfLifeDays: number | null;
  active: boolean;
};
type Row = Awaited<ReturnType<Db['item']['findFirstOrThrow']>>;
export const asStockItem = (i: Row): StockItem => ({
  id: i.id,
  companyId: i.companyId,
  code: i.code,
  name: i.name,
  unit: i.unit,
  units: (i.units as ItemUnit[] | null) ?? [],
  tracking: i.tracking as Tracking,
  made: i.made as Made,
  rate: Number(i.rate),
  category: i.category,
  secondUnit: i.secondUnit,
  pricedBy: i.pricedBy,
  taxCode: i.taxCode,
  hsn: i.hsn,
  sellPrice: i.sellPrice === null ? null : Number(i.sellPrice),
  rateKey: i.rateKey,
  rateFactor: i.rateFactor === null ? null : Number(i.rateFactor),
  shelfLifeDays: i.shelfLifeDays,
  active: i.active,
});
/** The items named, by id; one that is missing (or another company's) is refused. */
export async function itemsOf(db: Db | Tx, companyId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await db.item.findMany({ where: { companyId, id: { in: unique }, deletedAt: null } });
  if (rows.length !== unique.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'An item is not in the item master');
  return {
    rows: new Map(rows.map((r) => [r.id, r])),
    items: new Map(rows.map((r) => [r.id, asStockItem(r)])),
  };
}

/**
 * The places this person's reach covers: someone who sees the whole group sees every place; someone limited to
 * branches sees the locations of those branches only (the main store is head office's).
 */
export async function reachPlaces(db: Db | Tx, companyId: string): Promise<Map<string, Place>> {
  const all = await places(db, companyId);
  const reach = currentReach();
  if (!reach || reach.branchIds === null) {
    if (reach?.exceptBranchIds?.length)
      for (const [id, p] of all) if (p.branchId && reach.exceptBranchIds.includes(p.branchId)) all.delete(id);
    return all;
  }
  // The main store and goods in transit have no branch: they are head office's, for people who see the whole group.
  const mine = new Set(reach.branchIds);
  for (const [id, p] of all) if (!p.branchId || !mine.has(p.branchId)) all.delete(id);
  return all;
}
export async function needPlace(db: Db | Tx, companyId: string, id: string | null | undefined) {
  const p = (await reachPlaces(db, companyId)).get(id ?? '');
  if (!p) throw new AppError(403, 'FORBIDDEN', 'That location is not one of yours');
  return p;
}
