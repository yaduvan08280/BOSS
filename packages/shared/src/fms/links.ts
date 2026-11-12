/**
 * Linked fields (phase 11). A form value stays what people read (the text). When it was picked from a row, a
 * record or an item, the link to that thing is kept beside it under one reserved key, so a renamed source still
 * links and everything that reads values as text keeps working:
 *
 *   { customer: 'Sharma Traders', _refs: { customer: 'customer:ck…' } }
 *
 * Field keys always start with a letter, so `_refs` can never clash with a field.
 */
export const REFS_KEY = '_refs';
export type Refs = Record<string, string>;
export type FormData = Record<string, unknown>;

export const REF_KINDS = ['customer', 'item', 'user', 'row', 'rec', 'rt'] as const;
export type RefKind = (typeof REF_KINDS)[number];

export const makeRef = (kind: RefKind, id: string) => `${kind}:${id}`;

export function parseRef(ref: unknown): { kind: RefKind; id: string } | null {
  if (typeof ref !== 'string') return null;
  const i = ref.indexOf(':');
  const kind = ref.slice(0, i) as RefKind;
  const id = ref.slice(i + 1);
  return i > 0 && id && REF_KINDS.includes(kind) ? { kind, id } : null;
}

/** The links kept on some form data ({} when there are none). */
export function refsOf(data: unknown): Refs {
  const r = (data as FormData | null | undefined)?.[REFS_KEY];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'string' && v)) as Refs;
}

/** Form data without the links: just the values by field key. */
export function plainValues(data: unknown): FormData {
  const { [REFS_KEY]: _, ...rest } = (data ?? {}) as FormData;
  return rest;
}

/** Set (or with null / undefined, remove) the link of one field. Returns new data. */
export function withRef(data: FormData, key: string, ref: string | null | undefined): FormData {
  const refs = { ...refsOf(data) };
  if (ref) refs[key] = ref;
  else delete refs[key];
  const out = { ...plainValues(data) };
  if (Object.keys(refs).length) out[REFS_KEY] = refs;
  return out;
}

/** Several pieces of form data as one (later wins), with their links merged rather than overwritten. */
export function mergeData(...parts: unknown[]): FormData {
  const out: FormData = {};
  const refs: Refs = {};
  for (const p of parts) {
    Object.assign(out, plainValues(p));
    Object.assign(refs, refsOf(p));
  }
  for (const k of Object.keys(refs)) if (!(k in out)) delete refs[k];
  if (Object.keys(refs).length) out[REFS_KEY] = refs;
  return out;
}

export type FieldSource =
  | { kind: 'customers' | 'items' | 'vendors' | 'people' }
  | { kind: 'master'; id: string }
  | { kind: 'fms'; flowId: string; field: string }
  | { kind: 'rec'; flowId: string }
  | { kind: 'rt'; id: string };

/** Read a field's `master` setting. Unknown text → null. */
export function parseSource(source: string | undefined): FieldSource | null {
  if (!source) return null;
  if (source === 'customers' || source === 'items' || source === 'vendors' || source === 'people')
    return { kind: source };
  const [head, a, b] = source.split(':');
  if (head === 'm' && a) return { kind: 'master', id: a };
  if (head === 'fms' && a && b) return { kind: 'fms', flowId: a, field: b };
  if (head === 'rec' && a) return { kind: 'rec', flowId: a };
  if (head === 'rt' && a) return { kind: 'rt', id: a };
  return null;
}

/** The value list a "remember what people type" field uses: its own, or a named shared one. */
export function listKeyOf(owner: { kind: string; id: string }, field: { key: string; list?: string }) {
  return field.list ? `list:${field.list}` : `${owner.kind}:${owner.id}:${field.key}`;
}
