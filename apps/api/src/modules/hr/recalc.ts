import type { Db } from '@mono/db';
import { writeAudit } from '../../lib/audit';
import { AppError, forbidden } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { hrRulesSchema, localDate, withChangeFrom, type HrRules } from '@mono/shared';
import { evaluateDay, settleDay } from './attendance';
import { hrPerson, hrRulesOf, isHr } from './people';

/**
 * Work a month's settled days out again with the rules as they stand now (after HR changes a rule, or after
 * MONO's own rule is corrected). Only days that already have a record are touched; a month whose pay is closed
 * is refused — reopen the pay run first. HR only.
 */
export async function recalcMonth(db: Db, actor: Actor, month: string) {
  if (!(await isHr(db, actor))) throw forbidden('Only HR recalculates attendance');
  if (await db.payRun.count({ where: { companyId: actor.companyId, month } }))
    throw new AppError(409, 'CONFLICT', 'The pay for this month is closed. Reopen it in Payroll first.');
  const rows = await db.attendanceDay.findMany({
    where: { companyId: actor.companyId, date: { gte: `${month}-01`, lte: `${month}-31` } },
    select: { userId: true, date: true, status: true },
    orderBy: [{ userId: 'asc' }, { date: 'asc' }],
  });
  const people = new Map<string, Awaited<ReturnType<typeof hrPerson>>>();
  let changed = 0;
  for (const row of rows) {
    if (!people.has(row.userId)) {
      const exists = await db.user.count({
        where: { id: row.userId, companyId: actor.companyId, deletedAt: null },
      });
      if (!exists) continue;
      people.set(row.userId, await hrPerson(db, actor.companyId, row.userId));
    }
    const p = people.get(row.userId);
    if (!p) continue;
    const r = await settleDay(db, actor.companyId, p, row.date);
    if (r.saved && r.result.status !== row.status) changed += 1;
  }
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      action: 'attendance.recalculated',
      entityType: 'attendance',
      entityId: month,
      after: { days: rows.length, changed },
    },
  );
  return { days: rows.length, changed };
}

type Row = { userId: string; date: string; status: string };

/** Recorded days from a date on, left out for months whose pay is closed (named in `closedMonths`). */
async function recordedFrom(db: Db, companyId: string, from: string) {
  const closed = new Set(
    (
      await db.payRun.findMany({
        where: { companyId, month: { gte: from.slice(0, 7) } },
        select: { month: true },
      })
    ).map((r) => r.month),
  );
  const rows: Row[] = await db.attendanceDay.findMany({
    where: { companyId, date: { gte: from } },
    select: { userId: true, date: true, status: true },
    orderBy: [{ userId: 'asc' }, { date: 'asc' }],
    take: 20_000,
  });
  return {
    rows: rows.filter((r) => !closed.has(r.date.slice(0, 7))),
    closedMonths: [...closed].filter((m) => rows.some((r) => r.date.startsWith(m))).sort(),
  };
}

async function peopleOf(db: Db, companyId: string, rows: Row[]) {
  const people = new Map<string, Awaited<ReturnType<typeof hrPerson>>>();
  const live = await db.user.findMany({
    where: { companyId, deletedAt: null, id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true },
  });
  for (const u of live) people.set(u.id, await hrPerson(db, companyId, u.id));
  return people;
}

/**
 * What a rule change would do to the days already recorded from `from`: how many days and people would get
 * another status, with a few examples. Nothing is saved.
 */
export async function previewRules(db: Db, actor: Actor, input: unknown, from?: string) {
  if (!(await isHr(db, actor))) throw forbidden('Only HR changes the rules');
  const next: HrRules = hrRulesSchema.parse(input);
  const current = await hrRulesOf(db, actor.companyId);
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const start = from ?? localDate(new Date(), company.timezone);
  const candidate = withChangeFrom(current, { ...next, past: current.past }, start);
  const { rows, closedMonths } = await recordedFrom(db, actor.companyId, start);
  const people = await peopleOf(db, actor.companyId, rows);
  const names = new Map(
    (
      await db.user.findMany({
        where: { companyId: actor.companyId, id: { in: [...people.keys()] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const changes: { name: string; date: string; from: string; to: string }[] = [];
  const who = new Set<string>();
  for (const row of rows) {
    const p = people.get(row.userId);
    if (!p) continue;
    const r = await evaluateDay(db, actor.companyId, p, row.date, new Date(), candidate);
    if (r.final && r.status !== row.status) {
      who.add(row.userId);
      changes.push({ name: names.get(row.userId) ?? '', date: row.date, from: row.status, to: r.status });
    }
  }
  return {
    from: start,
    days: rows.length,
    changed: changes.length,
    people: who.size,
    examples: changes.slice(0, 8),
    closedMonths,
  };
}

/** Work the recorded days from a date out again (after a rule change that reaches into the past). */
export async function recalcFrom(db: Db, actor: Actor, from: string) {
  const { rows, closedMonths } = await recordedFrom(db, actor.companyId, from);
  const people = await peopleOf(db, actor.companyId, rows);
  let changed = 0;
  for (const row of rows) {
    const p = people.get(row.userId);
    if (!p) continue;
    const r = await settleDay(db, actor.companyId, p, row.date);
    if (r.saved && r.result.status !== row.status) changed += 1;
  }
  return { days: rows.length, changed, closedMonths };
}
