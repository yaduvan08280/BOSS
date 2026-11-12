import { Prisma, reachSql, type Db } from '@mono/db';
import {
  addDays,
  checkReport,
  financialYear,
  flowDefinitionSchema,
  flowFieldMap,
  formatLocalDate,
  localDate,
  REPORT_BUILTINS,
  reportKindOf,
  weekOf,
  type FlowField,
  type ReportDefinition,
  type ReportField,
  type ReportFilter,
  type ReportKind,
  type ReportMeasure,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { loadType } from '../records/access';
import { can, type Actor } from '../work/actor';
import { syncReportable } from './backfill';

const sql = Prisma.sql;
type Sql = Prisma.Sql;

export type LoadedSource = {
  kind: ReportDefinition['source']['kind'];
  id: string;
  name: string;
  fields: ReportField[];
  statusLabel: (key: string) => string;
  tz: string;
  fyStart: number;
};

const FLOW_STATUS: Record<string, string> = { RUNNING: 'Running', ON_HOLD: 'On hold', CLOSED: 'Closed' };

/**
 * A report's source — a process or a record type — after checking that this person may see its records
 * (`fms.view` for a process, the type's own "view" right for a record type), with the columns it offers:
 * the ones every record has, and the fields marked reportable.
 */
export async function loadSource(
  db: Db,
  actor: Actor,
  source: ReportDefinition['source'],
): Promise<LoadedSource> {
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  let name: string;
  let marked: FlowField[];
  let statusLabel: LoadedSource['statusLabel'];
  if (source.kind === 'flow') {
    if (!can(actor, 'fms.view')) throw new AppError(403, 'FORBIDDEN', "You can't see this process's records");
    const flow = await db.flow.findFirst({
      where: { id: source.id, companyId: actor.companyId, deletedAt: null },
      select: { name: true, draft: true, currentVersionId: true },
    });
    if (!flow) throw notFound('Process');
    const version = flow.currentVersionId
      ? await db.flowVersion.findUnique({
          where: { id: flow.currentVersionId },
          select: { definition: true },
        })
      : null;
    name = flow.name;
    marked = [...flowFieldMap(flowDefinitionSchema.parse(version?.definition ?? {})).values()];
    statusLabel = (k) => FLOW_STATUS[k] ?? k;
  } else {
    const t = await loadType(db, actor, source.id, 'view');
    name = t.pluralName;
    marked = t.def.fields;
    statusLabel = (k) => t.def.statuses.find((s) => s.key === k)?.label ?? k;
  }
  marked = marked.filter((f) => f.reportable);
  let jobs = await db.reportBackfill.findMany({ where: { ownerKind: source.kind, ownerId: source.id } });
  // A field marked before copies existed (an older definition) is queued here, so it heals by itself.
  if (marked.some((f) => !jobs.some((j) => j.field === f.key))) {
    await db.$transaction((tx) => syncReportable(tx, actor.companyId, source, marked));
    jobs = await db.reportBackfill.findMany({ where: { ownerKind: source.kind, ownerId: source.id } });
  }
  const done = new Set(jobs.filter((j) => j.status === 'DONE').map((j) => j.field));
  return {
    kind: source.kind,
    id: source.id,
    name,
    statusLabel,
    tz: company.timezone,
    fyStart: company.fyStartMonth ?? 4,
    fields: [
      ...REPORT_BUILTINS[source.kind].map((b) => ({ ...b, builtin: true, ready: true })),
      ...marked.map((f) => ({
        key: f.key,
        label: f.label,
        kind: reportKindOf(f),
        builtin: false,
        ready: done.has(f.key),
      })),
    ],
  };
}

export type ReportResult = {
  source: { kind: string; id: string; name: string };
  grouped: boolean;
  columns: { key: string; label: string; kind: ReportKind }[];
  /** Text and dates come ready to read (DD/MM/YYYY, "Nov 2026"); numbers come as numbers. */
  rows: (string | number | null)[][];
  /** Ungrouped: the record behind each row. */
  ids: string[] | null;
  /** One value per measure, over every matching record (null when the report has no measures). */
  totals: (number | null)[] | null;
  measures: string[];
  /** How many records match the filters. */
  total: number;
  /** Fields whose copies for older records are still being made: their numbers may be incomplete. */
  pending: string[];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = (v: unknown): number | null =>
  v === null || v === undefined
    ? null
    : typeof v === 'bigint'
      ? Number(v)
      : v instanceof Prisma.Decimal
        ? Number(v)
        : Number(v);
const dayOf = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'string' ? v.slice(0, 10) : null;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const MEASURE_WORD: Record<ReportMeasure['fn'], string> = {
  count: 'Count',
  sum: 'Total',
  avg: 'Average',
  min: 'Lowest',
  max: 'Highest',
};

/**
 * Run a report (plan §2.7). The SQL is put together from fixed pieces only: every field key, value and id is a
 * bound parameter, every name is checked against the source's own columns first, the company is always in the
 * WHERE, and the query runs read-only with a time limit. A person without the right to see the source gets a
 * 403 from `loadSource` — a shared report never shows more than its reader may see.
 */
export async function runReport(
  db: Db,
  actor: Actor,
  def: ReportDefinition,
  max = 500,
): Promise<ReportResult> {
  const src = await loadSource(db, actor, def.source);
  const problems = checkReport(def, src.fields);
  if (problems.length) throw new AppError(400, 'VALIDATION_FAILED', problems[0]!, { problems });
  const byKey = new Map(src.fields.map((f) => [f.key, f]));
  const flow = src.kind === 'flow';

  // One join per reportable field used; aliases are made here (v0, v1 …), never from user text.
  const joins: Sql[] = [];
  const alias = new Map<string, Sql>();
  const copy = (key: string) => {
    if (!alias.has(key)) {
      const a = Prisma.raw(`v${alias.size}`);
      alias.set(key, a);
      joins.push(
        sql`LEFT JOIN report_values ${a} ON ${a}.owner_kind = ${src.kind} AND ${a}.owner_id = ${src.id} AND ${a}.record_id = r.id AND ${a}.field = ${key}`,
      );
    }
    return alias.get(key)!;
  };
  const made = flow ? sql`r.started_at` : sql`r.created_at`;
  /** A column as SQL: what is shown, what is compared (text in lower case), its number, its day. */
  const col = (key: string): { shown: Sql; cmp: Sql; number: Sql; day: Sql } => {
    const none = sql`NULL`;
    if (byKey.get(key)!.builtin) {
      if (key === 'number')
        return { shown: sql`r.number`, cmp: sql`r.number::text`, number: sql`r.number`, day: none };
      if (key === 'code') return { shown: sql`r.code`, cmp: sql`lower(r.code)`, number: none, day: none };
      if (key === 'title') return { shown: sql`r.title`, cmp: sql`lower(r.title)`, number: none, day: none };
      if (key === 'status')
        return { shown: sql`r.status`, cmp: sql`lower(r.status)`, number: none, day: none };
      if (key === 'by') return { shown: sql`u.name`, cmp: sql`lower(u.name)`, number: none, day: none };
      const day = sql`(${made} AT TIME ZONE ${src.tz})::date`;
      return { shown: day, cmp: none, number: none, day };
    }
    const a = copy(key);
    return { shown: sql`${a}.text`, cmp: sql`${a}.norm`, number: sql`${a}.number`, day: sql`${a}.day` };
  };
  const valueOf = (key: string) => {
    const c = col(key);
    const kind = byKey.get(key)!.kind;
    return kind === 'number' ? c.number : kind === 'date' ? c.day : c.shown;
  };

  const today = localDate(new Date(), src.tz);
  const d = (iso: string) => sql`${iso}::date`;
  const filterSql = (f: ReportFilter): Sql => {
    const kind = byKey.get(f.field)!.kind;
    const c = col(f.field);
    const v = kind === 'number' ? c.number : kind === 'date' ? c.day : c.cmp;
    const arg = (s: string) =>
      kind === 'number' ? sql`${Number(s)}::numeric` : kind === 'date' ? d(s) : sql`${norm(s)}`;
    switch (f.op) {
      case 'eq':
        return sql`${v} = ${arg(f.value!)}`;
      case 'contains':
        return sql`${c.cmp} LIKE ${`%${escapeLike(norm(f.value!))}%`}`;
      case 'gte':
        return sql`${v} >= ${arg(f.value!)}`;
      case 'lte':
        return sql`${v} <= ${arg(f.value!)}`;
      case 'between':
        return sql`${v} BETWEEN ${arg(f.value!)} AND ${arg(f.value2!)}`;
      case 'last_days':
        return sql`${c.day} BETWEEN ${d(addDays(today, 1 - Number(f.value)))} AND ${d(today)}`;
      case 'this_week': {
        const w = weekOf(new Date(), src.tz);
        return sql`${c.day} BETWEEN ${d(localDate(w.from, src.tz))} AND ${d(addDays(localDate(w.from, src.tz), 6))}`;
      }
      case 'this_month':
        return sql`${c.day} >= ${d(`${today.slice(0, 7)}-01`)} AND ${c.day} < (${d(`${today.slice(0, 7)}-01`)} + interval '1 month')`;
      case 'this_fy': {
        const fy = financialYear(new Date(), src.tz, src.fyStart);
        const from = `${fy.start}-${String(src.fyStart).padStart(2, '0')}-01`;
        return sql`${c.day} >= ${d(from)} AND ${c.day} < (${d(from)} + interval '1 year')`;
      }
      case 'filled':
        return kind === 'text' ? sql`coalesce(${v}, '') <> ''` : sql`${v} IS NOT NULL`;
      default:
        return kind === 'text' ? sql`coalesce(${v}, '') = ''` : sql`${v} IS NULL`;
    }
  };
  const where = Prisma.join(
    [
      sql`r.company_id = ${actor.companyId}`,
      // Reach (phase 12): a report never counts what its reader may not see.
      reachSql(flow ? 'fms_records' : 'records'),
      flow ? sql`r.flow_id = ${src.id}` : sql`r.type_id = ${src.id}`,
      sql`r.deleted_at IS NULL`,
      ...(flow ? [sql`r.status <> 'CANCELLED'`] : []),
      ...def.filters.map(filterSql),
    ],
    ' AND ',
  );
  const measureSql = (m: ReportMeasure): Sql => {
    if (m.fn === 'count') return sql`count(*)`;
    const n = col(m.field!).number;
    return m.fn === 'sum'
      ? sql`sum(${n})`
      : m.fn === 'avg'
        ? sql`round(avg(${n}), 2)`
        : m.fn === 'min'
          ? sql`min(${n})`
          : sql`max(${n})`;
  };
  // Every selected value gets its own name (m0, c0 …): two totals must never share a column name.
  const measures = def.measures.map((m, i) => sql`${measureSql(m)} AS ${Prisma.raw(`m${i}`)}`);
  const measureNames = def.measures.map((m) =>
    m.fn === 'count' ? MEASURE_WORD.count : `${MEASURE_WORD[m.fn]} ${byKey.get(m.field!)!.label}`,
  );
  const limit = Math.min(def.limit ?? max, 5000);
  const dir = (x?: string) => (x === 'asc' ? sql`ASC` : sql`DESC`);
  const usersJoin = flow
    ? sql`LEFT JOIN users u ON u.id = r.started_by_id`
    : sql`LEFT JOIN users u ON u.id = r.created_by_id`;
  const table = flow ? sql`fms_records r` : sql`records r`;
  // Read only after every column has been named (naming a reportable field adds its join).
  const joined = () => (joins.length ? Prisma.join(joins, ' ') : Prisma.empty);

  // Everything that names a column must run before `joins` is read: build the SELECT pieces first.
  let rowsSql: Sql;
  const group = def.groupBy;
  let groupKind: ReportKind = 'text';
  if (group) {
    const g = byKey.get(group.field)!;
    groupKind = g.kind;
    const c = col(group.field);
    let key: Sql;
    if (g.kind === 'date') {
      const b = group.bucket ?? 'day';
      key =
        b === 'day'
          ? c.day
          : b === 'fy'
            ? sql`make_date((extract(year from ${c.day}) - CASE WHEN extract(month from ${c.day}) < ${src.fyStart} THEN 1 ELSE 0 END)::int, ${src.fyStart}, 1)`
            : sql`date_trunc(${b}, ${c.day}::timestamp)::date`;
    } else key = g.kind === 'number' ? c.number : c.cmp;
    const label = g.kind === 'text' ? sql`min(${c.shown})` : sql`NULL`;
    const order =
      def.sort?.by && /^m\d$/.test(def.sort.by) && measures[Number(def.sort.by.slice(1))]
        ? sql`${Prisma.raw(String(Number(def.sort.by.slice(1)) + 3))} ${dir(def.sort.dir)} NULLS LAST, 1`
        : def.sort?.by === 'group' || g.kind !== 'text'
          ? sql`1 ${dir(def.sort?.dir ?? 'asc')} NULLS LAST`
          : sql`3 DESC NULLS LAST, 1`;
    rowsSql = sql`SELECT ${key} AS g, ${label} AS label, ${Prisma.join(measures)} FROM ${table} ${usersJoin} ${joined()} WHERE ${where} GROUP BY 1 ORDER BY ${order} LIMIT ${limit}`;
  } else {
    const cols = def.columns.map((k, i) => sql`${valueOf(k)} AS ${Prisma.raw(`c${i}`)}`);
    const sortKey = def.sort?.by && byKey.has(def.sort.by) ? valueOf(def.sort.by) : null;
    const order = sortKey
      ? sql`${sortKey} ${dir(def.sort!.dir)} NULLS LAST, ${made} DESC`
      : sql`${made} DESC, r.id DESC`;
    rowsSql = sql`SELECT r.id AS id${cols.length ? sql`, ${Prisma.join(cols)}` : Prisma.empty} FROM ${table} ${usersJoin} ${joined()} WHERE ${where} ORDER BY ${order} LIMIT ${limit}`;
  }
  const totalsSql = sql`SELECT count(*) AS n${measures.length ? sql`, ${Prisma.join(measures)}` : Prisma.empty} FROM ${table} ${usersJoin} ${joined()} WHERE ${where}`;

  const [rows, totals] = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'");
    return [
      await tx.$queryRaw<Record<string, unknown>[]>(rowsSql),
      await tx.$queryRaw<Record<string, unknown>[]>(totalsSql),
    ];
  });

  const bucketLabel = (iso: string | null): string | null => {
    if (!iso) return null;
    const b = group?.bucket ?? 'day';
    const [y, m] = iso.split('-').map(Number) as [number, number];
    if (b === 'day') return formatLocalDate(iso);
    if (b === 'week') return `Week of ${formatLocalDate(iso)}`;
    if (b === 'month') return `${MONTHS[m - 1]} ${y}`;
    const start = m >= src.fyStart ? y : y - 1;
    const fy = `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
    if (b === 'fy') return `FY ${fy}`;
    return `Q${Math.floor(((m - src.fyStart + 12) % 12) / 3) + 1} ${fy}`;
  };
  const cell = (key: string, v: unknown): string | number | null => {
    const kind = byKey.get(key)!.kind;
    if (v === null || v === undefined) return null;
    if (kind === 'number') return num(v);
    if (kind === 'date') return formatLocalDate(dayOf(v)!);
    return key === 'status' ? src.statusLabel(String(v)) : String(v);
  };
  const values = (r: Record<string, unknown>) => Object.values(r);
  const totalRow = totals[0] ? values(totals[0]) : [0];
  const pending = [...new Set([...alias.keys()])]
    .filter((k) => !byKey.get(k)!.ready)
    .map((k) => byKey.get(k)!.label);
  const head = {
    source: { kind: src.kind, id: src.id, name: src.name },
    total: num(totalRow[0]) ?? 0,
    pending,
  };
  if (group) {
    const g = byKey.get(group.field)!;
    return {
      ...head,
      grouped: true,
      columns: [
        { key: 'group', label: g.label, kind: groupKind === 'number' ? 'number' : 'text' },
        ...measureNames.map((label, i) => ({ key: `m${i}`, label, kind: 'number' as const })),
      ],
      rows: rows.map((r) => {
        const [key, label, ...ms] = values(r);
        const first =
          g.kind === 'date'
            ? bucketLabel(dayOf(key))
            : g.kind === 'number'
              ? num(key)
              : group.field === 'status' && label !== null
                ? src.statusLabel(String(label))
                : ((label as string | null) ?? null);
        return [first, ...ms.map(num)];
      }),
      ids: null,
      totals: totalRow.slice(1).map(num),
      measures: measureNames,
    };
  }
  return {
    ...head,
    grouped: false,
    columns: def.columns.map((k) => ({ key: k, label: byKey.get(k)!.label, kind: byKey.get(k)!.kind })),
    rows: rows.map((r) =>
      values(r)
        .slice(1)
        .map((v, i) => cell(def.columns[i]!, v)),
    ),
    ids: rows.map((r) => String(r.id)),
    totals: measures.length ? totalRow.slice(1).map(num) : null,
    measures: measureNames,
  };
}
