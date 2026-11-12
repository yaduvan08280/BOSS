import type { Db } from '@mono/db';
import { recordChange } from '../../lib/events';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { listsInForms } from './usage';
import { LIST_KEY, mayAddValues, normOf, offeredCount, offeredValues, VALUE_MAX } from './values';

const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });
const needEdit = (actor: Actor) => {
  if (!can(actor, 'core.edit')) throw new AppError(403, 'FORBIDDEN', 'Only admins change lists');
};
const checkKey = (key: string) => {
  if (!LIST_KEY.test(key)) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown list');
  return key;
};
function clean(value: string) {
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v) throw new AppError(400, 'VALIDATION_FAILED', 'Type a value');
  if (v.length > VALUE_MAX)
    throw new AppError(400, 'VALIDATION_FAILED', `A value can have ${VALUE_MAX} letters at most`);
  return v;
}

/** What a form's "remember" field shows: the offered values, how many there are, and whether this person may add. */
export async function offer(db: Db, actor: Actor, key: string, q = '') {
  const [values, total] = await Promise.all([
    offeredValues(db, actor.companyId, key, q, 50),
    offeredCount(db, actor.companyId, key),
  ]);
  return {
    values: values.map((v) => ({ value: v.value, uses: v.uses })),
    /** Values offered before any filter: a closed list is closed only once this is above zero. */
    total,
    /** May add to a list that is closed to new values ("only admins add"). */
    canAdd: mayAddValues(actor),
  };
}

/** The named shared lists of the company (for the form editor): from saved values and from forms that use one. */
export async function listNames(db: Db, actor: Actor) {
  const [rows, forms] = await Promise.all([
    db.valueList.groupBy({
      by: ['key'],
      where: { companyId: actor.companyId, deletedAt: null, key: { startsWith: 'list:' } },
      _count: { _all: true },
    }),
    listsInForms(db, actor.companyId),
  ]);
  const counts = new Map(rows.map((r) => [r.key, r._count._all]));
  const keys = new Set([...counts.keys(), ...[...forms.keys()].filter((k) => k.startsWith('list:'))]);
  return [...keys]
    .map((k) => ({ name: k.slice(5), values: counts.get(k) ?? 0, forms: forms.get(k)?.length ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Masters → Lists: every list of the company with its counts and the forms that use it. */
export async function listLists(db: Db, actor: Actor) {
  needEdit(actor);
  const [rows, forms] = await Promise.all([
    db.valueList.groupBy({
      by: ['key', 'hidden'],
      where: { companyId: actor.companyId, deletedAt: null },
      _count: { _all: true },
      _sum: { uses: true },
    }),
    listsInForms(db, actor.companyId),
  ]);
  const out = new Map<string, { values: number; hidden: number; uses: number }>();
  const at = (key: string) => out.get(key) ?? out.set(key, { values: 0, hidden: 0, uses: 0 }).get(key)!;
  for (const r of rows) {
    const l = at(r.key);
    l.values += r._count._all;
    l.uses += r._sum.uses ?? 0;
    if (r.hidden) l.hidden += r._count._all;
  }
  // A list a form asks for is shown before anyone typed in it, so an admin can fill it first.
  for (const key of forms.keys()) at(key);
  return [...out.entries()]
    .map(([key, counts]) => {
      const usedIn = forms.get(key) ?? [];
      const shared = key.startsWith('list:');
      return {
        key,
        shared,
        /** A shared list's name, or the label of the field that owns the list. */
        name: shared ? key.slice(5) : (usedIn[0]?.field ?? key.slice(key.lastIndexOf(':') + 1)),
        ...counts,
        /** Some form lets only admins add to it. */
        closed: usedIn.some((u) => u.closed),
        usedIn,
      };
    })
    .sort((a, b) => Number(b.shared) - Number(a.shared) || a.name.localeCompare(b.name));
}

/** Every value of one list (hidden ones too), most used first. */
export async function listValues(db: Db, actor: Actor, key: string, q = '') {
  needEdit(actor);
  const words = normOf(q).split(' ').filter(Boolean);
  const rows = await db.valueList.findMany({
    where: {
      companyId: actor.companyId,
      key: checkKey(key),
      deletedAt: null,
      ...(words.length ? { AND: words.map((w) => ({ norm: { contains: w } })) } : {}),
    },
    orderBy: [{ hidden: 'asc' }, { uses: 'desc' }, { value: 'asc' }],
    take: 1000,
    select: { id: true, value: true, uses: true, hidden: true, lastUsedAt: true, createdAt: true },
  });
  return { key, values: rows };
}

async function clash(db: Db, companyId: string, key: string, value: string, notId?: string) {
  const other = await db.valueList.findFirst({
    where: { companyId, key, norm: normOf(value), deletedAt: null, ...(notId ? { id: { not: notId } } : {}) },
    select: { value: true, hidden: true },
  });
  if (other)
    throw new AppError(
      409,
      'CONFLICT',
      `"${other.value}" is already in this list${other.hidden ? ' (hidden)' : ''}`,
    );
}

/** An admin adds a value before anyone typed it (0 uses). */
export async function addValue(db: Db, actor: Actor, input: { key: string; value: string }) {
  needEdit(actor);
  const key = checkKey(input.key);
  const value = clean(input.value);
  await clash(db, actor.companyId, key, value);
  return db.$transaction(async (tx) => {
    const row = await tx.valueList.create({
      data: { companyId: actor.companyId, key, value, norm: normOf(value), createdById: actor.userId },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'list.value_added',
      entityType: 'value_list',
      entityId: row.id,
      after: { key, value },
      payload: { key, value, via: 'admin' },
    });
    return { id: row.id, value };
  });
}

async function loadValue(db: Db, actor: Actor, id: string) {
  const row = await db.valueList.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!row) throw notFound('Value');
  return row;
}

/**
 * Rename a value and / or hide it (show it again). Only what the list offers changes: records that already
 * hold the old text keep it.
 */
export async function changeValue(
  db: Db,
  actor: Actor,
  id: string,
  input: { value?: string; hidden?: boolean },
) {
  needEdit(actor);
  const row = await loadValue(db, actor, id);
  const value = input.value === undefined ? row.value : clean(input.value);
  const hidden = input.hidden ?? row.hidden;
  if (value !== row.value) await clash(db, actor.companyId, row.key, value, id);
  return db.$transaction(async (tx) => {
    await tx.valueList.update({ where: { id }, data: { value, norm: normOf(value), hidden } });
    if (value !== row.value)
      await recordChange(tx, ctxOf(actor), {
        event: 'list.value_renamed',
        entityType: 'value_list',
        entityId: id,
        before: { value: row.value },
        after: { value },
        payload: { key: row.key, from: row.value, value },
      });
    if (hidden !== row.hidden)
      await recordChange(tx, ctxOf(actor), {
        event: hidden ? 'list.value_hidden' : 'list.value_shown',
        entityType: 'value_list',
        entityId: id,
        before: { hidden: row.hidden },
        after: { hidden },
        payload: { key: row.key, value },
      });
    return { id, value, hidden };
  });
}

/**
 * Merge A into B: B gets A's uses, A is no longer offered (kept as history; its text is free to be typed again).
 * Records that say A keep saying A.
 */
export async function mergeValue(db: Db, actor: Actor, id: string, intoId: string) {
  needEdit(actor);
  if (id === intoId) throw new AppError(400, 'VALIDATION_FAILED', 'Pick another value to merge into');
  const [from, into] = await Promise.all([loadValue(db, actor, id), loadValue(db, actor, intoId)]);
  if (from.key !== into.key)
    throw new AppError(400, 'VALIDATION_FAILED', 'Both values must be in the same list');
  return db.$transaction(async (tx) => {
    // The update hands back A's count as it is now, so a use counted a moment ago is not lost.
    const gone = await tx.valueList.update({ where: { id }, data: { deletedAt: new Date(), norm: null } });
    const last = [gone.lastUsedAt, into.lastUsedAt]
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const kept = await tx.valueList.update({
      where: { id: intoId },
      data: { uses: { increment: gone.uses }, ...(last ? { lastUsedAt: last } : {}) },
    });
    await recordChange(tx, ctxOf(actor), {
      event: 'list.values_merged',
      entityType: 'value_list',
      entityId: id,
      before: { value: gone.value, uses: gone.uses },
      after: { mergedInto: intoId, value: kept.value, uses: kept.uses },
      payload: { key: from.key, from: gone.value, into: kept.value, intoId, uses: kept.uses },
    });
    return { id: intoId, value: kept.value, uses: kept.uses };
  });
}
