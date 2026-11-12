import { tzOffsetMinutes, zonedToUtc } from '../work/calendar';
import type { FormulaResult, SumColumn } from './types';

const DAY = 86_400_000;

/**
 * What an expression works with. `null` is "no value": a field left empty, a division by zero, anything that
 * can't be worked out. A date is a calendar day; a date-time is kept as the clock people see in the company
 * time zone (so "the day of" a date-time is the day on their calendar, not UTC's).
 */
export type Val =
  | number
  | boolean
  | { t: 'date'; day: number }
  | { t: 'dt'; ms: number }
  | { t: 'text'; v: string }
  | { t: 'items'; lines: Record<SumColumn, number>[] }
  | null;

export type Kind = 'num' | 'bool' | 'date' | 'dt' | 'text' | 'items';

export const kindOf = (v: Exclude<Val, null>): Kind =>
  typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : v.t;

/** Field types a formula can read, and what they are to it. Everything else (photos, files, long text…) can't be used. */
const FIELD_KINDS: Record<string, Kind> = {
  number: 'num',
  amount: 'num',
  date: 'date',
  datetime: 'dt',
  yesno: 'bool',
  text: 'text',
  dropdown: 'text',
  master: 'text',
  items: 'items',
};

export const fieldKind = (type: string): Kind | null =>
  Object.hasOwn(FIELD_KINDS, type) ? FIELD_KINDS[type]! : null;

/** Half away from zero, without the usual floating-point slips (1.005 → 1.01). `places` −9…9. */
export function roundTo(x: number, places: number): number {
  const unit = 10 ** Math.abs(places);
  const scaled = places >= 0 ? Math.abs(x) * unit : Math.abs(x) / unit;
  const whole = Math.round(Number(scaled.toPrecision(15)));
  const out = Math.sign(x) * (places >= 0 ? whole / unit : whole * unit);
  return Number.isFinite(out) ? out || 0 : NaN;
}

/** A number as it is stored, or as it is being typed in a form ("1,200", "₹ 450.50"). */
function toNumber(raw: unknown, typed: boolean): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (!typed || typeof raw !== 'string') return null;
  const s = raw.replace(/[,₹\s]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  return Number(s);
}

function toDate(raw: unknown): Val {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  if (!m) return null;
  const ms = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  // A real calendar date (31/02 is not).
  if (new Date(ms).toISOString().slice(0, 10) !== raw) return null;
  return { t: 'date', day: ms / DAY };
}

/** `2026-11-12T14:30` is the clock as typed in a form; with `Z` or an offset it is a stored instant. */
function toDateTime(raw: unknown, tz: string): Val {
  if (typeof raw !== 'string') return null;
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(raw);
  if (local) {
    const ms = Date.UTC(+local[1]!, +local[2]! - 1, +local[3]!, +local[4]!, +local[5]!, +(local[6] ?? 0));
    return Number.isFinite(ms) ? { t: 'dt', ms } : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(raw)) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return { t: 'dt', ms: at + tzOffsetMinutes(new Date(at), tz) * 60_000 };
}

function toItems(raw: unknown): Val {
  if (!Array.isArray(raw)) return null;
  const lines: Record<SumColumn, number>[] = [];
  for (const line of raw as unknown[]) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) continue;
    const own = (k: string) => (Object.hasOwn(line, k) ? (line as Record<string, unknown>)[k] : undefined);
    const qty = toNumber(own('qty'), true);
    // A line being typed may have no rate yet; the server counts that as 0.
    const rate = own('rate') === undefined || own('rate') === '' ? 0 : toNumber(own('rate'), true);
    if (qty === null || rate === null) continue;
    // A saved line carries its amount; a line still being typed gets it the way `checkFields` will work it out.
    const amount = toNumber(own('amount'), false) ?? Math.round(qty * rate * 100) / 100;
    lines.push({ qty, rate, amount });
  }
  return lines.length ? { t: 'items', lines } : null;
}

/**
 * A stored (or half-typed) form value as the formula sees it. With the field's type it is read as that type;
 * without one (a value from the start form or an earlier step, another formula's answer) by what it looks like.
 */
export function toVal(raw: unknown, type: string | undefined, tz: string): Val {
  if (raw === undefined || raw === null || raw === '') return null;
  const kind = type === undefined || type === 'formula' ? undefined : fieldKind(type);
  if (kind === null) return null;
  switch (kind) {
    case 'num': {
      const n = toNumber(raw, true);
      return n === null ? null : type === 'amount' ? roundTo(n, 2) : n;
    }
    case 'bool':
      return typeof raw === 'boolean' ? raw : null;
    case 'date':
      return toDate(raw);
    case 'dt':
      return toDateTime(raw, tz);
    case 'items':
      return toItems(raw);
    case 'text':
      return typeof raw === 'string' && raw.trim() ? { t: 'text', v: raw.trim() } : null;
  }
  if (typeof raw === 'number') return toNumber(raw, false);
  if (typeof raw === 'boolean') return raw;
  if (Array.isArray(raw)) return toItems(raw);
  if (typeof raw !== 'string') return null;
  return toDate(raw) ?? toDateTime(raw, tz) ?? (raw.trim() ? { t: 'text', v: raw.trim() } : null);
}

/** The calendar day of a date or a date-time. */
export const dayOf = (v: { t: 'date'; day: number } | { t: 'dt'; ms: number }): number =>
  v.t === 'date' ? v.day : Math.floor(v.ms / DAY);

/** A date as a moment (its midnight), so dates and date-times can be set side by side. */
export const clockOf = (v: { t: 'date'; day: number } | { t: 'dt'; ms: number }): number =>
  v.t === 'date' ? v.day * DAY : v.ms;

export const shiftDays = (v: { t: 'date'; day: number } | { t: 'dt'; ms: number }, days: number): Val =>
  v.t === 'date' ? { t: 'date', day: v.day + Math.round(days) } : { t: 'dt', ms: v.ms + days * DAY };

/** What is stored: a number, `YYYY-MM-DD`, an ISO instant — or null when the answer is not a number or a date. */
export function toResult(v: Val, tz: string, places: number | null): FormulaResult {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') {
    const n = places === null ? v : roundTo(v, places);
    return Number.isFinite(n) ? n || 0 : null;
  }
  if (v.t === 'date' || v.t === 'dt') {
    const ms = v.t === 'date' ? v.day * DAY : v.ms;
    // Years 0001–9999 only: what a date field can hold.
    if (!Number.isFinite(ms) || ms < -62_135_596_800_000 || ms > 253_402_300_799_999) return null;
    const iso = new Date(ms).toISOString();
    if (v.t === 'date') return iso.slice(0, 10);
    const minutes = Math.floor((ms % DAY) / 60_000 + (ms % DAY < 0 ? 1440 : 0));
    const rest = ms - Math.floor(ms / 60_000) * 60_000;
    return new Date(zonedToUtc(iso.slice(0, 10), minutes, tz).getTime() + rest).toISOString();
  }
  return null;
}
