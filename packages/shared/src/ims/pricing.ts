/**
 * Phase 13 — price lists and the rate board (pure rules).
 *
 * A price list is for a kind of party (dealer, walk-in …), a branch, both or neither, from a date. The price of
 * an item is taken from the most specific list that holds it: party kind + branch, then party kind, then branch,
 * then a list for everyone; among equals the newest start date wins. With no list, the item's own selling price.
 * A rate-board item is priced by the day's rate × its weight (the second unit) × its factor (purity).
 */
export type PriceListLite = {
  id: string;
  partyKind: string | null;
  branchId: string | null;
  from: string;
  to: string | null;
  prices: Map<string, number>;
};
export type PriceAsk = { itemId: string; partyKinds: string[]; branchId: string | null; date: string };

const rank = (l: PriceListLite) => (l.partyKind ? 2 : 0) + (l.branchId ? 1 : 0);

export function pickPrice(lists: PriceListLite[], ask: PriceAsk): { price: number; listId: string } | null {
  const fits = lists
    .filter(
      (l) =>
        l.prices.has(ask.itemId) &&
        l.from <= ask.date &&
        (!l.to || l.to >= ask.date) &&
        (!l.partyKind || ask.partyKinds.includes(l.partyKind)) &&
        (!l.branchId || l.branchId === ask.branchId),
    )
    .sort((a, b) => rank(b) - rank(a) || b.from.localeCompare(a.from));
  const best = fits[0];
  return best ? { price: best.prices.get(ask.itemId)!, listId: best.id } : null;
}

/** The newest rate on or before a day; null when the board has none yet. */
export function rateOnBoard(rows: { date: string; rate: number }[], date: string): number | null {
  const fit = rows.filter((r) => r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
  return fit ? fit.rate : null;
}
/** A piece priced by weight: rate per unit of weight × weight × factor (0.916 for 22 k against a 24 k rate). */
export const boardPrice = (rate: number, weight: number, factor = 1) => Math.round(rate * weight * factor);
