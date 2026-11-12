import { z } from 'zod';
import type { FlowField } from '../fms/definition';
import type { RecordDefinition } from './definition';

/** One "filter by a field's value" of a record list. */
export const RECORD_FILTER_OPS = ['eq', 'contains', 'gte', 'lte', 'filled', 'empty'] as const;
export type RecordFilterOp = (typeof RECORD_FILTER_OPS)[number];
export const recordFilterSchema = z.object({
  field: z.string().max(40),
  op: z.enum(RECORD_FILTER_OPS),
  value: z.string().max(200).optional(),
});
export type RecordFilter = z.infer<typeof recordFilterSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** What a list shows: search, statuses, a date range (made on), field filters, sort and columns. No defaults. */
export const recordViewConfigSchema = z.object({
  q: z.string().max(80).optional(),
  status: z.array(z.string().max(40)).max(20).optional(),
  from: day.optional(),
  to: day.optional(),
  filters: z.array(recordFilterSchema).max(10).optional(),
  /** A field key, or code / title / status / createdAt. */
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  columns: z.array(z.string().max(40)).max(12).optional(),
});
export type RecordViewConfig = z.infer<typeof recordViewConfigSchema>;

export const recordViewInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  /** Shared with everyone who can see the type (needs edit rights on it). */
  shared: z.boolean().default(false),
  config: recordViewConfigSchema,
});
export type RecordViewInput = z.infer<typeof recordViewInputSchema>;

/** Which filter choices make sense for a field. */
export function filterOpsFor(f: FlowField): RecordFilterOp[] {
  if (['number', 'amount', 'date', 'datetime', 'formula'].includes(f.type))
    return ['eq', 'gte', 'lte', 'filled', 'empty'];
  if (['dropdown', 'yesno'].includes(f.type)) return ['eq', 'filled', 'empty'];
  return ['contains', 'eq', 'filled', 'empty'];
}

/** The columns a list shows when nobody chose: the type's own choice, else its number, title, status and first fields. */
export function defaultColumns(def: RecordDefinition): string[] {
  if (def.columns?.length) return def.columns;
  const fields = def.fields
    .filter((f) => !['photo', 'file', 'signature', 'items', 'longtext'].includes(f.type))
    .filter((f) => f.key !== def.displayField)
    .slice(0, 4)
    .map((f) => f.key);
  return ['code', 'title', 'status', ...fields, 'createdAt'];
}

/** Types whose saved values still read correctly as the other type. */
const SAFE: Record<string, string[]> = {
  text: ['longtext'],
  longtext: ['text'],
  number: ['amount'],
  amount: ['number'],
  dropdown: ['text', 'longtext'],
  mobile: ['text'],
  email: ['text'],
  location: ['text'],
  master: ['text'],
  photo: ['file'],
  file: ['photo'],
};

export type DefinitionChange =
  | { kind: 'fieldRemoved'; key: string; label: string; table?: string }
  | { kind: 'fieldType'; key: string; label: string; table?: string; from: string; to: string }
  | { kind: 'tableRemoved'; key: string; label: string }
  | { kind: 'statusRemoved'; key: string; label: string };

/**
 * The changes between two definitions that could hurt records already saved: a field or table taken away, a field
 * turned into a type its values don't fit, a status taken away. The API refuses each one only if records hold it.
 */
export function riskyChanges(before: RecordDefinition, after: RecordDefinition): DefinitionChange[] {
  const out: DefinitionChange[] = [];
  const compare = (was: FlowField[], now: FlowField[], table?: string) => {
    for (const f of was) {
      const g = now.find((x) => x.key === f.key);
      if (!g) out.push({ kind: 'fieldRemoved', key: f.key, label: f.label, table });
      else if (g.type !== f.type && !SAFE[f.type]?.includes(g.type))
        out.push({ kind: 'fieldType', key: f.key, label: f.label, table, from: f.type, to: g.type });
    }
  };
  compare(before.fields, after.fields);
  for (const t of before.tables) {
    const u = after.tables.find((x) => x.key === t.key);
    if (!u) out.push({ kind: 'tableRemoved', key: t.key, label: t.label });
    else compare(t.fields, u.fields, t.key);
  }
  for (const s of before.statuses)
    if (!after.statuses.some((x) => x.key === s.key))
      out.push({ kind: 'statusRemoved', key: s.key, label: s.label });
  return out;
}
