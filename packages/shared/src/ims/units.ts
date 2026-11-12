import { z } from 'zod';

/**
 * Phase 13 — units, batches and valuation (pure rules, shared with the browser).
 *
 * An item keeps stock in ONE unit (its stock unit). Other units are only ways of saying a quantity: each has a
 * factor = how many stock units one of it holds (a case of 12 bottles of 750 ml, kept in ml: case 9000, bottle
 * 750, peg 30). Every move stores the unit that was used and the quantity converted to the stock unit.
 */
export const TRACKING = ['QTY', 'BATCH', 'SERIAL', 'LOT'] as const;
export type Tracking = (typeof TRACKING)[number];
/** BUY: bought and stocked. MAKE: produced (a production order) and stocked. DISH: never stocked — its recipe is used. */
export const MADE = ['BUY', 'MAKE', 'DISH'] as const;
export type Made = (typeof MADE)[number];

export const unitSchema = z.object({
  unit: z.string().trim().min(1).max(12),
  factor: z.number().positive().max(1e9),
  /** A serving (a peg, a glass): what is sold, not a container stock is held in. */
  serve: z.boolean().optional(),
});
/** The container stock is opened from (the bottle, not the case): the smallest non-serving unit above the stock unit. */
export const packUnit = (units: ItemUnit[] | null | undefined) =>
  (units ?? []).filter((u) => !u.serve && u.factor > 1).sort((a, b) => a.factor - b.factor)[0] ?? null;
/** The serving stock is sold in (the peg). */
export const serveUnit = (units: ItemUnit[] | null | undefined) =>
  (units ?? []).filter((u) => u.serve).sort((a, b) => a.factor - b.factor)[0] ?? null;
export type ItemUnit = z.infer<typeof unitSchema>;
export type UnitItem = { unit: string; units?: ItemUnit[] | null };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** How many stock units one `unit` holds; null when the item does not know the unit. */
export function factorOf(item: UnitItem, unit?: string | null): number | null {
  if (!unit || unit.toLowerCase() === item.unit.toLowerCase()) return 1;
  const u = (item.units ?? []).find((x) => x.unit.toLowerCase() === unit.toLowerCase());
  return u ? u.factor : null;
}
/** A quantity said in any of the item's units, in the stock unit. Throws on a unit the item does not have. */
export function toStockQty(item: UnitItem, qty: number, unit?: string | null): number {
  const f = factorOf(item, unit);
  if (f === null) throw new Error(`UNKNOWN_UNIT:${unit}`);
  return round3(qty * f);
}
export function fromStockQty(item: UnitItem, qty: number, unit?: string | null): number {
  const f = factorOf(item, unit);
  if (f === null) throw new Error(`UNKNOWN_UNIT:${unit}`);
  return round3(qty / f);
}
/** Stock said in a bigger unit and what is left over: 8 670 ml of 750 ml bottles = 11 full + 420 ml open. */
export function wholeAndOpen(qty: number, factor: number) {
  const whole = Math.floor(qty / factor + 1e-9);
  return { whole, open: round3(qty - whole * factor) };
}

export type BatchStock = { batchId: string; qty: number; expiry: string | null };
/**
 * First expired, first out: the batches to take a quantity from, soonest expiry first (no expiry last). Expired
 * batches (expiry before today) are never picked. `short` is what could not be found.
 */
export function pickFefo(batches: BatchStock[], need: number, today: string) {
  const usable = batches
    .filter((b) => b.qty > 0 && (!b.expiry || b.expiry >= today))
    .sort((a, b) => (a.expiry ?? '9999-12-31').localeCompare(b.expiry ?? '9999-12-31'));
  const picks: { batchId: string; qty: number }[] = [];
  let left = round3(need);
  for (const b of usable) {
    if (left <= 0) break;
    const take = Math.min(left, b.qty);
    picks.push({ batchId: b.batchId, qty: round3(take) });
    left = round3(left - take);
  }
  const expired = round3(
    batches.filter((b) => b.qty > 0 && b.expiry && b.expiry < today).reduce((n, b) => n + b.qty, 0),
  );
  return { picks, short: Math.max(0, left), expired };
}
/** Days from today to an expiry date (negative = already expired). */
export const daysToExpiry = (expiry: string, today: string) =>
  Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

/**
 * FIFO value of what is on hand: the newest receipts cover it (older ones were issued first). Receipts are
 * `{ qty, rate }` newest first; a quantity no receipt covers is valued at `fallbackRate`.
 */
export function fifoValue(
  receiptsNewestFirst: { qty: number; rate: number }[],
  onHand: number,
  fallbackRate = 0,
) {
  let left = onHand;
  let value = 0;
  for (const r of receiptsNewestFirst) {
    if (left <= 0) break;
    const take = Math.min(left, r.qty);
    value += take * r.rate;
    left -= take;
  }
  return Math.round(value + Math.max(0, left) * fallbackRate);
}
/** Weighted average after a receipt: the old stock's value plus the new, over the whole quantity. */
export function averageRate(qty: number, value: number, inQty: number, inRate: number) {
  const total = qty + inQty;
  return total > 0 ? Math.round((value + inQty * inRate) / total) : inRate;
}

/** A count against the system: what is missing (−) or extra (+), and its share of what should have been used. */
export function varianceOf(system: number, counted: number, theoretical: number, flagPct: number) {
  const diff = round3(counted - system);
  const pct =
    theoretical > 0 ? Math.round((Math.abs(diff) / theoretical) * 1000) / 10 : diff === 0 ? 0 : null;
  return { diff, pct, flagged: pct === null ? diff !== 0 : pct > flagPct };
}

export const WASTE_REASONS = [
  'SPOILED',
  'OVER_PRODUCTION',
  'RETURNED_DISH',
  'BREAKAGE',
  'STAFF_MEAL',
  'COMPLIMENTARY',
  'EXPIRED',
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

/** Pseudo-locations: the company's main store (stock from before locations) and goods on the road. */
export const MAIN_STORE = '';
export const IN_TRANSIT = '~transit';
