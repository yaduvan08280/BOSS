import type { Db } from '@mono/db';
import { makeRef, plainValues, type RecordViewConfig } from '@mono/shared';
import { notFound } from '../../../lib/errors';
import { loadType, roleIdOf, shapeType } from '../../records/access';
import { scopeOf } from '../../records/list';
import { queryRecords } from '../../records/query';
import type { Actor } from '../../work/actor';
import type { SourceHandler } from './index';

/** Who may browse a record type's records as choices: people who may see that type (403 otherwise, 404 for another company's). */
export async function mayReadRecordType(db: Db, actor: Actor, typeId: string) {
  await loadType(db, actor, typeId, 'view');
}

/**
 * `rt:<recordTypeId>` — pick a record of a custom record type ("SV/26-27/0004 · Sharma farm"). `columns` are the
 * record's own values plus its number, title and status, for auto-fill and dependent choices. Like every source,
 * the handler is company-scoped and leaves the question "may this person browse it" to `masterOptions`
 * (`mayReadRecordType`): a saved form checks its links through here whoever fills it in.
 */
export const recordTypeSource: SourceHandler = async (db, actor, typeId, { q, limit, filter, ids }) => {
  const row = await db.recordType.findFirst({
    where: { id: typeId, companyId: actor.companyId, deletedAt: null },
  });
  if (!row) throw notFound('Record type');
  const t = shapeType(row, actor, await roleIdOf(db, actor));
  const status = (key: string) => t.def.statuses.find((s) => s.key === key)?.label ?? key;
  const option = (r: { id: string; code: string; title: string; status: string; data: unknown }) => {
    const label = r.title && r.title !== r.code ? `${r.code} · ${r.title}` : r.code;
    return {
      value: label,
      label,
      sub: status(r.status),
      ref: makeRef('rt', r.id),
      columns: {
        ...plainValues(r.data),
        code: r.code,
        title: r.title,
        status: status(r.status),
        status_key: r.status,
      },
    };
  };
  if (ids) {
    // A picked link being checked: exactly those records, whatever the search says.
    const picked = await db.recordEntry.findMany({
      where: { id: { in: ids }, companyId: actor.companyId, typeId: t.id, deletedAt: null },
      select: { id: true, code: true, title: true, status: true, data: true },
    });
    return picked.map(option);
  }
  const cfg: RecordViewConfig = { q };
  if (filter) {
    const wanted = filter.value.trim().toLowerCase();
    if (filter.column === 'status' || filter.column === 'status_key') {
      cfg.status = t.def.statuses
        .filter((s) => s.key === wanted || s.label.toLowerCase() === wanted)
        .map((s) => s.key);
      if (!cfg.status.length) return [];
    } else if (
      t.def.fields.some((f) => f.key === filter.column && ['text', 'dropdown', 'master'].includes(f.type))
    )
      cfg.filters = [{ field: filter.column, op: 'eq', value: filter.value }];
  }
  const { rows } = await queryRecords(db, await scopeOf(db, actor, t), t.def, cfg, { skip: 0, take: limit });
  return rows.map(option);
};
