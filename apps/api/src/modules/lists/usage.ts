import type { Db } from '@mono/db';
import { listKeyOf } from '@mono/shared';

/** A form field that feeds and offers a list. */
export type ListUse = {
  kind: 'flow' | 'master';
  id: string;
  /** The process or master. */
  name: string;
  /** The field's label. */
  field: string;
  /** `writeAllowed: false` — only admins add new values there. */
  closed: boolean;
};

type LooseField = { key?: unknown; label?: unknown; type?: unknown; learn?: unknown; list?: unknown };
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];

/** Every field of a flow definition (a draft may be half-built, so nothing is assumed). */
const fieldsOf = (definition: unknown) => {
  const d = (definition ?? {}) as { startFields?: unknown; steps?: unknown };
  return [...arr(d.startFields), ...arr(d.steps).flatMap((s) => arr(s.fields))];
};

/**
 * Which lists the company's forms use, by list key: processes (the draft and the published version) and
 * masters. Record types join in once they exist (package E).
 */
export async function listsInForms(db: Db, companyId: string): Promise<Map<string, ListUse[]>> {
  const [flows, masters] = await Promise.all([
    db.flow.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, draft: true, currentVersionId: true },
    }),
    db.masterDef.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, fields: true },
    }),
  ]);
  const versionIds = flows.flatMap((f) => (f.currentVersionId ? [f.currentVersionId] : []));
  const versions = versionIds.length
    ? await db.flowVersion.findMany({
        where: { id: { in: versionIds }, companyId },
        select: { flowId: true, definition: true },
      })
    : [];
  const published = new Map(versions.map((v) => [v.flowId, v.definition]));

  const out = new Map<string, ListUse[]>();
  const seen = new Set<string>();
  const add = (kind: ListUse['kind'], id: string, name: string, fields: LooseField[]) => {
    for (const f of fields) {
      if (f.learn !== true || f.type !== 'text' || typeof f.key !== 'string') continue;
      const key = listKeyOf(
        { kind, id },
        { key: f.key, list: typeof f.list === 'string' ? f.list : undefined },
      );
      // The draft and the published version usually hold the same field: count it once.
      if (seen.has(`${key}|${id}|${f.key}`)) continue;
      seen.add(`${key}|${id}|${f.key}`);
      const use: ListUse = {
        kind,
        id,
        name,
        field: typeof f.label === 'string' ? f.label : f.key,
        closed: (f as { writeAllowed?: unknown }).writeAllowed === false,
      };
      out.set(key, [...(out.get(key) ?? []), use]);
    }
  };
  for (const f of flows) add('flow', f.id, f.name, [...fieldsOf(published.get(f.id)), ...fieldsOf(f.draft)]);
  for (const m of masters) add('master', m.id, m.name, arr(m.fields));
  return out;
}
