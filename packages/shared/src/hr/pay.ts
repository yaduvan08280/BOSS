import { z } from 'zod';
import { weekdayOf } from '../work/calendar';
import type { AttendanceStatus, WorkPattern } from './attendance';
import { overrideOf } from './rules';

/**
 * Pay from attendance (gross only). PF, ESI, TDS and other statutory deductions are not here:
 * they come with payroll proper, confirmed by the company's accountant (CLAUDE.md §9.2).
 */
export const PAY_BASES = ['monthly', 'daily', 'hourly'] as const;
export type PayBasis = (typeof PAY_BASES)[number];

const payRulesShape = {
  /** A monthly salary's day value: all days of the month (Sundays and holidays paid), working days only, or a fixed number. */
  monthDays: z.enum(['calendar', 'working', 'fixed']).default('calendar'),
  fixedDays: z.number().int().min(20).max(31).default(26),
  /** Weekly offs and holidays are paid days. */
  paidOffDays: z.boolean().default(true),
  /** Working on a weekly off or holiday: a comp-off (the default), extra pay (a multiple of a day's pay, or a fixed amount), or nothing. */
  dayOffWork: z.enum(['multiplier', 'fixed', 'compOff', 'none']).default('compOff'),
  dayOffMultiplier: z.number().min(0).max(5).default(1),
  dayOffFixedPaise: z.number().int().min(0).default(0),
  /** Overtime pay at this multiple of the hourly rate (the Factories Act asks for twice the ordinary rate). */
  overtimePay: z.boolean().default(true),
  overtimeMultiplier: z.number().min(0).max(5).default(2),
  /** Every N late days cut this many days of pay (0 = off). */
  lateEvery: z.number().int().min(0).max(31).default(0),
  lateCutDays: z.number().min(0).max(5).default(0.5),
  /** Weekly hours: hours short of the week's target are cut from pay. */
  weeklyShortfall: z.enum(['deduct', 'ignore']).default('deduct'),
};
export const payPolicySchema = z.object(payRulesShape);
export type PayPolicy = z.infer<typeof payPolicySchema>;

export const payRulesSchema = payPolicySchema.extend({
  /** Different for a department, a designation or one person (person > designation > department). */
  overrides: z
    .array(
      z.object({
        // Phase 12: a legal entity may differ too (a state's or a country's rules).
        scope: z.enum(['entity', 'department', 'designation', 'person']),
        id: z.string(),
        rules: overrideOf(payPolicySchema).default({}),
      }),
    )
    .max(200)
    .default([]),
  /**
   * Minimum wages as data the accountant types (phase 12): a monthly amount for an entity (a state's table),
   * for everyone there or for one designation. Pay below it is flagged on the payroll — nothing is hard-coded.
   */
  minimumWages: z
    .array(
      z.object({
        entityId: z.string().nullable(),
        designationId: z.string().nullable(),
        monthlyPaise: z.number().int().min(0),
      }),
    )
    .max(300)
    .default([]),
});
export type PayRules = z.infer<typeof payRulesSchema>;

/** The minimum monthly wage that applies to someone: their designation's at their entity, else the entity's, else the company's. */
export function minimumWageFor(
  rules: PayRules,
  p: { entityId?: string | null; designationId: string | null },
): number | null {
  const rows = rules.minimumWages;
  const pick = (entityId: string | null, designationId: string | null) =>
    rows.find((r) => r.entityId === entityId && r.designationId === designationId)?.monthlyPaise;
  const e = p.entityId ?? null;
  return (
    (p.designationId ? pick(e, p.designationId) : undefined) ??
    pick(e, null) ??
    (p.designationId ? pick(null, p.designationId) : undefined) ??
    pick(null, null) ??
    null
  );
}
export const DEFAULT_PAY_RULES: PayRules = payRulesSchema.parse({});

export function payPolicyFor(
  rules: PayRules,
  p: { id: string; departmentId: string | null; designationId: string | null; entityId?: string | null },
): PayPolicy {
  const find = (scope: string, id: string | null) =>
    rules.overrides.find((o) => o.scope === scope && o.id === id)?.rules;
  const { overrides: _, minimumWages: __, ...base } = rules;
  return {
    ...base,
    ...find('entity', p.entityId ?? null),
    ...find('department', p.departmentId),
    ...find('designation', p.designationId),
    ...find('person', p.id),
  };
}

export type PayDay = {
  date: string;
  kind: 'working' | 'holiday' | 'weeklyOff';
  /** What the day counted as; null when there is no record (not settled yet, or before MONO was used). */
  status: AttendanceStatus | null;
  workedMin: number;
  overtimeMin: number;
  /** Approved leave on the day: paid or not (LWP), whole or half. */
  leave: { paid: boolean; half: boolean } | null;
  /** False before the person joined (never paid). */
  employed?: boolean;
};

export type PayLine = { key: string; qty: number; ratePaise: number; amountPaise: number };
export type PayResult = {
  basis: PayBasis;
  divisor: number | null;
  perDayPaise: number;
  hourlyPaise: number;
  counts: {
    days: number;
    notJoined: number;
    workingDays: number;
    present: number;
    halfDays: number;
    absent: number;
    paidLeave: number;
    unpaidLeave: number;
    offDays: number;
    offDaysWorked: number;
    late: number;
    /** Working days with no attendance record (MONO not in use yet): a salary isn't cut, a wage isn't paid. */
    unrecorded: number;
    workedHours: number;
    overtimeHours: number;
  };
  lines: PayLine[];
  grossPaise: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A month's gross pay for one person from their days. Days after `asOf` are not counted (a running month
 * shows pay so far: a monthly salary isn't cut for days still to come).
 */
export function computePay(input: {
  basis: PayBasis;
  ratePaise: number;
  days: PayDay[];
  asOf: string;
  policy: PayPolicy;
  /** Hours in a full day: the pattern's daily hours, else the HR rules' full day. */
  dayHours: number;
  pattern: WorkPattern;
  weeklyHours?: number | null;
}): PayResult {
  const { policy: pol, ratePaise: rate, dayHours } = input;
  const all = input.days;
  const notJoined = all.filter((d) => d.employed === false && d.date <= input.asOf).length;
  const days = all.filter((d) => d.date <= input.asOf && d.employed !== false);
  const working = all.filter((d) => d.kind === 'working');
  const divisor =
    input.basis !== 'monthly'
      ? null
      : pol.monthDays === 'calendar'
        ? all.length
        : pol.monthDays === 'working'
          ? Math.max(1, working.length)
          : pol.fixedDays;
  const perDay =
    input.basis === 'monthly' ? rate / divisor! : input.basis === 'daily' ? rate : rate * dayHours;
  const hourly = input.basis === 'hourly' ? rate : perDay / dayHours;
  const weekly = input.pattern.kind === 'weekly';

  // How much of each working day is paid: work done plus paid leave (weekly hours: days don't cut pay, hours do).
  const c = {
    present: 0,
    halfDays: 0,
    absent: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    offDaysWorked: 0,
    late: 0,
    unrecorded: 0,
  };
  let paidWorking = 0;
  let unpaidWorking = 0;
  let workedMin = 0;
  let otMin = 0;
  let offUnits = 0;
  let offWorkedMin = 0;
  for (const d of days) {
    workedMin += d.workedMin;
    otMin += d.overtimeMin;
    if (d.kind !== 'working') {
      if (d.workedMin >= (dayHours * 60) / 2) {
        offUnits += d.workedMin >= dayHours * 60 ? 1 : 0.5;
        offWorkedMin += d.workedMin;
        c.offDaysWorked++;
      }
      continue;
    }
    const leave = d.leave;
    // No record of the day: no proof either way. A salary carries on; day and hour pay need the work.
    if (d.status === null && !leave) {
      c.unrecorded++;
      if (input.basis === 'monthly') paidWorking++;
      continue;
    }
    const leavePart = leave ? (leave.half ? 0.5 : 1) : 0;
    if (leave?.paid) c.paidLeave += leavePart;
    else if (leave) c.unpaidLeave += leavePart;
    const workPart =
      leavePart === 1
        ? 0
        : weekly
          ? 1 - leavePart
          : d.status === 'PRESENT' || d.status === 'LATE'
            ? 1 - leavePart
            : d.status === 'HALF_DAY'
              ? Math.min(0.5, 1 - leavePart)
              : 0;
    if (d.status === 'LATE') c.late++;
    if (!leave && (d.status === 'PRESENT' || d.status === 'LATE')) c.present++;
    if (d.status === 'HALF_DAY') c.halfDays++;
    if (!leave && d.status === 'ABSENT' && !weekly) c.absent++;
    const paid = workPart + (leave?.paid ? leavePart : 0);
    paidWorking += paid;
    unpaidWorking += 1 - paid;
  }
  const offDays = days.filter((d) => d.kind !== 'working').length;
  const lines: PayLine[] = [];
  const add = (key: string, qty: number, ratePaise: number, amount?: number) => {
    const amountPaise = Math.round(amount ?? qty * ratePaise);
    if (amountPaise !== 0 || key === 'base')
      lines.push({ key, qty: r2(qty), ratePaise: Math.round(ratePaise), amountPaise });
  };

  if (input.basis === 'monthly') {
    // The salary, less the days not paid.
    add('base', 1, rate);
    add('unpaidDays', -unpaidWorking, perDay);
    add('notJoined', -notJoined, perDay);
    if (pol.monthDays === 'calendar' && !pol.paidOffDays) add('unpaidOffDays', -offDays, perDay);
  } else if (input.basis === 'daily') {
    add('paidDays', paidWorking, perDay);
    if (pol.paidOffDays) add('paidOffDays', offDays, perDay);
  } else {
    // Hours worked on working days (day-off hours are paid below), plus paid leave at a full day's hours.
    const hours = (workedMin - offWorkedMin) / 60;
    add('hours', hours, rate);
    add('paidLeave', c.paidLeave, rate * dayHours);
    if (pol.paidOffDays) add('paidOffDays', offDays, rate * dayHours);
  }

  if (offUnits && pol.dayOffWork === 'multiplier') {
    if (input.basis === 'hourly')
      add('dayOffWork', offWorkedMin / 60, rate * Math.max(1, pol.dayOffMultiplier));
    else add('dayOffWork', offUnits, perDay * pol.dayOffMultiplier);
  }
  if (offUnits && pol.dayOffWork === 'fixed') add('dayOffWork', offUnits, pol.dayOffFixedPaise);

  if (pol.lateEvery > 0 && c.late >= pol.lateEvery) {
    const cut = Math.floor(c.late / pol.lateEvery) * pol.lateCutDays;
    add('lateCut', -cut, perDay);
  }

  // Weekly hours: each Monday–Sunday week (its part in this month, up to asOf) against its share of the target.
  let weeklyOt = 0;
  if (weekly && input.weeklyHours) {
    const weeks = new Map<number, PayDay[]>();
    let w = 0;
    for (const d of days) {
      if (weekdayOf(d.date) === 1 && weeks.size) w++;
      weeks.set(w, [...(weeks.get(w) ?? []), d]);
    }
    let short = 0;
    for (const list of weeks.values()) {
      const work = list.filter((d) => d.kind === 'working' && (d.status !== null || d.leave));
      const perWorkday = input.weeklyHours / 6;
      const leaveDays = work.reduce((n, d) => n + (d.leave ? (d.leave.half ? 0.5 : 1) : 0), 0);
      const target = Math.max(0, (work.length - leaveDays) * perWorkday) * 60;
      const done = list.reduce((n, d) => n + d.workedMin, 0);
      if (done < target) short += target - done;
      else weeklyOt += done - target;
    }
    if (short && pol.weeklyShortfall === 'deduct') add('shortHours', -short / 60, hourly);
  }

  const overtime = weekly ? weeklyOt : otMin;
  if (overtime && pol.overtimePay) {
    // Hourly pay already counts the hours; overtime adds the premium on top.
    if (input.basis === 'hourly')
      add('overtime', overtime / 60, rate * Math.max(0, pol.overtimeMultiplier - 1));
    else add('overtime', overtime / 60, hourly * pol.overtimeMultiplier);
  }

  const gross = Math.max(
    0,
    lines.reduce((n, l) => n + l.amountPaise, 0),
  );
  return {
    basis: input.basis,
    divisor,
    perDayPaise: Math.round(perDay),
    hourlyPaise: Math.round(hourly),
    counts: {
      days: days.length,
      notJoined,
      workingDays: days.filter((d) => d.kind === 'working').length,
      ...c,
      offDays,
      workedHours: r2(workedMin / 60),
      overtimeHours: r2(overtime / 60),
    },
    lines,
    grossPaise: gross,
  };
}

/** How one person works and is paid (HR only: it holds their pay). */
export const employeeTermsSchema = z
  .object({
    pattern: z.enum(['shift', 'daily', 'weekly']).default('shift'),
    dailyHours: z.number().min(1).max(16).nullish(),
    weeklyHours: z.number().min(1).max(96).nullish(),
    /** Daily / weekly hours: in by this time (minutes from midnight) or absent; empty = no absence alert. */
    latestStartMin: z.number().int().min(0).max(1439).nullish(),
    payBasis: z.enum(PAY_BASES).default('monthly'),
    /** Paise per month, day or hour (by the pay basis). */
    ratePaise: z.number().int().min(0).max(100_000_000_00),
  })
  .refine((t) => t.pattern !== 'daily' || t.dailyHours, {
    path: ['dailyHours'],
    message: 'How many hours a day?',
  })
  .refine((t) => t.pattern !== 'weekly' || t.weeklyHours, {
    path: ['weeklyHours'],
    message: 'How many hours a week?',
  });
export type EmployeeTerms = z.infer<typeof employeeTermsSchema>;

/** Leave a designation or one person gets in a year, instead of the leave type's own number. */
export const leaveQuotasSchema = z.object({
  quotas: z
    .array(
      z.object({
        scope: z.enum(['designation', 'person']),
        refId: z.string().min(1),
        yearlyQuota: z.number().min(0).max(365).multipleOf(0.5),
      }),
    )
    .max(500),
});

/** The month a pay run is for: YYYY-MM. */
export const payMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
