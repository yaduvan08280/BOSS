import { makeRef, plainValues, type RecordViewConfig } from '@mono/shared';
import { loadType } from '../../records/access';
import { scopeOf } from '../../records/list';
import { queryRecords } from '../../records/query';
import type { SourceHandler } from './index';

/**
 * `rt:<recordTypeId>` — pick a record of a custom record type ("SV/26-27/0004 · Sharma farm"). Only for people
 * who may see that type's records (a 403 otherwise, a 404 for another company's type). `columns` are the
 * record's own values plus its number, title and status, for auto-fill and dependent choices.
 */
export const recordTypeSource: SourceHandler = async (db, actor, typeId, { q, limit, filter }) => {
  const t = await loadType(db, actor, typeId, 'view');
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
  const status = (key: string) => t.def.statuses.find((s) => s.key === key)?.label ?? key;
  return rows.map((r) => {
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
  });
};
