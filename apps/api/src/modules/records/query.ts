import { Prisma, type Db } from '@mono/db';
import {
  addDays,
  filterOpsFor,
  listable,
  zonedToUtc,
  type FlowField,
  type RecordDefinition,
  type RecordFilter,
  type RecordViewConfig,
} from '@mono/shared';
import { AppError } from '../../lib/errors';

/**
 * A list of records as SQL (search, statuses, a date range, filters by any field's value, sort). Every value —
 * including field keys — is a bound parameter; the only SQL text chosen here comes from fixed tables below.
 * Field keys are also checked against the type's definition first, so an unknown one is a 400, not an empty list.
 */
const sql = Prisma.sql;
const NUMERIC = ['number', 'amount', 'formula'];
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const bad = (message: string) => new AppError(400, 'VALIDATION_FAILED', message);

/** The value of a number field as a number, and nothing when it holds something else (never a failed cast). */
const numberOf = (key: string) =>
  sql`CASE WHEN jsonb_typeof(r.data -> ${key}) = 'number' THEN (r.data ->> ${key})::numeric END`;
const textOf = (key: string) => sql`(r.data ->> ${key})`;
const isFilled = (key: string) => sql`coalesce(r.data ->> ${key}, '') NOT IN ('', '[]')`;

function fieldFilter(f: FlowField, filter: RecordFilter): Prisma.Sql {
  if (!listable(f)) throw bad(`"${f.label}" can't be filtered`);
  if (!filterOpsFor(f).includes(filter.op)) throw bad(`"${f.label}" can't be filtered that way`);
  const key = f.key;
  if (filter.op === 'filled') return isFilled(key);
  if (filter.op === 'empty') return sql`NOT (${isFilled(key)})`;
  const value = (filter.value ?? '').trim();
  if (!value) throw bad(`Type a value to filter "${f.label}" by`);
  if (NUMERIC.includes(f.type)) {
    const n = Number(value.replace(/[,₹\s]/g, ''));
    if (!Number.isFinite(n)) throw bad(`"${f.label}" is a number: type a number to filter by`);
    if (filter.op === 'gte') return sql`${numberOf(key)} >= ${n}`;
    if (filter.op === 'lte') return sql`${numberOf(key)} <= ${n}`;
    return sql`${numberOf(key)} = ${n}`;
  }
  if (f.type === 'date' || f.type === 'datetime') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bad(`"${f.label}" is a date: pick a date to filter by`);
    // A date-time is kept as a UTC instant; "on or after a day" reads its first 10 characters (close enough
    // for a filter; the list's own date range uses the company's days exactly).
    const day = sql`left(${textOf(key)}, 10)`;
    if (filter.op === 'gte') return sql`${day} >= ${value}`;
    if (filter.op === 'lte') return sql`(${day} <= ${value} AND ${isFilled(key)})`;
    return sql`${day} = ${value}`;
  }
  if (f.type === 'yesno') {
    const yes = /^(y|yes|true|1|हाँ)$/i.test(value);
    return sql`r.data -> ${key} = ${yes ? 'true' : 'false'}::jsonb`;
  }
  if (f.type === 'multiselect')
    return filter.op === 'contains'
      ? sql`${textOf(key)} ILIKE ${`%${escapeLike(value)}%`}`
      : sql`(jsonb_typeof(r.data -> ${key}) = 'array' AND r.data -> ${key} @> to_jsonb(${value}::text))`;
  if (filter.op === 'contains') return sql`${textOf(key)} ILIKE ${`%${escapeLike(value)}%`}`;
  return sql`lower(${textOf(key)}) = lower(${value})`;
}

const BUILTIN_SORT: Record<string, Prisma.Sql> = {
  code: sql`r.fy, r.number`,
  title: sql`lower(r.title)`,
  status: sql`r.status`,
  createdAt: sql`r.created_at`,
};

export type ListScope = { companyId: string; typeId: string; tz: string };

/** WHERE of a list. `skipStatus` leaves the status filter out (for the chips' counts). */
export function whereOf(
  scope: ListScope,
  def: RecordDefinition,
  cfg: RecordViewConfig,
  opts: { skipStatus?: boolean } = {},
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    sql`r.company_id = ${scope.companyId}`,
    sql`r.type_id = ${scope.typeId}`,
    sql`r.deleted_at IS NULL`,
  ];
  const q = cfg.q?.trim();
  if (q) {
    const like = `%${escapeLike(q)}%`;
    // The number, the title, or any value typed into the record (values only, never the field keys).
    parts.push(sql`(r.code ILIKE ${like} OR r.title ILIKE ${like} OR EXISTS (
      SELECT 1 FROM jsonb_each_text(r.data) v WHERE v.key <> '_refs' AND v.value ILIKE ${like}))`);
  }
  if (!opts.skipStatus && cfg.status?.length) {
    const known = cfg.status.filter((s) => def.statuses.some((x) => x.key === s));
    if (!known.length) throw bad('That status does not exist');
    parts.push(sql`r.status IN (${Prisma.join(known)})`);
  }
  if (cfg.from) parts.push(sql`r.created_at >= ${zonedToUtc(cfg.from, 0, scope.tz)}`);
  if (cfg.to) parts.push(sql`r.created_at < ${zonedToUtc(addDays(cfg.to, 1), 0, scope.tz)}`);
  for (const filter of cfg.filters ?? []) {
    const f = def.fields.find((x) => x.key === filter.field);
    if (!f) throw bad(`There is no field "${filter.field}" to filter by`);
    parts.push(fieldFilter(f, filter));
  }
  return Prisma.join(parts, ' AND ');
}

function orderOf(def: RecordDefinition, cfg: RecordViewConfig): Prisma.Sql {
  const dir = cfg.dir === 'asc' ? sql`ASC` : sql`DESC`;
  const newest = sql`r.created_at DESC, r.id DESC`;
  if (!cfg.sort) return newest;
  const builtin = BUILTIN_SORT[cfg.sort];
  if (cfg.sort === 'code') return sql`r.fy ${dir}, r.number ${dir}`;
  if (builtin) return sql`${builtin} ${dir} NULLS LAST, ${newest}`;
  const f = def.fields.find((x) => x.key === cfg.sort);
  if (!f || !listable(f)) throw bad(`The list can't be sorted by "${cfg.sort}"`);
  const expr = NUMERIC.includes(f.type) ? numberOf(f.key) : sql`lower(${textOf(f.key)})`;
  return sql`${expr} ${dir} NULLS LAST, ${newest}`;
}

export type RecordRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  data: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  createdById: string | null;
  createdBy: string | null;
};

/** One page of the list (or, with a big `take`, the whole list for an export), and how many match in all. */
export async function queryRecords(
  db: Db,
  scope: ListScope,
  def: RecordDefinition,
  cfg: RecordViewConfig,
  page: { skip: number; take: number },
): Promise<{ rows: RecordRow[]; total: number }> {
  const where = whereOf(scope, def, cfg);
  const [rows, count] = await Promise.all([
    db.$queryRaw<RecordRow[]>(sql`
      SELECT r.id, r.code, r.title, r.status, r.data, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
             r.created_by_id AS "createdById", u.name AS "createdBy"
      FROM records r LEFT JOIN users u ON u.id = r.created_by_id
      WHERE ${where} ORDER BY ${orderOf(def, cfg)} LIMIT ${page.take} OFFSET ${page.skip}`),
    db.$queryRaw<{ n: bigint }[]>(sql`SELECT count(*) AS n FROM records r WHERE ${where}`),
  ]);
  return { rows, total: Number(count[0]?.n ?? 0) };
}

/** How many records stand in each status under the other filters (the chips above the list). */
export async function statusCounts(
  db: Db,
  scope: ListScope,
  def: RecordDefinition,
  cfg: RecordViewConfig,
): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<{ status: string; n: bigint }[]>(
    sql`SELECT r.status, count(*) AS n FROM records r
        WHERE ${whereOf(scope, def, cfg, { skipStatus: true })} GROUP BY r.status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
