import type { Db } from '@mono/db';
import { parseRef, type PermissionKey, type RefKind } from '@mono/shared';
import { can, type Actor } from '../work/actor';
import { companyTz, recordLabel } from './sources/rec';
import { mayReadRecordType } from './sources/record-type';

/** What a link points at today: its current name, and where to open it (null when the person has no screen for it). */
export type ResolvedLink = { label: string; to: string | null };
type Resolver = (db: Db, actor: Actor, ids: string[]) => Promise<Map<string, ResolvedLink>>;

const where = (actor: Actor, ids: string[]) => ({
  id: { in: ids },
  companyId: actor.companyId,
  deletedAt: null,
});
const q = (text: string) => encodeURIComponent(text);
const to = (actor: Actor, need: PermissionKey, path: string) => (can(actor, need) ? path : null);

/** By kind of link (`customer:<id>`, `row:<id>`, `rec:<id>`, `rt:<id>` …). */
export const LINK_RESOLVERS: Partial<Record<RefKind, Resolver>> = {
  customer: async (db, actor, ids) =>
    new Map(
      (await db.customer.findMany({ where: where(actor, ids), select: { id: true, name: true } })).map(
        (c) => [c.id, { label: c.name, to: to(actor, 'crm.view', `/crm/customers?q=${q(c.name)}`) }],
      ),
    ),
  item: async (db, actor, ids) =>
    new Map(
      (
        await db.item.findMany({ where: where(actor, ids), select: { id: true, name: true, code: true } })
      ).map((i) => [i.id, { label: i.name, to: to(actor, 'ims.view', `/ims/stock?q=${q(i.code)}`) }]),
    ),
  user: async (db, actor, ids) =>
    new Map(
      (await db.user.findMany({ where: where(actor, ids), select: { id: true, name: true } })).map((u) => [
        u.id,
        { label: u.name, to: null },
      ]),
    ),
  row: async (db, actor, ids) =>
    new Map(
      (
        await db.masterRow.findMany({
          where: where(actor, ids),
          select: { id: true, label: true, masterId: true },
        })
      ).map((r) => [r.id, { label: r.label, to: `/masters/${r.masterId}?q=${q(r.label)}` }]),
    ),
  rec: async (db, actor, ids) => {
    // Other processes' records are only named to people who may see processes.
    if (!can(actor, 'fms.view')) return new Map();
    const rows = await db.fmsRecord.findMany({
      where: where(actor, ids),
      select: { id: true, number: true, title: true, startedAt: true },
    });
    const tz = rows.length ? await companyTz(db, actor.companyId) : '';
    return new Map(rows.map((r) => [r.id, { label: recordLabel(r, tz), to: `/fms/live?record=${r.id}` }]));
  },
  rt: async (db, actor, ids) => {
    // A custom record is only named to people who may see records of its type.
    const rows = await db.recordEntry.findMany({
      where: where(actor, ids),
      select: { id: true, code: true, title: true, typeId: true },
    });
    const seen = new Map<string, boolean>();
    for (const typeId of new Set(rows.map((r) => r.typeId)))
      seen.set(
        typeId,
        await mayReadRecordType(db, actor, typeId).then(
          () => true,
          () => false,
        ),
      );
    return new Map(
      rows
        .filter((r) => seen.get(r.typeId))
        .map((r) => [
          r.id,
          {
            label: r.title && r.title !== r.code ? `${r.code} · ${r.title}` : r.code,
            to: `/records/${r.typeId}?record=${r.id}`,
          },
        ]),
    );
  },
};

/**
 * Many links at once (a record's drawer asks for all of its links together): each link's current name and where
 * it opens. Company-scoped; a link to something deleted, unknown or in another company is simply not in the
 * answer, and the screen keeps showing the text that was saved.
 */
export async function resolveLinks(
  db: Db,
  actor: Actor,
  refs: string[],
): Promise<Record<string, ResolvedLink>> {
  const byKind = new Map<RefKind, string[]>();
  for (const ref of new Set(refs)) {
    const p = parseRef(ref);
    if (p) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p.id]);
  }
  const out: Record<string, ResolvedLink> = {};
  for (const [kind, ids] of byKind) {
    const found = await LINK_RESOLVERS[kind]?.(db, actor, ids);
    for (const [id, link] of found ?? []) out[`${kind}:${id}`] = link;
  }
  return out;
}
