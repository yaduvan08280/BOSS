import { createId } from '@paralleldrive/cuid2';
import type { Db, Tx } from '@mono/db';
import { can, type Actor } from '../work/actor';

/**
 * Value lists (plan §2.1): what a "remember what people type" field offers. A list is named by its key — a
 * field's own (`flow:<flowId>:<field>`, `master:<id>:<field>`, `recordType:<id>:<field>`) or a named one shared
 * by several forms (`list:<name>`); see `listKeyOf` in shared.
 */
export const LIST_KEY =
  /^(?:list:[a-z][a-z0-9_]{0,39}|(?:flow|master|recordType):[A-Za-z0-9_-]{1,40}:[a-z][a-z0-9_]{0,39})$/;

/** A text field keeps at most this much (shared `checkFields`). */
export const VALUE_MAX = 300;

/** What makes two values the same: capitals and extra spaces don't count. */
export const normOf = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();

/** Who may add to a list that is closed to new values ("only admins add"): list admins and process admins. */
export const mayAddValues = (a: Pick<Actor, 'permissions'>) =>
  can(a as Actor, 'core.edit') || can(a as Actor, 'fms.admin');

const live = (companyId: string, key: string) => ({ companyId, key, deletedAt: null });

/** The values a list offers: not hidden, most used first, every typed word must match. */
export async function offeredValues(db: Db | Tx, companyId: string, key: string, q = '', limit = 50) {
  const words = normOf(q).split(' ').filter(Boolean);
  return db.valueList.findMany({
    where: {
      ...live(companyId, key),
      hidden: false,
      ...(words.length ? { AND: words.map((w) => ({ norm: { contains: w } })) } : {}),
    },
    orderBy: [{ uses: 'desc' }, { lastUsedAt: { sort: 'desc', nulls: 'last' } }, { value: 'asc' }],
    take: Math.min(200, Math.max(1, limit)),
    select: { id: true, value: true, uses: true },
  });
}

/** How many values the list offers (a closed list is closed only once it has some). */
export const offeredCount = (db: Db | Tx, companyId: string, key: string) =>
  db.valueList.count({ where: { ...live(companyId, key), hidden: false } });

/** The live row of a value, whatever its capitals (null when the list does not have it). */
export const findValue = (db: Db | Tx, companyId: string, key: string, value: string) =>
  db.valueList.findFirst({
    where: { ...live(companyId, key), norm: normOf(value) },
    select: { id: true, value: true, hidden: true },
  });

/**
 * A form was saved with this value: add it to the list, or count one more use. One statement, so two people
 * typing the same new value at once end up with one row. `inserted` tells a new value from a counted one.
 */
export async function rememberValue(
  tx: Tx,
  companyId: string,
  key: string,
  value: string,
  actorId: string | null,
): Promise<{ id: string; inserted: boolean }> {
  const rows = await tx.$queryRaw<{ id: string; inserted: boolean }[]>`
    INSERT INTO value_lists (id, company_id, key, value, norm, uses, last_used_at, created_by_id, updated_at)
    VALUES (${createId()}, ${companyId}, ${key}, ${value}, ${normOf(value)}, 1, now(), ${actorId}, now())
    ON CONFLICT (company_id, key, norm)
    DO UPDATE SET uses = value_lists.uses + 1, last_used_at = now(), updated_at = now()
    RETURNING id, (xmax = 0) AS inserted`;
  return rows[0]!;
}
