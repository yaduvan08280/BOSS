import { z } from 'zod';
import { addDays, weekdayOf } from '../work/calendar';
import type { BuddySource, HrRules } from './rules';

export type LeaveCalendar = { holidays: Set<string>; workingWeekdays: Set<number> };

/** Working days a leave takes (holidays and weekly offs are not counted); a half day is 0.5. */
export function leaveDays(from: string, to: string, half: boolean, cal: LeaveCalendar): number {
  if (half) return from === to && isWorkingDay(from, cal) ? 0.5 : 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(d, cal)) n++;
  return n;
}

export const isWorkingDay = (date: string, cal: LeaveCalendar) =>
  !cal.holidays.has(date) && cal.workingWeekdays.has(weekdayOf(date));

/** §9.1 step 4: does this leave need a Buddy for the person's open work? */
export function needsBuddy(rules: HrRules['buddy'], leave: { days: number; half: boolean }): boolean {
  if (rules.noBuddy === 'off') return false;
  if (rules.needsBuddy === 'fullDay') return !leave.half;
  if (rules.needsBuddy === 'days') return leave.days >= rules.needsBuddyDays;
  return true;
}

export type BuddyCandidates = {
  /** FMS: the step's backup doers */
  fmsBackup: string[];
  defaultBuddy: string | null;
  /** People of the same department, least busy first */
  sameDepartment: string[];
  hod: string | null;
};

/**
 * §9.1 step 5: who to ask, in the company's order — the step's backup, their default Buddy, a free person of
 * the same department, their HOD. People who are away, already cover the most they may, or are the person
 * themselves are left out.
 */
export function suggestBuddies(
  order: readonly BuddySource[],
  c: BuddyCandidates,
  skip: Set<string>,
): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !skip.has(id) && !out.includes(id)) out.push(id);
  };
  for (const source of order) {
    if (source === 'fmsBackup') c.fmsBackup.forEach(add);
    if (source === 'defaultBuddy') add(c.defaultBuddy);
    if (source === 'sameDepartment') c.sameDepartment.forEach(add);
    if (source === 'hod') add(c.hod);
  }
  return out;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
export const leaveRequestSchema = z
  .object({
    leaveTypeId: z.string().min(1, 'Pick the kind of leave'),
    from: date,
    to: date,
    half: z.enum(['FIRST', 'SECOND']).nullish(),
    reason: z.string().trim().min(3, 'Say why').max(500),
    /** Who covers each piece of open work: `${entityType}:${entityId}` → person id */
    buddies: z.record(z.string(), z.string()).default({}),
  })
  .refine((l) => l.to >= l.from, { message: 'The last day is before the first', path: ['to'] })
  .refine((l) => !l.half || l.from === l.to, { message: 'A half day is one day', path: ['half'] });
export type LeaveRequestInput = z.infer<typeof leaveRequestSchema>;

export const leaveTypeSchema = z.object({
  code: z.string().trim().min(1).max(10).toUpperCase(),
  name: z.string().trim().min(2).max(60),
  yearlyQuota: z.number().min(0).max(365),
  carryForward: z.number().min(0).max(365).default(0),
  paid: z.boolean().default(true),
  active: z.boolean().default(true),
});

/** Built-in leave types (configurable): CL, SL, EL, Comp-off, LWP. */
export const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', yearlyQuota: 8, carryForward: 0, paid: true },
  { code: 'SL', name: 'Sick leave', yearlyQuota: 7, carryForward: 0, paid: true },
  { code: 'EL', name: 'Earned leave', yearlyQuota: 15, carryForward: 30, paid: true },
  { code: 'CO', name: 'Comp-off', yearlyQuota: 0, carryForward: 0, paid: true },
  { code: 'LWP', name: 'Leave without pay', yearlyQuota: 365, carryForward: 0, paid: false },
] as const;

/** The leave year that contains a date: starts in January or April (§9.1 step 3). */
export function leaveYearOf(dateStr: string, startMonth: 1 | 4): number {
  const [y, m] = dateStr.split('-').map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}
