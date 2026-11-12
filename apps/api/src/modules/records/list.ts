import type { Db } from '@mono/db';
import {
  defaultColumns,
  plainValues,
  RECORD_BUILTIN_COLUMNS,
  recordViewConfigSchema,
  type RecordDefinition,
  type RecordViewConfig,
  type RecordViewInput,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, loadType, type LoadedType } from './access';
import { queryRecords, statusCounts, type ListScope } from './query';

export type ListQuery = RecordViewConfig & { page?: number; pageSize?: number };

export async function scopeOf(db: Db, actor: Actor, t: LoadedType): Promise<ListScope> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  return { companyId: actor.companyId, typeId: t.id, tz: company.timezone };
}

/** The columns asked for that this type really has (built-in ones and fields), else the type's defaults. */
export function columnsOf(def: RecordDefinition, asked?: string[]): string[] {
  const known = new Set<string>([...RECORD_BUILTIN_COLUMNS, ...def.fields.map((f) => f.key)]);
  const cols = (asked ?? []).filter((c) => known.has(c));
  return cols.length ? cols : defaultColumns(def).filter((c) => known.has(c));
}

/** A type's list (U4): server-side search, statuses, date range, field filters, sort and paging. */
export async function listRecords(db: Db, actor: Actor, typeId: string, query: ListQuery) {
  const t = await loadType(db, actor, typeId, 'view');
  const scope = await scopeOf(db, actor, t);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const page = Math.max(1, query.page ?? 1);
  const columns = columnsOf(t.def, query.columns);
  const [{ rows, total }, counts] = await Promise.all([
    queryRecords(db, scope, t.def, query, { skip: (page - 1) * pageSize, take: pageSize }),
    statusCounts(db, scope, t.def, query),
  ]);
  const fieldCols = columns.filter((c) => t.def.fields.some((f) => f.key === c));
  return {
    columns,
    page,
    pageSize,
    total,
    counts,
    rows: rows.map((r) => {
      const values = plainValues(r.data);
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        status: r.status,
        createdAt: r.createdAt,
        createdBy: r.createdBy,
        // Only the chosen columns travel: a phone does not download 60 fields per row.
        data: Object.fromEntries(fieldCols.filter((c) => c in values).map((c) => [c, values[c]])),
      };
    }),
  };
}

const viewOf = (
  v: { id: string; name: string; shared: boolean; userId: string; config: unknown },
  actor: Actor,
) => ({
  id: v.id,
  name: v.name,
  shared: v.shared,
  mine: v.userId === actor.userId,
  config: recordViewConfigSchema.parse(v.config),
});

/** Saved views of a type's list: my own, and the ones shared with everyone who can see the type. */
export async function listViews(db: Db, actor: Actor, typeId: string) {
  await loadType(db, actor, typeId, 'view');
  const rows = await db.recordView.findMany({
    where: { companyId: actor.companyId, typeId, OR: [{ userId: actor.userId }, { shared: true }] },
    orderBy: [{ shared: 'desc' }, { name: 'asc' }],
  });
  return rows.map((v) => viewOf(v, actor));
}

/** Sharing a view puts it on everybody's list, so it needs the right to edit this type's records. */
function mayShare(t: LoadedType, shared: boolean) {
  if (shared && !t.access.edit)
    throw new AppError(403, 'FORBIDDEN', 'Only people who can change these records can share a view');
}

export async function saveView(
  db: Db,
  actor: Actor,
  typeId: string,
  input: RecordViewInput,
  viewId?: string,
) {
  const t = await loadType(db, actor, typeId, 'view');
  mayShare(t, input.shared);
  const before = viewId
    ? await db.recordView.findFirst({ where: { id: viewId, typeId, companyId: actor.companyId } })
    : null;
  if (viewId && !before) throw notFound('View');
  // Mine, or a shared one for the people who set the type up.
  if (before && before.userId !== actor.userId && !t.access.admin)
    throw new AppError(403, 'FORBIDDEN', 'This view belongs to someone else: save your own copy');
  const data = { name: input.name, shared: input.shared, config: input.config as object };
  return db.$transaction(async (tx) => {
    const row = before
      ? await tx.recordView.update({ where: { id: before.id }, data })
      : await tx.recordView.create({
          data: { ...data, companyId: actor.companyId, typeId, userId: actor.userId },
        });
    await recordChange(tx, ctxOf(actor), {
      event: before ? 'record_view.changed' : 'record_view.created',
      entityType: 'record_view',
      entityId: row.id,
      before: before ? { name: before.name, shared: before.shared, config: before.config } : undefined,
      after: data,
      payload: { typeId, viewId: row.id, name: row.name, shared: row.shared },
    });
    return viewOf(row, actor);
  });
}

export async function deleteView(db: Db, actor: Actor, typeId: string, viewId: string) {
  const t = await loadType(db, actor, typeId, 'view');
  const v = await db.recordView.findFirst({ where: { id: viewId, typeId, companyId: actor.companyId } });
  if (!v) throw notFound('View');
  if (v.userId !== actor.userId && !t.access.admin)
    throw new AppError(403, 'FORBIDDEN', 'This view belongs to someone else');
  await db.$transaction(async (tx) => {
    // A view holds no history of its own (it is a saved search), so it is simply removed; the audit keeps it.
    await tx.recordView.delete({ where: { id: viewId } });
    await recordChange(tx, ctxOf(actor), {
      event: 'record_view.deleted',
      entityType: 'record_view',
      entityId: viewId,
      before: { name: v.name, shared: v.shared, config: v.config },
      payload: { typeId, viewId, name: v.name },
    });
  });
  return { ok: true };
}
