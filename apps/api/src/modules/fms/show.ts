import type { Db, Tx } from '@mono/db';
import {
  flowDefinitionSchema,
  flowFieldMap,
  mergeData,
  numberOf,
  parsePath,
  plainValues,
  refsOf,
  showStored,
  type FlowField,
} from '@mono/shared';
import { lookupRefs, type MasterOption } from '../masters/options';
import type { Actor } from '../work/actor';

/** One record's values by path: as text for people, or as a number for totals. */
export type PathReader = {
  text: (path: string) => string | null;
  number: (path: string) => number | null;
  raw: (path: string) => unknown;
};

const CHUNK = 500;

/**
 * Readers for many records at once (plan §2.5): `field` is the stored value; `field.column` is read through the
 * link the field keeps, so it shows the linked row as it is today. Links are looked up in bulk — one query per
 * source of choices, whatever the number of records — and only inside the company: a link to another company's
 * row, or to a row that is gone, reads as empty.
 */
export async function pathReaders(
  db: Db | Tx,
  companyId: string,
  tz: string,
  fields: Map<string, FlowField>,
  datas: unknown[],
  paths: string[],
): Promise<PathReader[]> {
  // The reader is the form's designer, not a signed-in person: company-scoped, no personal rights.
  const actor: Actor = { companyId, userId: '', permissions: [] };
  const linked = new Map<string, Set<string>>(); // source → links to look up
  const sourceOf = (key: string) => {
    const f = fields.get(key);
    return f?.type === 'master' ? (f.master ?? 'customers') : null;
  };
  const wanted = new Set(
    paths.flatMap((p) => {
      const parsed = parsePath(p);
      return parsed?.column && sourceOf(parsed.field) ? [parsed.field] : [];
    }),
  );
  for (const data of datas) {
    const refs = refsOf(data);
    for (const key of wanted) {
      const ref = refs[key];
      if (!ref) continue;
      const source = sourceOf(key)!;
      linked.set(source, (linked.get(source) ?? new Set()).add(ref));
    }
  }
  const rows = new Map<string, MasterOption>(); // `${source}|${ref}` → row
  for (const [source, refs] of linked) {
    const all = [...refs];
    for (let i = 0; i < all.length; i += CHUNK) {
      const found = await lookupRefs(db, actor, source, all.slice(i, i + CHUNK));
      for (const [ref, row] of found) rows.set(`${source}|${ref}`, row);
    }
  }
  return datas.map((data) => {
    const values = plainValues(data);
    const refs = refsOf(data);
    const raw = (path: string): unknown => {
      const p = parsePath(path);
      if (!p) return undefined;
      if (!p.column) return values[p.field];
      const source = sourceOf(p.field);
      const ref = refs[p.field];
      if (!source || !ref) return undefined;
      const row = rows.get(`${source}|${ref}`);
      if (!row) return undefined;
      // `name` always works: the row's own name, whatever its source calls it.
      return row.columns?.[p.column] ?? (p.column === 'name' ? row.value : undefined);
    };
    return {
      raw,
      text: (path) => {
        const p = parsePath(path);
        if (!p) return null;
        return showStored(p.column ? undefined : fields.get(p.field), raw(path), tz);
      },
      number: (path) => {
        const v = raw(path);
        if (Array.isArray(v)) {
          // Item lines count as their total.
          const sum = (v as { amount?: unknown }[]).reduce((a, l) => a + (numberOf(l?.amount) ?? 0), 0);
          return v.length ? Math.round(sum * 100) / 100 : null;
        }
        return numberOf(v);
      },
    };
  });
}

/** A process record's fields (of the version it runs on) and its values so far: start form + finished steps. */
export async function recordValues(db: Db | Tx, companyId: string, recordId: string) {
  const record = await db.fmsRecord.findFirst({
    where: { id: recordId, companyId },
    select: {
      data: true,
      version: { select: { definition: true } },
      steps: { where: { status: 'DONE' }, orderBy: { doneAt: 'asc' }, select: { data: true } },
    },
  });
  if (!record) return null;
  return {
    fields: flowFieldMap(flowDefinitionSchema.parse(record.version.definition ?? {})),
    data: mergeData(record.data, ...record.steps.map((s) => s.data)),
  };
}

/**
 * Everything a message about a process record can say (plan §2.5): `data.<field>` for each value and
 * `data.<field>.<column>` for each column of a row it links to — read now, through the links.
 */
export async function recordVars(db: Db | Tx, companyId: string, recordId: string, tz: string) {
  const rec = await recordValues(db, companyId, recordId);
  const out: Record<string, string> = {};
  if (!rec) return out;
  const actor: Actor = { companyId, userId: '', permissions: [] };
  const refs = refsOf(rec.data);
  for (const [key, v] of Object.entries(plainValues(rec.data))) {
    const text = showStored(rec.fields.get(key), v, tz);
    if (text !== null) out[`data.${key}`] = text;
  }
  for (const [key, ref] of Object.entries(refs)) {
    const f = rec.fields.get(key);
    if (f?.type !== 'master') continue;
    const row = (await lookupRefs(db, actor, f.master ?? 'customers', [ref])).get(ref);
    if (!row) continue;
    out[`data.${key}.name`] = row.value;
    for (const [col, v] of Object.entries(row.columns ?? {})) {
      const text = showStored(undefined, v, tz);
      if (text !== null) out[`data.${key}.${col}`] = text;
    }
  }
  return out;
}
