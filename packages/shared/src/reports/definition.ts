import { z } from 'zod';
import type { FlowField } from '../fms/definition';

/**
 * Reports (plan §2.7): pick a process or a record type → columns → filters → group by → totals → a table or a
 * chart. A report can use the columns every record has (number, title, status, date, by) and the fields marked
 * "reportable" — those keep a typed, indexed copy, so reports stay fast on large data.
 */
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Unknown field');

export const REPORT_SOURCES = ['flow', 'recordType'] as const;
export type ReportSourceKind = (typeof REPORT_SOURCES)[number];

export const REPORT_OPS = [
  'eq',
  'contains',
  'gte',
  'lte',
  'between',
  'last_days',
  'this_week',
  'this_month',
  'this_fy',
  'filled',
  'empty',
] as const;
export type ReportOp = (typeof REPORT_OPS)[number];

export const REPORT_BUCKETS = ['day', 'week', 'month', 'quarter', 'fy'] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];
export const REPORT_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type ReportFn = (typeof REPORT_FNS)[number];
export const REPORT_LOOKS = ['table', 'bar', 'line', 'pie'] as const;

export const reportFilterSchema = z.strictObject({
  field: key,
  op: z.enum(REPORT_OPS),
  /** Text, a number, a day (YYYY-MM-DD) or a number of days — by the operator and the field's kind. */
  value: z.string().trim().max(200).optional(),
  /** `between`: the upper end. */
  value2: z.string().trim().max(200).optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const reportMeasureSchema = z.strictObject({
  fn: z.enum(REPORT_FNS),
  /** A number field (not needed for `count`). */
  field: key.optional(),
});
export type ReportMeasure = z.infer<typeof reportMeasureSchema>;

export const reportDefinitionSchema = z
  .strictObject({
    source: z.strictObject({ kind: z.enum(REPORT_SOURCES), id: z.string().min(1).max(40) }),
    /** The columns of the plain list (when nothing is grouped). */
    columns: z.array(key).max(12),
    filters: z.array(reportFilterSchema).max(10),
    /** One row per value of this field; a date is grouped by day, week, month, quarter or financial year. */
    groupBy: z.strictObject({ field: key, bucket: z.enum(REPORT_BUCKETS).optional() }).optional(),
    measures: z.array(reportMeasureSchema).max(6),
    /** `group`, a column's key, or a measure by its place (`m0`, `m1` …). */
    sort: z.strictObject({ by: z.string().max(40), dir: z.enum(['asc', 'desc']) }).optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    look: z.enum(REPORT_LOOKS),
  })
  .describe('A report: source, columns, filters, group and totals');
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const blankReport = (source: ReportDefinition['source']): ReportDefinition => ({
  source,
  columns: [],
  filters: [],
  measures: [{ fn: 'count' }],
  look: 'table',
});

/** When a saved report is sent by itself, and to whom (they get a message with a link to it). */
export const reportScheduleSchema = z.strictObject({
  every: z.enum(['day', 'week', 'month']),
  /** Minutes from midnight, company time. */
  at: z.number().int().min(0).max(1439),
  /** `week`: 1 = Monday … 7 = Sunday. `month`: the day of the month (1–28). */
  on: z.number().int().min(1).max(28).optional(),
  userIds: z.array(z.string().max(40)).min(1).max(30),
});
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

export const reportInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  definition: reportDefinitionSchema,
  /** Roles that may open it (view only), besides its maker. */
  sharedRoles: z.array(z.string().max(40)).max(30).optional(),
  schedule: reportScheduleSchema.nullish(),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export type ReportKind = 'text' | 'number' | 'date';
/** A column a report can use. `ready: false` = its copies are still being made for older records. */
export type ReportField = { key: string; label: string; kind: ReportKind; builtin: boolean; ready: boolean };

/** How a reportable field is read: as a number, a day or text. */
export function reportKindOf(f: Pick<FlowField, 'type'>): ReportKind {
  if (['number', 'amount', 'formula', 'items'].includes(f.type)) return 'number';
  if (f.type === 'date' || f.type === 'datetime') return 'date';
  return 'text';
}

/** The columns every record of a source has. */
export const REPORT_BUILTINS: Record<ReportSourceKind, { key: string; label: string; kind: ReportKind }[]> = {
  flow: [
    { key: 'number', label: 'Number', kind: 'number' },
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'text' },
    { key: 'started', label: 'Started on', kind: 'date' },
    { key: 'by', label: 'Started by', kind: 'text' },
  ],
  recordType: [
    { key: 'code', label: 'Number', kind: 'text' },
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'text' },
    { key: 'created', label: 'Made on', kind: 'date' },
    { key: 'by', label: 'Made by', kind: 'text' },
  ],
};

/** The operators a kind of column offers. */
export function reportOpsFor(kind: ReportKind): ReportOp[] {
  if (kind === 'text') return ['eq', 'contains', 'filled', 'empty'];
  if (kind === 'number') return ['eq', 'gte', 'lte', 'between', 'filled', 'empty'];
  return [
    'eq',
    'gte',
    'lte',
    'between',
    'last_days',
    'this_week',
    'this_month',
    'this_fy',
    'filled',
    'empty',
  ];
}

const NO_VALUE: ReportOp[] = ['this_week', 'this_month', 'this_fy', 'filled', 'empty'];

/**
 * What is wrong with a report against the columns its source offers, in words the person building it can act
 * on. An empty list = it can run. (Shapes are checked by the schema before this.)
 */
export function checkReport(def: ReportDefinition, fields: ReportField[]): string[] {
  const out: string[] = [];
  const by = new Map(fields.map((f) => [f.key, f]));
  const name = (k: string) => by.get(k)?.label ?? k;
  for (const c of def.columns)
    if (!by.has(c)) out.push(`The column "${c}" is not a reportable field of this source`);
  for (const f of def.filters) {
    const col = by.get(f.field);
    if (!col) {
      out.push(`The filter on "${f.field}" names a field that is not reportable`);
      continue;
    }
    if (!reportOpsFor(col.kind).includes(f.op)) out.push(`"${name(f.field)}" can't be filtered that way`);
    else if (!NO_VALUE.includes(f.op) && !f.value)
      out.push(`Give a value for the filter on "${name(f.field)}"`);
    else if (f.op === 'between' && !f.value2) out.push(`Give both ends for the filter on "${name(f.field)}"`);
    else if (f.op === 'last_days' && !/^\d{1,4}$/.test(f.value ?? ''))
      out.push(`Say how many days for the filter on "${name(f.field)}"`);
    else if (col.kind === 'number' && ['eq', 'gte', 'lte', 'between'].includes(f.op)) {
      if ([f.value, f.op === 'between' ? f.value2 : '0'].some((v) => !Number.isFinite(Number(v))))
        out.push(`The filter on "${name(f.field)}" needs a number`);
    } else if (col.kind === 'date' && ['eq', 'gte', 'lte', 'between'].includes(f.op)) {
      if (
        [f.value, f.op === 'between' ? f.value2 : '2000-01-01'].some(
          (v) => !/^\d{4}-\d{2}-\d{2}$/.test(v ?? ''),
        )
      )
        out.push(`The filter on "${name(f.field)}" needs a date`);
    }
  }
  if (def.groupBy) {
    const g = by.get(def.groupBy.field);
    if (!g) out.push('The field to group by is not reportable');
    else if (def.groupBy.bucket && g.kind !== 'date')
      out.push(`"${g.label}" is not a date: it can't be grouped by ${def.groupBy.bucket}`);
    if (!def.measures.length) out.push('A grouped report needs at least one total (a count, a sum …)');
  } else if (!def.columns.length && !def.measures.length) out.push('Choose at least one column');
  for (const m of def.measures) {
    if (m.fn === 'count') continue;
    const col = m.field ? by.get(m.field) : undefined;
    if (!col) out.push(`Choose the field to ${m.fn === 'avg' ? 'average' : m.fn}`);
    else if (col.kind !== 'number') out.push(`"${col.label}" is not a number: it can't be totalled`);
  }
  if (def.look !== 'table' && !def.groupBy)
    out.push('A chart needs a group (one bar, point or slice per value)');
  return out;
}
