/**
 * Tax as data (phase 12M). Nothing about any country's tax is built in: the accountant types each rate with the
 * day it starts, and the entity's tax profile says which regime it works under. Amounts are whole minor units.
 */
export type TaxRateRow = {
  /** What a line names: "GST5", "VAT", "ROOM". */
  code: string;
  name: string;
  percent: number;
  /** YYYY-MM-DD: the first day this row applies. */
  from: string;
  /**
   * Tax by price slab: the rate depends on the price of one unit (a room night up to ₹7,500 → 12%, above → 18%).
   * Slabs are read in order; `upTo` is in minor units and null means "anything above".
   */
  slabs?: { upTo: number | null; percent: number }[] | null;
};

/** The row of a code that applies on a day: the latest one that has started. Null when none has. */
export function rateOn(rows: TaxRateRow[], code: string, date: string): TaxRateRow | null {
  let best: TaxRateRow | null = null;
  for (const r of rows) if (r.code === code && r.from <= date && (!best || r.from > best.from)) best = r;
  return best;
}

/** The percent for a line: the code's rate on the bill's day, by the unit price where the rate has slabs. */
export function percentFor(
  rows: TaxRateRow[],
  code: string | null | undefined,
  date: string,
  unitPrice: number,
) {
  if (!code) return 0;
  const row = rateOn(rows, code, date);
  if (!row) return 0;
  if (row.slabs?.length) {
    for (const s of row.slabs) if (s.upTo === null || unitPrice <= s.upTo) return s.percent;
    return row.slabs.at(-1)!.percent;
  }
  return row.percent;
}

export type TaxRegime = 'GST' | 'VAT' | 'SALES_TAX' | 'NONE';
export type TaxPart = { name: string; percent: number; amount: number };

/**
 * How a line's tax is named and split. GST: half CGST and half SGST when the buyer is in the seller's state,
 * one IGST when not. VAT and sales tax: one amount. No tax: nothing.
 */
export function splitTax(regime: TaxRegime, percent: number, tax: number, sameState: boolean): TaxPart[] {
  if (regime === 'NONE' || !percent || !tax) return [];
  if (regime === 'GST') {
    if (!sameState) return [{ name: 'IGST', percent, amount: tax }];
    const half = Math.floor(tax / 2);
    return [
      { name: 'CGST', percent: percent / 2, amount: half },
      { name: 'SGST', percent: percent / 2, amount: tax - half },
    ];
  }
  return [{ name: regime === 'VAT' ? 'VAT' : 'Sales tax', percent, amount: tax }];
}
