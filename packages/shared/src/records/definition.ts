import { z } from 'zod';
import { fieldSchema, type FlowField } from '../fms/definition';
import { STATUS_TONES } from '../theme/status';

/**
 * Custom record types (plan §2.6): what a company's own thing — a site visit, a prescription, a trip — is made of.
 * The definition is one strict, self-describing object, so screens, the API and (later) an AI draft all write the
 * same shape: fields, child tables, statuses, the allowed moves between them and who may make each one.
 */
const key = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and _');

/** A table inside the record (items, visits, instalments): every row is checked with the same field rules. */
export const recordTableSchema = z
  .strictObject({
    key,
    label: z.string().trim().min(1).max(60),
    fields: z.array(fieldSchema).max(20).default([]),
  })
  .describe('Child lines: a table inside the record');
export type RecordTable = z.infer<typeof recordTableSchema>;

/** `kind` is one of the fixed status colours (never themed); `final` closes the record: no moves leave it. */
export const recordStatusSchema = z
  .strictObject({
    key,
    label: z.string().trim().min(1).max(40),
    kind: z.enum(STATUS_TONES),
    final: z.boolean().optional(),
  })
  .describe('A status a record can stand in');
export type RecordStatus = z.infer<typeof recordStatusSchema>;

/**
 * Who may make a move: `edit` (anyone who may edit records of this type), `approve` (anyone who may approve),
 * `creator` (the person who made the record) or `role:<roleId>` (people of one role). Admins always may.
 */
export const MOVE_WHO = ['edit', 'approve', 'creator'] as const;
const who = z.string().regex(/^(edit|approve|creator|role:[a-z0-9]{6,40})$/, 'Unknown "who"');

export const recordMoveSchema = z
  .strictObject({
    from: key,
    /** The key of the button ("confirm", "cancel"); unique among the moves that leave `from`. */
    action: key,
    label: z.string().trim().min(1).max(40),
    to: key,
    who: z.array(who).min(1, 'Say who may make this move').max(12),
    /** The person must write why (a rejection, a cancellation). */
    noteRequired: z.boolean().optional(),
  })
  .describe('An allowed change of status');
export type RecordMove = z.infer<typeof recordMoveSchema>;

/** Columns every record has, besides its fields. */
export const RECORD_BUILTIN_COLUMNS = ['code', 'title', 'status', 'createdAt', 'createdBy'] as const;
export type RecordBuiltinColumn = (typeof RECORD_BUILTIN_COLUMNS)[number];

export const recordDefinitionSchema = z
  .strictObject({
    fields: z.array(fieldSchema).max(60).default([]),
    tables: z.array(recordTableSchema).max(8).default([]),
    statuses: z.array(recordStatusSchema).min(1, 'Add at least one status').max(20),
    /** The status a new record starts in. */
    start: key,
    moves: z.array(recordMoveSchema).max(80).default([]),
    /** The field shown as the record's title (default: its first text-like value, else its number). */
    displayField: key.optional(),
    /** The list's columns when a person has not chosen their own: field keys and built-in columns. */
    columns: z.array(z.string().max(40)).max(12).optional(),
  })
  .describe('A record type: fields, child tables, statuses and the moves between them');
export type RecordDefinition = z.infer<typeof recordDefinitionSchema>;

/** Icons a record type can show in the left menu (a fixed lucide set, by name). */
export const RECORD_ICONS = [
  'file-text',
  'clipboard-list',
  'briefcase',
  'map-pin',
  'truck',
  'stethoscope',
  'pill',
  'hammer',
  'wrench',
  'calendar',
  'users',
  'package',
  'receipt',
  'building',
  'gem',
  'plane',
  'folder',
  'star',
  'phone',
  'shopping-bag',
  'bed',
  'utensils',
  'graduation-cap',
  'tractor',
] as const;
export type RecordIcon = (typeof RECORD_ICONS)[number];

/** Where the type shows in the left menu: a section (an existing one by key, or your own name), or hidden. */
export const recordMenuSchema = z.strictObject({
  section: z.string().trim().min(1).max(30).nullable(),
  icon: z.enum(RECORD_ICONS),
});
export type RecordMenu = z.infer<typeof recordMenuSchema>;

/** Who may do what with this type's records: role ids, or `*` for everyone. Admins (records.admin) always may. */
export const EVERYONE = '*';
export const RECORD_RIGHTS = ['view', 'create', 'edit', 'approve'] as const;
export type RecordRight = (typeof RECORD_RIGHTS)[number];
const grant = z.array(z.string().min(1).max(40)).max(60);
export const recordPermissionsSchema = z.strictObject({
  view: grant,
  create: grant,
  edit: grant,
  approve: grant,
});
export type RecordPermissions = z.infer<typeof recordPermissionsSchema>;

const prefix = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9]{0,7}$/, 'Use 1 to 8 capital letters or digits, starting with a letter (SV, RX, TRIP)');

export const recordTypeInputSchema = z.object({
  name: z.string().trim().min(2).max(60),
  pluralName: z.string().trim().min(2).max(60),
  prefix,
  description: z.string().trim().max(300).nullish(),
  definition: recordDefinitionSchema,
  menu: recordMenuSchema,
  /** Left out: everyone views, makes and edits; heads of department approve. */
  permissions: recordPermissionsSchema.optional(),
});
export type RecordTypeInput = z.infer<typeof recordTypeInputSchema>;

/** Changing some of a type: no defaults, so what is not sent stays as saved (decision 71). */
export const recordTypePatchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  pluralName: z.string().trim().min(2).max(60).optional(),
  prefix: prefix.optional(),
  description: z.string().trim().max(300).nullish(),
  definition: recordDefinitionSchema.optional(),
  menu: recordMenuSchema.optional(),
  permissions: recordPermissionsSchema.optional(),
});
export type RecordTypePatch = z.infer<typeof recordTypePatchSchema>;

/** A simple start for a new type: Open → Done, or Cancelled. */
export function defaultRecordDefinition(): RecordDefinition {
  return {
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true }],
    tables: [],
    statuses: [
      { key: 'open', label: 'Open', kind: 'info' },
      { key: 'done', label: 'Done', kind: 'ok', final: true },
      { key: 'cancelled', label: 'Cancelled', kind: 'neutral', final: true },
    ],
    start: 'open',
    moves: [
      { from: 'open', action: 'finish', label: 'Mark done', to: 'done', who: ['edit', 'creator'] },
      {
        from: 'open',
        action: 'cancel',
        label: 'Cancel',
        to: 'cancelled',
        who: ['edit', 'creator'],
        noteRequired: true,
      },
    ],
  };
}

const dupes = (keys: string[]) => [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];

/**
 * What is wrong with a definition, in words the person setting it up can act on. An empty list = ready to use.
 * (Shape problems — a missing label, a bad key — are caught by the schema before this.)
 */
export function checkRecordDefinition(def: RecordDefinition): string[] {
  const out: string[] = [];
  const label = (k: string) => def.statuses.find((s) => s.key === k)?.label ?? k;
  const fieldKeys = def.fields.map((f) => f.key);
  for (const k of dupes(fieldKeys))
    out.push(`Two fields have the same key "${k}": remove one and add it again`);
  const tableKeys = def.tables.map((t) => t.key);
  for (const k of dupes(tableKeys)) out.push(`Two tables have the same key "${k}": rename one`);
  for (const t of def.tables) {
    if (fieldKeys.includes(t.key)) out.push(`The table "${t.label}" has the same key as a field: rename it`);
    if (!t.fields.length) out.push(`The table "${t.label}" has no columns yet: add at least one`);
    for (const k of dupes(t.fields.map((f) => f.key)))
      out.push(`The table "${t.label}" has two columns with the key "${k}": remove one and add it again`);
  }
  for (const f of [...def.fields, ...def.tables.flatMap((t) => t.fields)])
    if ((f.type === 'dropdown' || f.type === 'multiselect') && !f.options?.length)
      out.push(`"${f.label}" is a list of choices with no choices: type them, separated by commas`);

  const statusKeys = def.statuses.map((s) => s.key);
  for (const k of dupes(statusKeys)) out.push(`Two statuses have the same key "${k}": remove one`);
  const hasStart = statusKeys.includes(def.start);
  if (!hasStart) out.push('Choose the status a new record starts in');
  const final = new Set(def.statuses.filter((s) => s.final).map((s) => s.key));
  const seen = new Set<string>();
  for (const m of def.moves) {
    const name = `The move "${m.label}"`;
    if (!statusKeys.includes(m.from)) out.push(`${name} starts from a status that does not exist`);
    if (!statusKeys.includes(m.to)) out.push(`${name} leads to a status that does not exist`);
    if (m.from === m.to) out.push(`${name} leads back to the same status "${label(m.from)}"`);
    if (final.has(m.from))
      out.push(
        `${name} leaves "${label(m.from)}", which is a final status: untick "final" or remove the move`,
      );
    if (seen.has(`${m.from}:${m.action}`))
      out.push(`"${label(m.from)}" has two moves with the same key "${m.action}": remove one`);
    seen.add(`${m.from}:${m.action}`);
  }
  // Every status must be reachable from the start, or records could never stand in it.
  const reach = new Set([def.start]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of def.moves)
      if (reach.has(m.from) && !reach.has(m.to)) {
        reach.add(m.to);
        grew = true;
      }
  }
  if (hasStart)
    for (const s of def.statuses)
      if (!reach.has(s.key))
        out.push(`No move leads to "${s.label}": add a move to it, or remove the status`);

  if (def.displayField && !fieldKeys.includes(def.displayField))
    out.push('The title field does not exist any more: choose another');
  for (const c of def.columns ?? [])
    if (!fieldKeys.includes(c) && !(RECORD_BUILTIN_COLUMNS as readonly string[]).includes(c))
      out.push(`The list column "${c}" does not exist any more: remove it`);
  return out;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** A record's title: the display field, else its first text-like value, else its number. */
export function recordTitleOf(def: RecordDefinition, values: Record<string, unknown>, code: string): string {
  const chosen = def.displayField ? text(values[def.displayField]) : '';
  if (chosen) return chosen.slice(0, 160);
  for (const f of def.fields)
    if (['text', 'master', 'dropdown'].includes(f.type) && text(values[f.key]))
      return text(values[f.key]).slice(0, 160);
  return code;
}

/** Field types a list can show as a column, filter and sort by. */
export const listable = (f: FlowField) => !['photo', 'file', 'signature', 'items'].includes(f.type);
