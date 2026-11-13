import { z } from 'zod';

/**
 * Phase 20 — an industry pack: a file of set-up, not code. Roles, masters (with rows), value lists, tax-code
 * shells (rates are the accountant's), items, record types, processes, checklists and saved reports, the words a
 * trade uses on screen, and module switches. It is installed into a company, upgraded by a newer version,
 * exported from one company and installed in another, and removed without touching what was made with it.
 *
 * Things point at each other by token, never by id: `@pack/master/customers`, `@pack/rt/prescription`,
 * `@pack/flow/dispatch`, `@pack/role/pharmacist`, `@pack/me` (whoever installs it). The installer swaps tokens
 * for the company's own ids; the exporter swaps them back.
 */
const key = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Small letters, digits and _');
const json = z.record(z.string(), z.unknown());

export const PACK_KINDS = [
  'role',
  'master',
  'item',
  'rt',
  'flow',
  'checklist',
  'report',
  'tax',
  'list',
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const packSchema = z.object({
  key,
  name: z.string().trim().min(2).max(60),
  version: z.number().int().min(1).max(100_000),
  industry: z.string().trim().min(2).max(40),
  description: z.string().trim().max(500).default(''),
  /** Modules the pack needs switched on. */
  switches: z.object({ hospitality: z.boolean().optional() }).default({}),
  /** The trade's own words: an i18n key → what to show instead ("res.guest" → "Patient"). */
  words: z
    .record(z.string().max(80), z.object({ en: z.string().max(120), hi: z.string().max(120).optional() }))
    .default({}),
  roles: z
    .array(
      z.object({
        key,
        name: z.string().trim().min(1).max(60),
        permissions: z.array(z.string().max(60)).max(200),
      }),
    )
    .max(200)
    .default([]),
  /** Tax codes the pack's items and bills use. A new one is made at 0 % for the accountant to set. */
  taxCodes: z
    .array(z.object({ code: z.string().regex(/^[A-Z0-9_-]{1,20}$/), name: z.string().min(1).max(60) }))
    .max(200)
    .default([]),
  lists: z
    .array(z.object({ key: z.string().min(1).max(60), values: z.array(z.string().min(1).max(120)).max(200) }))
    .max(400)
    .default([]),
  masters: z
    .array(
      z.object({
        key,
        name: z.string().trim().min(2).max(80),
        description: z.string().max(300).nullish(),
        fields: z.array(json).min(1).max(60),
        keyField: z.string().max(40).nullish(),
        displayField: z.string().max(40).nullish(),
        rows: z.array(json).max(500).default([]),
      }),
    )
    .max(400)
    .default([]),
  items: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(120),
        unit: z.string().trim().min(1).max(12).default('nos'),
        category: z.string().trim().max(60).nullish(),
        /** Everything the item master's "more" tab holds: tracking, units, barcode, HSN, tax code, price, rate key … */
        extras: json.default({}),
      }),
    )
    .max(500)
    .default([]),
  recordTypes: z
    .array(
      z.object({
        key,
        name: z.string().trim().min(2).max(60),
        pluralName: z.string().trim().min(2).max(60),
        prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/),
        description: z.string().max(300).nullish(),
        definition: json,
        icon: z.string().max(30).default('file-text'),
        permissions: json.optional(),
      }),
    )
    .max(400)
    .default([]),
  flows: z
    .array(
      z.object({
        key,
        name: z.string().trim().min(2).max(100),
        runName: z.string().trim().min(2).max(40).default('Record'),
        description: z.string().max(4000).nullish(),
        definition: json,
        publish: z.boolean().default(true),
      }),
    )
    .max(400)
    .default([]),
  checklists: z
    .array(z.object({ key, name: z.string().min(2).max(120), input: json }))
    .max(400)
    .default([]),
  reports: z
    .array(z.object({ key, name: z.string().min(1).max(80), definition: json }))
    .max(400)
    .default([]),
});
export type Pack = z.infer<typeof packSchema>;
export type PackInput = z.input<typeof packSchema>;

/** One thing a pack made (or took over because it was already there) in a company. */
export type PackMade = { kind: PackKind; key: string; id: string; adopted?: boolean };

export const token = (kind: 'master' | 'rt' | 'flow' | 'role', k: string) => `@pack/${kind}/${k}`;
export const ME = '@pack/me';
const TOKEN = /@pack\/(master|rt|flow|role)\/([a-z][a-z0-9_]*)|@pack\/me/g;

/** Swap every token in a piece of set-up for the company's own id. A token nothing answers is a mistake in the pack. */
export function fillTokens<T>(
  value: T,
  ids: (kind: string, key: string) => string | undefined,
  me: string,
): T {
  const missing: string[] = [];
  const text = JSON.stringify(value).replace(TOKEN, (all, kind?: string, k?: string) => {
    if (all === ME) return me;
    const id = ids(kind!, k!);
    if (!id) missing.push(all);
    return id ?? all;
  });
  if (missing.length)
    throw new Error(`The pack points at something it does not hold: ${[...new Set(missing)].join(', ')}`);
  return JSON.parse(text) as T;
}
/** The other way, for an export: every id the pack knows becomes its token; other people become "whoever installs it". */
export function toTokens<T>(value: T, tokens: Map<string, string>, people: ReadonlySet<string>): T {
  let text = JSON.stringify(value);
  for (const [id, tok] of tokens) text = text.split(id).join(tok);
  for (const id of people) text = text.split(id).join(ME);
  return JSON.parse(text) as T;
}
/** A key from a name: "Schedule H register" → schedule_h_register. */
export const packKey = (name: string) =>
  (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, 'k$1') || 'thing'
  ).slice(0, 40);

/** The words of every installed pack as one map (a later pack wins). */
export function mergeWords(installs: { words: unknown }[]): Record<string, { en: string; hi?: string }> {
  return Object.assign({}, ...installs.map((i) => (i.words ?? {}) as object));
}
