import { formatDateTime, formatLocalDate } from '../format/date';
import type { FlowDefinition, FlowField } from './definition';

/**
 * Showing values anywhere (plan §2.5). A **path** names a value of a record:
 * - `field` — what the record holds in that field (typed, picked, remembered or worked out by a formula);
 * - `field.column` — a column of the row that field links to (`customer.city`, `item.rate`, `booking.guest`),
 *   read through the link when the value is shown, so it follows the row as it is today.
 * Live FMS columns, document texts, KPI cards and message templates all use the same paths.
 */
const KEY = '[a-z][a-z0-9_]{0,39}';
const PATH = new RegExp(`^(${KEY})(?:\\.(${KEY}))?$`);
const HOLE = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export type ValuePath = { field: string; column?: string };

export function parsePath(path: string): ValuePath | null {
  const m = PATH.exec(path.trim());
  return m ? { field: m[1]!, ...(m[2] ? { column: m[2] } : {}) } : null;
}

/** The `{{path}}` holes of a text, in order of first appearance. */
export function pathsIn(text: string | null | undefined): string[] {
  return [...new Set([...(text ?? '').matchAll(HOLE)].map((m) => m[1]!))];
}

/** Fill `{{path}}` holes. A path with no value prints nothing — a paper never shows raw braces. */
export function fillPaths(text: string, read: (path: string) => string | null | undefined): string {
  return text.replace(HOLE, (_, path: string) => read(path) ?? '');
}

/** Every field of a flow by key: the start form first, then the steps in order (the first of a key wins). */
export function flowFieldMap(def: Pick<FlowDefinition, 'startFields' | 'steps'>): Map<string, FlowField> {
  const out = new Map<string, FlowField>();
  for (const f of [...def.startFields, ...def.steps.flatMap((s) => s.fields)])
    if (!out.has(f.key)) out.set(f.key, f);
  return out;
}

const NOT_SHOWN = ['photo', 'file', 'signature', 'items'];
/** Fields whose own value can stand in a column, a text or a message. */
export const showable = (f: FlowField) => !NOT_SHOWN.includes(f.type);
/** Fields a number can be read from (KPI totals and averages). */
export const numeric = (f: FlowField) => ['number', 'amount', 'formula'].includes(f.type);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const grouped = (n: number, decimals?: number) =>
  n.toLocaleString(
    'en-IN',
    decimals === undefined
      ? { maximumFractionDigits: 9 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  );

/**
 * A stored value as people read it: DD/MM/YYYY dates, ₹ amounts with Indian grouping, Yes / No — never a raw
 * ISO string. `field` may be unknown (a column of a linked row): the value is then read by its look.
 */
export function showStored(
  field: FlowField | undefined,
  v: unknown,
  tz: string,
  yesNo: [string, string] = ['Yes', 'No'],
): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return field?.type === 'multiselect' ? (v as string[]).join(', ') : null;
  if (typeof v === 'object') return null;
  if (typeof v === 'boolean') return v ? yesNo[0] : yesNo[1];
  if (typeof v === 'string') {
    if (field?.type === 'date' || DAY.test(v)) return formatLocalDate(v);
    if (field?.type === 'datetime' || INSTANT.test(v)) return formatDateTime(v, tz);
  }
  if (typeof v === 'number') {
    if (field?.type === 'amount') return `₹${grouped(v)}`;
    if (field?.type === 'formula' || !field) return grouped(v);
  }
  return String(v);
}

/** A number out of a stored value or a linked column ("1,200.50" typed in a master counts too). */
export function numberOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = Number(v.replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
