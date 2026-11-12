import type { Db } from '@mono/db';
import {
  addDays,
  computePay,
  daysInMonth,
  localDate,
  payMonthSchema,
  minimumWageFor,
  payPolicyFor,
  weekdayOf,
  type AttendanceStatus,
  type PayBasis,
  type PayDay,
  type PayResult,
  type WorkPattern,
  splitExact,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { evaluateDay } from './attendance';
import { branchHistory } from '../branches/history';
import { currencyOfPeople, inrConverter } from '../branches/money';
import { companyCalendar, type CompanyCalendar } from './calendar';
import { hrPerson, hrRulesOf, personRules } from './people';
import { needHr, payRulesOf } from './terms';

export type PayLineOut = PayResult & {
  user: {
    id: string;
    code: string | null;
    name: string;
    department: string | null;
    designation: string | null;
  };
  ratePaise: number;
  pattern: WorkPattern;
  /** noRate: no pay set · noAttendance: no record this month · unsettled: days still being worked · unrecorded: some days have no record */
  warnings: string[];
  /**
   * The gross split over the branches the person worked at this month (phase 12): days employed at each, and
   * its share of the cost. One entry for someone who did not move.
   */
  byBranch?: { branchId: string | null; days: number; paise: number }[];
  /** The currency every amount of this line is in (phase 12): the person's legal entity's; INR when left out. */
  currency?: string;
};

/**
 * A month's gross pay for everyone with pay set (CLAUDE.md §9.2, gross only: PF/ESI/TDS are not here).
 * A closed month shows the figures as they were closed; an open one is worked out from attendance now.
 */
/** The key of a pay run: one legal entity, or "" for the whole company (as before entities). */
const runKey = (companyId: string, month: string, entityId?: string | null) => ({
  companyId_month_entityKey: { companyId, month, entityKey: entityId ?? '' },
});

/**
 * Payroll is worked out and closed for the whole company or, once it has legal entities, for one entity at a
 * time (phase 12). A month is one or the other: a company-wide close and entity closes never mix.
 */
export async function payrollMonth(
  db: Db,
  actor: Actor,
  month: string,
  now = new Date(),
  entityId?: string | null,
) {
  await needHr(db, actor);
  payMonthSchema.parse(month);
  const run = await db.payRun.findUnique({ where: runKey(actor.companyId, month, entityId) });
  if (run) {
    const by = run.closedById
      ? await db.user.findUnique({ where: { id: run.closedById }, select: { name: true } })
      : null;
    return {
      month,
      asOf: lastDay(month),
      closed: { at: run.closedAt, by: by?.name ?? null },
      lines: run.lines as unknown as PayLineOut[],
      totalPaise: Number(run.totalPaise),
      currency: await sheetCurrency(db, actor.companyId, entityId),
      missingRates: [] as string[],
    };
  }
  const live = await workOut(db, actor.companyId, month, now, entityId);
  return { month, ...live, closed: null };
}

const lastDay = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
};

async function workOut(db: Db, companyId: string, month: string, now: Date, entityId?: string | null) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = company.timezone;
  const first = `${month}-01`;
  const last = lastDay(month);
  const today = localDate(now, tz);
  if (first > today) throw new AppError(400, 'VALIDATION_FAILED', "This month hasn't started yet");
  // A running month counts up to yesterday: today is still being worked.
  const asOf = last < today ? last : addDays(today, -1);
  const dates: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);

  const records = await db.attendanceDay.findMany({ where: { companyId, date: { gte: first, lte: last } } });
  const [users, terms, leaves, rules, payRules] = await Promise.all([
    db.user.findMany({
      where: {
        companyId,
        deletedAt: null,
        // People who left this month are paid for the days they worked.
        OR: [{ status: { not: 'LEFT' } }, { id: { in: [...new Set(records.map((r) => r.userId))] } }],
        // One legal entity's payroll: the people whose branch belongs to it.
        ...(entityId ? { branch: { entityId } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        hr: true,
        createdAt: true,
        mainDepartment: { select: { name: true } },
        designation: { select: { name: true } },
      },
    }),
    db.employeeTerms.findMany({ where: { companyId } }),
    db.leaveRequest.findMany({
      where: { companyId, status: 'APPROVED', from: { lte: last }, to: { gte: first } },
      select: { userId: true, from: true, to: true, half: true, leaveTypeId: true },
    }),
    hrRulesOf(db, companyId),
    payRulesOf(db, companyId),
  ]);
  const paidType = new Map(
    (await db.leaveType.findMany({ where: { companyId }, select: { id: true, paid: true } })).map((t) => [
      t.id,
      t.paid,
    ]),
  );
  const termsOf = new Map(terms.map((t) => [t.userId, t]));
  const dayOf = new Map(records.map((r) => [`${r.userId}|${r.date}`, r]));
  const calendars = new Map<string | null, CompanyCalendar>();
  const calendarOf = async (branchId: string | null) => {
    if (!calendars.has(branchId)) calendars.set(branchId, await companyCalendar(db, companyId, branchId));
    return calendars.get(branchId)!;
  };

  const currencyOf = await currencyOfPeople(
    db,
    companyId,
    users.map((u) => u.id),
  );
  const history = await branchHistory(
    db,
    companyId,
    users.map((u) => u.id),
  );
  const lines: PayLineOut[] = [];
  for (const u of users) {
    const t = termsOf.get(u.id);
    const hr = (u.hr ?? {}) as { salary?: number; doj?: string };
    const basis = (t?.payBasis ?? 'monthly') as PayBasis;
    const ratePaise = t ? Number(t.rate) : Number(hr.salary ?? 0) * 100;
    if (!t && !ratePaise) continue;
    const p = await hrPerson(db, companyId, u.id);
    const cal = await calendarOf(p.branchId);
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(hr.doj ?? '') ? hr.doj! : localDate(u.createdAt, tz);
    const mine = leaves.filter((l) => l.userId === u.id);
    let unsettled = 0;
    let recorded = 0;
    const days: PayDay[] = [];
    for (const date of dates) {
      const kind = cal.holidays.has(date)
        ? 'holiday'
        : cal.workingWeekdays.has(weekdayOf(date))
          ? 'working'
          : 'weeklyOff';
      const leave = mine.find((l) => l.from <= date && l.to >= date);
      let rec: { status: string; workedMin: number; overtimeMin: number } | null =
        dayOf.get(`${u.id}|${date}`) ?? null;
      // The last two days may not be settled yet: work them out as they stand.
      if (!rec && date <= asOf && date >= addDays(asOf, -2) && date >= joined) {
        const live = await evaluateDay(db, companyId, p, date, now);
        // A day still being worked (today mid-shift) isn't counted yet.
        if (live.final)
          rec = { status: live.status, workedMin: live.workedMinutes, overtimeMin: live.overtimeMinutes };
        else unsettled++;
      }
      if (rec) recorded++;
      days.push({
        date,
        kind,
        status: (rec?.status ?? null) as AttendanceStatus | null,
        workedMin: rec?.workedMin ?? 0,
        overtimeMin: rec?.overtimeMin ?? 0,
        leave: leave ? { paid: paidType.get(leave.leaveTypeId) ?? true, half: Boolean(leave.half) } : null,
        employed: date >= joined,
      });
    }
    const dayHours = p.pattern.kind === 'daily' ? p.pattern.hours : personRules(rules, p).late.fullDayHours;
    const result = computePay({
      basis,
      ratePaise,
      days,
      asOf,
      policy: payPolicyFor(payRules, p),
      dayHours,
      pattern: p.pattern,
      weeklyHours: p.weeklyHours,
    });
    const warnings: string[] = [];
    if (!ratePaise) warnings.push('noRate');
    // Below the minimum wage typed for their entity (a month's pay only; day and hour rates are not compared).
    const floor = minimumWageFor(payRules, p);
    if (floor !== null && basis === 'monthly' && ratePaise > 0 && ratePaise < floor)
      warnings.push('belowMinimum');
    if (!recorded && !mine.length) warnings.push('noAttendance');
    // In a running month today is always still being worked; only an ended month warns.
    if (unsettled && asOf === last) warnings.push('unsettled');
    if (result.counts.unrecorded && recorded) warnings.push('unrecorded');
    lines.push({
      user: {
        id: u.id,
        code: u.code,
        name: u.name,
        department: u.mainDepartment?.name ?? null,
        designation: u.designation?.name ?? null,
      },
      ratePaise,
      pattern: p.pattern,
      warnings,
      ...result,
      currency: currencyOf.get(u.id) ?? 'INR',
      byBranch: splitByBranch(
        result.grossPaise,
        days.filter((d) => d.employed && d.date <= asOf).map((d) => history.on(u.id, d.date)),
      ),
    });
  }
  // One entity: the total is in its own currency. The whole company: in rupees, each line by the month's rate.
  const currency = await sheetCurrency(db, companyId, entityId);
  const inr = await inrConverter(db, companyId, month);
  const totalPaise = entityId
    ? lines.reduce((n, l) => n + l.grossPaise, 0)
    : lines.reduce((n, l) => n + inr.toInr(l.grossPaise, l.currency ?? 'INR'), 0);
  return { asOf, lines, totalPaise, currency, missingRates: [...inr.missing] };
}

/** The currency a pay sheet's total is in: the entity's own, or rupees for the whole company. */
async function sheetCurrency(db: Db, companyId: string, entityId?: string | null) {
  if (!entityId) return 'INR';
  const e = await db.legalEntity.findFirst({
    where: { id: entityId, companyId },
    select: { currency: true },
  });
  return e?.currency ?? 'INR';
}

/** A gross amount shared over branches by the days at each; the parts always add up to the gross. */
export function splitByBranch(grossPaise: number, branchOfEachDay: (string | null)[]) {
  const days = new Map<string | null, number>();
  for (const b of branchOfEachDay) days.set(b, (days.get(b) ?? 0) + 1);
  const at = [...days.entries()];
  if (!at.length) return [];
  const parts = splitExact(
    Math.max(0, Math.round(grossPaise)),
    at.map(([, n]) => n),
  );
  return at.map(([branchId, n], i) => ({ branchId, days: n, paise: parts[i]! }));
}

/** Close a month that has ended: its figures are kept as they are, whatever changes later. */
export async function closePayRun(
  db: Db,
  actor: Actor,
  month: string,
  now = new Date(),
  entityId?: string | null,
) {
  await needHr(db, actor);
  payMonthSchema.parse(month);
  const live = await workOut(db, actor.companyId, month, now, entityId);
  if (live.asOf !== lastDay(month))
    throw new AppError(400, 'VALIDATION_FAILED', 'A month can be closed once it has ended');
  if (live.lines.some((l) => l.warnings.includes('unsettled')))
    throw new AppError(409, 'CONFLICT', 'Some days are still being worked out. Try again in a few hours.');
  await db.$transaction(async (tx) => {
    const closed = await tx.payRun.findMany({ where: { companyId: actor.companyId, month } });
    if (closed.some((r) => r.entityKey === (entityId ?? '')))
      throw new AppError(409, 'CONFLICT', 'This month is already closed');
    // The whole company at once, or entity by entity — not both in one month.
    if (entityId ? closed.some((r) => r.entityKey === '') : closed.length)
      throw new AppError(
        409,
        'CONFLICT',
        entityId
          ? 'This month was closed for the whole company. Reopen it to close entity by entity.'
          : 'This month is being closed entity by entity. Close the remaining entities instead.',
      );
    const run = await tx.payRun.create({
      data: {
        companyId: actor.companyId,
        month,
        entityKey: entityId ?? '',
        lines: live.lines as object[],
        totalPaise: BigInt(live.totalPaise),
        closedById: actor.userId,
      },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'hr.pay_closed',
        entityType: 'pay_run',
        entityId: run.id,
        after: { month, entityId: entityId ?? null, people: live.lines.length, totalPaise: live.totalPaise },
      },
    );
  });
  return payrollMonth(db, actor, month, now, entityId);
}

/** Open a closed month again (to fix attendance or pay). The closed figures stay in the audit log. */
export async function reopenPayRun(
  db: Db,
  actor: Actor,
  month: string,
  reason: string,
  now = new Date(),
  entityId?: string | null,
) {
  await needHr(db, actor);
  payMonthSchema.parse(month);
  await db.$transaction(async (tx) => {
    const run = await tx.payRun.findUnique({ where: runKey(actor.companyId, month, entityId) });
    if (!run) throw new AppError(404, 'NOT_FOUND', 'This month is not closed');
    await tx.payRun.delete({ where: { id: run.id } });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'hr.pay_reopened',
        entityType: 'pay_run',
        entityId: run.id,
        before: { month, lines: run.lines, totalPaise: Number(run.totalPaise), closedAt: run.closedAt },
        after: { reason },
      },
    );
  });
  return payrollMonth(db, actor, month, now, entityId);
}
