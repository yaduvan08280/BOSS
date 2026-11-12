import { currentReach, Prisma, type Db } from '@mono/db';
import {
  addDays,
  ASK_VIEWS,
  askPlanSchema,
  checkAskPlan,
  daysInMonth,
  financialYear,
  localDate,
  weekOf,
  zonedToUtc,
  type AskColumnType,
  type AskPlan,
  type AskView,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { listReports, runSaved } from '../reports/service';
import { can, type Actor } from '../work/actor';
import { runAi } from './llm';
import * as ANSWER from './prompts/answer.v1';
import * as ASK from './prompts/ask.v2';
import { companyContext } from './prompts/context';

/** A date word or YYYY-MM-DD → the instant it starts, in the company's time zone. */
export function resolveDate(value: unknown, tz: string, now = new Date()): Date | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const today = localDate(now, tz);
  const day = (d: string) => zonedToUtc(d, 0, tz);
  const [y, m] = today.split('-').map(Number) as [number, number];
  const monthStart = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const week = weekOf(now, tz);
  switch (v) {
    case 'now':
      return now;
    case 'today':
      return day(today);
    case 'tomorrow':
      return day(addDays(today, 1));
    case 'yesterday':
      return day(addDays(today, -1));
    case 'start_of_week':
      return week.from;
    case 'end_of_week':
      return week.to;
    case 'start_of_last_week':
      return day(addDays(week.start, -7));
    case 'start_of_month':
      return day(monthStart(y, m));
    case 'end_of_month':
      return day(
        addDays(`${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`, 1),
      );
    case 'start_of_last_month':
      return day(m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1));
    case 'start_of_fy':
      return day(`${financialYear(now, tz).start}-04-01`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return day(v);
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

const col = (name: string) => Prisma.raw(`"${name}"`);

function condition(
  name: string,
  type: AskColumnType,
  op: AskPlan['filters'][number]['op'],
  value: unknown,
  tz: string,
): Prisma.Sql {
  const c = col(name);
  if (op === 'is_null') return Prisma.sql`${c} IS NULL`;
  if (op === 'not_null') return Prisma.sql`${c} IS NOT NULL`;
  const bad = () => new AppError(400, 'BAD_REQUEST', `I couldn't read the value for "${name}"`);
  if (type === 'bool') return Prisma.sql`${c} = ${value === true || value === 'true'}`;
  if (type === 'number') {
    const list = Array.isArray(value) ? value.map(Number) : [Number(value)];
    if (list.some((n) => !Number.isFinite(n))) throw bad();
    if (op === 'in') return Prisma.sql`${c} = ANY(${list})`;
    const n = list[0]!;
    const ops = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=', contains: '=' } as const;
    return Prisma.sql`${c} ${Prisma.raw(ops[op])} ${n}`;
  }
  if (type === 'date') {
    const at = resolveDate(value, tz);
    if (!at) throw bad();
    // "On a day" means that whole local day.
    if (op === 'eq' && typeof value === 'string' && !['now'].includes(value)) {
      const next = new Date(at.getTime() + 86_400_000);
      return Prisma.sql`${c} >= ${at} AND ${c} < ${next}`;
    }
    const ops = {
      eq: '=',
      neq: '<>',
      lt: '<',
      lte: '<=',
      gt: '>',
      gte: '>=',
      contains: '>=',
      in: '=',
    } as const;
    return Prisma.sql`${c} ${Prisma.raw(ops[op])} ${at}`;
  }
  // text: case-insensitive; "contains" for names and titles.
  if (op === 'in') {
    const list = (Array.isArray(value) ? value : [value]).map((x) => String(x).toLowerCase());
    return Prisma.sql`lower(${c}) = ANY(${list})`;
  }
  const s = String(value);
  if (op === 'contains') return Prisma.sql`${c} ILIKE ${`%${s.replace(/[%_\\]/g, '\\$&')}%`}`;
  if (op === 'neq') return Prisma.sql`lower(${c}) <> ${s.toLowerCase()}`;
  if (op === 'eq') return Prisma.sql`lower(${c}) = ${s.toLowerCase()}`;
  const ops = { lt: '<', lte: '<=', gt: '>', gte: '>=' } as const;
  return Prisma.sql`${c} ${Prisma.raw(ops[op])} ${s}`;
}

/** The plan as SQL: names only from the catalog, every value bound, always this company only. */
export function planSql(plan: AskPlan, companyId: string, tz: string, onlyPersonId: string | null) {
  const view = ASK_VIEWS[plan.view] as AskView;
  const where: Prisma.Sql[] = [Prisma.sql`company_id = ${companyId}`];
  if (onlyPersonId && plan.view !== 'people') where.push(Prisma.sql`person_id = ${onlyPersonId}`);
  // Inside the asker's branches (phase 12): group-wide rows, their branches' rows, and their own work.
  const reach = currentReach();
  if (reach?.branchIds && plan.view !== 'people') {
    const inBranches = reach.branchIds.length
      ? Prisma.sql`branch_id IN (${Prisma.join(reach.branchIds)})`
      : Prisma.sql`FALSE`;
    where.push(
      reach.strict
        ? Prisma.sql`(branch_id IS NULL OR ${inBranches})`
        : Prisma.sql`(branch_id IS NULL OR ${inBranches} OR person_id = ${reach.userId})`,
    );
  }
  for (const f of plan.filters)
    where.push(condition(f.column, view.columns[f.column]!.type, f.op, f.value, tz));
  const from = Prisma.raw(`ai_v_${plan.view}`);
  const limit = Math.max(1, Math.min(200, Math.round(plan.limit) || 50));
  const whereSql = Prisma.join(where, ' AND ');
  if (plan.aggregate) {
    const fn = Prisma.raw(plan.aggregate.fn.toUpperCase());
    const target =
      plan.aggregate.column && plan.aggregate.fn !== 'count' ? col(plan.aggregate.column) : Prisma.raw('*');
    const value = Prisma.sql`${fn}(${target})`;
    if (plan.groupBy) {
      const g = col(plan.groupBy);
      const dir = Prisma.raw(plan.orderBy?.dir === 'asc' ? 'ASC' : 'DESC');
      return {
        columns: [plan.groupBy, 'value'],
        sql: Prisma.sql`SELECT ${g} AS ${col(plan.groupBy)}, ${value} AS value FROM ${from} WHERE ${whereSql} GROUP BY ${g} ORDER BY value ${dir} NULLS LAST LIMIT ${limit}`,
      };
    }
    return { columns: ['value'], sql: Prisma.sql`SELECT ${value} AS value FROM ${from} WHERE ${whereSql}` };
  }
  const columns = (plan.columns.length ? plan.columns : view.defaults).filter((c) => c in view.columns);
  const order =
    plan.orderBy && plan.orderBy.column in view.columns
      ? Prisma.sql`ORDER BY ${col(plan.orderBy.column)} ${Prisma.raw(plan.orderBy.dir === 'asc' ? 'ASC' : 'DESC')} NULLS LAST`
      : Prisma.empty;
  return {
    columns,
    sql: Prisma.sql`SELECT ${Prisma.join(columns.map(col), ', ')}, link FROM ${from} WHERE ${whereSql} ${order} LIMIT ${limit}`,
  };
}

/** Read only, and never longer than 5 seconds. */
async function runReadOnly(db: Db, sql: Prisma.Sql) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '5s'");
    return tx.$queryRaw<Record<string, unknown>[]>(sql);
  });
}

const plain = (v: unknown) =>
  typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? Number(v) : v;

/**
 * Saved reports this person may open, described for the planner in a line each (what it is on, how it is grouped,
 * what it totals). People without the right to open reports are offered none.
 */
async function offeredReports(db: Db, actor: Actor): Promise<ASK.OfferedReport[]> {
  if (!can(actor, 'reports.view')) return [];
  const { reports } = await listReports(db, actor);
  return reports.slice(0, 40).map((r) => {
    const d = r.definition;
    const totals = d.measures.map((m) => (m.fn === 'count' ? 'count' : `${m.fn} of ${m.field}`)).join(', ');
    const group = d.groupBy
      ? `grouped by ${d.groupBy.field}${d.groupBy.bucket ? ` (${d.groupBy.bucket})` : ''}`
      : 'a list';
    return { id: r.id, name: r.name, about: `${group}${totals ? `; ${totals}` : ''}` };
  });
}

/**
 * "Ask" from the Home search: the AI plans, MONO checks and runs the lookup, the AI says it in a sentence.
 * People without `ai.admin` only see their own rows (and the people list).
 */
export async function askQuestion(db: Db, actor: Actor, appSecret: string, question: string) {
  if (!can(actor, 'ai.view'))
    throw new AppError(403, 'FORBIDDEN', "You can't ask questions about the company's data");
  const caller = { companyId: actor.companyId, userId: actor.userId, appSecret };
  const ctx = await companyContext(db, actor.companyId);
  const offered = await offeredReports(db, actor);
  const { data: plan } = await runAi(db, caller, 'ask', ASK.id, (llm) =>
    llm.json({
      system: ASK.system(ctx, offered),
      messages: [{ role: 'user', content: ASK.user(question) }],
      schema: askPlanSchema,
      effort: 'low',
      maxTokens: 4_000,
    }),
  );
  const empty = { columns: [] as string[], rows: [] as Record<string, unknown>[], total: 0 };
  if (!plan.answerable) return { answer: plan.why || "MONO's data can't answer that yet.", plan, ...empty };
  if (plan.report) {
    // Only a report that was offered — one this person may open — and it runs with their rights.
    if (!offered.some((r) => r.id === plan.report))
      return {
        answer: "I couldn't turn that into a safe lookup. Try asking it another way.",
        plan,
        problems: [`Unknown report "${plan.report}"`],
        ...empty,
      };
    const { name, result } = await runSaved(db, actor, plan.report, 200);
    const columns = result.columns.map((c) => c.label);
    const rows = result.rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] ?? null])));
    const { text } = await runAi(db, caller, 'ask_answer', ANSWER.id, (llm) =>
      llm.complete({
        system: ANSWER.system(ctx.now),
        messages: [{ role: 'user', content: ANSWER.user(question, rows.slice(0, 50), rows.length) }],
        effort: 'low',
        maxTokens: 2_000,
      }),
    );
    return {
      answer: text,
      plan,
      columns,
      rows,
      total: rows.length,
      report: { id: plan.report, name, link: `/reports/${plan.report}` },
    };
  }
  const problems = checkAskPlan(plan);
  if (problems.length)
    return {
      answer: "I couldn't turn that into a safe lookup. Try asking it another way.",
      plan,
      problems,
      ...empty,
    };
  const only = can(actor, 'ai.admin') ? null : actor.userId;
  const { columns, sql } = planSql(plan, actor.companyId, ctx.timezone, only);
  const rows = (await runReadOnly(db, sql)).map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, plain(v)])),
  );
  const { text } = await runAi(db, caller, 'ask_answer', ANSWER.id, (llm) =>
    llm.complete({
      system: ANSWER.system(ctx.now),
      messages: [
        {
          role: 'user',
          content: ANSWER.user(
            question,
            rows.slice(0, 50).map(({ link: _, ...r }) => r),
            rows.length,
          ),
        },
      ],
      effort: 'low',
      maxTokens: 2_000,
    }),
  );
  return { answer: text, plan, columns, rows, total: rows.length, onlyMine: Boolean(only) };
}
