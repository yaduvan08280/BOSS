import { addDays, daysBetween, weekdayOf } from '../work/calendar';
import type { ImsRules, MaxRules } from './rules';

/** CLAUDE.md §10.1 — the IMS arithmetic. Pure functions: the API and the worker share them. */

export const BANDS = ['red', 'yellow', 'green', 'purple', 'none'] as const;
export type Band = (typeof BANDS)[number];
const BAND_RANK: Record<Band, number> = { red: 0, yellow: 1, green: 2, purple: 3, none: 4 };

/** A quantity to show and store: whole units from 1 up, 3 decimals below. Rounds up (never short). */
export const roundUpQty = (n: number) =>
  n <= 0 ? 0 : n >= 1 ? Math.ceil(n - 1e-9) : Math.ceil(n * 1000 - 1e-6) / 1000;

/** Red < ⅓ of MAX (or under the minimum), yellow < ⅔, green up to MAX, purple above it. No MAX = none. */
export function bandOf(stock: number, max: number | null | undefined, min?: number | null): Band {
  if (min && stock < min) return 'red';
  if (!max || max <= 0) return 'none';
  const r = stock / max;
  return r < 1 / 3 ? 'red' : r < 2 / 3 ? 'yellow' : r <= 1 ? 'green' : 'purple';
}
/** The worse of two bands for a day: red wins, then purple (both need action), then yellow. */
export function worseBand(a: Band, b: Band): Band {
  const urgency = (x: Band) =>
    x === 'red' ? 0 : x === 'purple' ? 1 : x === 'yellow' ? 2 : x === 'green' ? 3 : 4;
  return urgency(a) <= urgency(b) ? a : b;
}
export const bandRank = (b: Band) => BAND_RANK[b];

/**
 * Average daily use: what went out (issues) over the last `days` days up to `asOf`, per day.
 * An item tracked for fewer days than that is averaged over the days it was tracked.
 */
export function averageDailyUse(
  outs: { date: string; qty: number }[],
  asOf: string,
  days: number,
  trackedSince?: string | null,
): number {
  const from = addDays(asOf, -days + 1);
  const used = outs.filter((o) => o.date >= from && o.date <= asOf).reduce((n, o) => n + o.qty, 0);
  let span = days;
  if (trackedSince && trackedSince > from) span = Math.max(1, daysBetween(trackedSince, asOf) + 1);
  return used / span;
}

/** MAX = average daily use × lead time (days) × safety factor, never below the item's minimum. */
export function computeMax(
  avgDailyUse: number,
  leadTimeDays: number,
  safetyFactor: number,
  min?: number | null,
) {
  return Math.max(roundUpQty(avgDailyUse * Math.max(1, leadTimeDays) * safetyFactor), min ?? 0);
}

export type ReviewProposal = {
  safetyFactor: number;
  change: 'raised' | 'lowered' | 'kept';
  redDays: number;
  purpleDays: number;
  avgDailyUse: number;
  max: number;
};

/**
 * The MAX review: red on enough days of the period → raise the safety factor one step; purple on enough
 * of it → lower it one step (not below the lowest); then MAX from the average use.
 */
export function reviewItem(input: {
  safetyFactor: number;
  leadTimeDays: number;
  minQty?: number | null;
  /** Each day's (worst) band in the review period. */
  bands: Band[];
  avgDailyUse: number;
  rules: MaxRules;
}): ReviewProposal {
  const { rules: r } = input;
  const redDays = input.bands.filter((b) => b === 'red').length;
  const purpleDays = input.bands.filter((b) => b === 'purple').length;
  let sf = input.safetyFactor;
  let change: ReviewProposal['change'] = 'kept';
  if (redDays >= r.raiseAfterRedDays) {
    sf += r.safetyStep;
    change = 'raised';
  } else if (
    purpleDays >= Math.ceil((r.reviewEveryDays * r.lowerWhenPurplePct) / 100) &&
    sf > r.lowestSafety
  ) {
    sf = Math.max(r.lowestSafety, sf - r.safetyStep);
    change = 'lowered';
  }
  sf = Math.round(sf * 100) / 100;
  return {
    safetyFactor: sf,
    change,
    redDays,
    purpleDays,
    avgDailyUse: Math.round(input.avgDailyUse * 1000) / 1000,
    max: computeMax(input.avgDailyUse, input.leadTimeDays, sf, input.minQty),
  };
}

/** OWS: order MAX − (stock + on order), when that total is short (below ⅔ of MAX, or under the minimum). */
export function owsLine(item: {
  stock: number;
  onOrder: number;
  maxQty: number | null;
  minQty?: number | null;
}) {
  const have = item.stock + item.onOrder;
  const band = bandOf(have, item.maxQty, item.minQty);
  const short = band === 'red' || band === 'yellow';
  const qty = item.maxQty ? roundUpQty(item.maxQty - have) : item.minQty ? roundUpQty(item.minQty - have) : 0;
  return { short: short && qty > 0, qty: short ? qty : 0, band };
}

/** The next order day on or after `today`, and whether today the list is open (N days ahead). */
export function orderDay(today: string, rules: ImsRules['ows']) {
  let d = today;
  while (weekdayOf(d) !== rules.orderWeekday) d = addDays(d, 1);
  const opensOn = addDays(d, -rules.daysAhead);
  return { date: d, opensOn, open: today >= opensOn };
}

/** Turns a year = what was used in the year (value) ÷ the average stock value. */
export function turnsOf(usedValueYear: number, avgStockValue: number): number | null {
  if (avgStockValue <= 0) return usedValueYear > 0 ? null : 0;
  return Math.round((usedValueYear / avgStockValue) * 10) / 10;
}

/** Items sorted by turns; the bottom N% (slowest, with stock) are offered for stopping. */
export function bottomByTurns<T extends { turns: number | null; value: number }>(
  items: T[],
  pct: number,
): T[] {
  const withStock = items.filter((i) => i.value > 0).sort((a, b) => (a.turns ?? 0) - (b.turns ?? 0));
  return withStock.slice(0, Math.ceil((withStock.length * pct) / 100));
}

/** Parsed rows of an item import (paste from Excel, CSV or .xlsx): Code, Name, Unit, … , Opening stock. */
export type ItemImportRow = {
  line: number;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  location: string | null;
  leadTimeDays: number;
  ratePaise: number;
  minQty: number | null;
  maxQty: number | null;
  vendor: string | null;
  openingQty: number;
  errors: string[];
};

const HEADS: Record<string, keyof ItemImportRow> = {
  code: 'code',
  'item code': 'code',
  name: 'name',
  item: 'name',
  'item name': 'name',
  unit: 'unit',
  uom: 'unit',
  category: 'category',
  group: 'category',
  location: 'location',
  bin: 'location',
  'lead time': 'leadTimeDays',
  'lead time days': 'leadTimeDays',
  'lead days': 'leadTimeDays',
  rate: 'ratePaise',
  price: 'ratePaise',
  min: 'minQty',
  'min qty': 'minQty',
  max: 'maxQty',
  'max qty': 'maxQty',
  vendor: 'vendor',
  supplier: 'vendor',
  stock: 'openingQty',
  'opening stock': 'openingQty',
  qty: 'openingQty',
  'opening qty': 'openingQty',
};
const DEFAULT_ORDER: (keyof ItemImportRow)[] = [
  'code',
  'name',
  'unit',
  'category',
  'location',
  'leadTimeDays',
  'ratePaise',
  'minQty',
  'maxQty',
  'vendor',
  'openingQty',
];

const num = (s: string) => {
  const t = s.replace(/[,₹\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

/** Reads the table; a first row of known headings sets the column order (else the default order). */
export function parseItemRows(table: string[][], existingCodes: Set<string> = new Set()): ItemImportRow[] {
  if (!table.length) return [];
  const head = table[0]!.map(
    (c) =>
      HEADS[
        c
          .trim()
          .toLowerCase()
          .replace(/[()₹*]/g, '')
          .trim()
      ],
  );
  const hasHead = head.filter(Boolean).length >= 2;
  const order = hasHead ? head : DEFAULT_ORDER;
  const seen = new Set<string>();
  return table.slice(hasHead ? 1 : 0).map((cells, i) => {
    const get = (k: keyof ItemImportRow) => {
      const at = order.indexOf(k);
      return at >= 0 ? (cells[at] ?? '').trim() : '';
    };
    const errors: string[] = [];
    const code = get('code');
    const name = get('name');
    if (!code) errors.push('Code is missing');
    if (name.length < 2) errors.push('Name is missing');
    const key = code.toLowerCase();
    if (code && seen.has(key)) errors.push('The same code is in the list twice');
    if (code && existingCodes.has(key)) errors.push('This code is already in the item master');
    seen.add(key);
    const n = (k: keyof ItemImportRow, label: string) => {
      const v = num(get(k));
      if (Number.isNaN(v) || (v !== null && v < 0)) {
        errors.push(`${label} must be a number`);
        return null;
      }
      return v;
    };
    const lead = n('leadTimeDays', 'Lead time');
    const rate = n('ratePaise', 'Rate');
    const opening = n('openingQty', 'Opening stock');
    return {
      line: i + (hasHead ? 2 : 1),
      code,
      name,
      unit: get('unit') || 'pcs',
      category: get('category') || null,
      location: get('location') || null,
      leadTimeDays: lead === null ? 7 : Math.round(lead),
      ratePaise: rate === null ? 0 : Math.round(rate * 100),
      minQty: n('minQty', 'Min'),
      maxQty: n('maxQty', 'MAX'),
      vendor: get('vendor') || null,
      openingQty: opening ?? 0,
      errors,
    };
  });
}
