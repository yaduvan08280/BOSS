import { addDays, localDate, weekdayOf, zonedToUtc } from '../work/calendar';
import type { StepTime } from './definition';

/** Working time for a company (CLAUDE.md §6.1 "Working shifts"): one shift, its weekdays, and holidays. */
export type WorkCalendar = {
  tz: string;
  /** Minutes from midnight; end < start means the shift runs past midnight (night shift). */
  shift: { start: number; end: number; weekdays: number[] };
  /** Local dates YYYY-MM-DD that are holidays. */
  holidays: Set<string>;
};

const MIN = 60_000;
export const shiftMinutes = (c: WorkCalendar) => (c.shift.end - c.shift.start + 1440) % 1440 || 1440;

/** The working window of the shift that starts on local date `d` (null on weekly offs and holidays). */
function windowOf(d: string, c: WorkCalendar): [number, number] | null {
  if (!c.shift.weekdays.includes(weekdayOf(d)) || c.holidays.has(d)) return null;
  const start = zonedToUtc(d, c.shift.start, c.tz).getTime();
  return [start, start + shiftMinutes(c) * MIN];
}

/** `from` plus N minutes of shift time, skipping nights, weekly offs and holidays. */
export function addWorkingMinutes(from: Date, minutes: number, c: WorkCalendar): Date {
  if (minutes <= 0) return from;
  let left = minutes * MIN;
  // Start a day early: a night shift that began yesterday may still be running.
  let d = addDays(localDate(from, c.tz), -1);
  for (let i = 0; i < 3700; i++, d = addDays(d, 1)) {
    const w = windowOf(d, c);
    if (!w) continue;
    const begin = Math.max(from.getTime(), w[0]);
    if (begin >= w[1]) continue;
    if (left <= w[1] - begin) return new Date(begin + left);
    left -= w[1] - begin;
  }
  throw new Error('No working time found in the next 10 years — check the shift and holidays');
}

/** The first working moment at or after `at` (for steps due "at 10:00" that land on a holiday). */
export function nextWorkingStart(at: Date, c: WorkCalendar): Date {
  let d = addDays(localDate(at, c.tz), -1);
  for (let i = 0; i < 3700; i++, d = addDays(d, 1)) {
    const w = windowOf(d, c);
    if (w && at.getTime() < w[1]) return new Date(Math.max(at.getTime(), w[0]));
  }
  return at;
}

export type PlanContext = {
  /** When the previous step finished (or the record started, for step 1). */
  previousDoneAt: Date;
  recordStartedAt: Date;
  /** Start form + earlier step data, for "before/after a date field". */
  data: Record<string, unknown>;
  calendar: WorkCalendar;
  timeModel: 'shifts' | 'calendar';
};

/** When a step is due, from its time rule (CLAUDE.md §6.3). */
export function plannedAt(time: StepTime | undefined, ctx: PlanContext): Date {
  if (!time) return ctx.previousDoneAt;
  const c = ctx.calendar;
  const perDay = ctx.timeModel === 'shifts' ? shiftMinutes(c) : 1440;
  const minutes = time.value * (time.unit === 'days' ? perDay : time.unit === 'hours' ? 60 : 1);
  const add = (base: Date, m: number) =>
    ctx.timeModel === 'shifts' ? addWorkingMinutes(base, m, c) : new Date(base.getTime() + m * MIN);

  switch (time.anchor) {
    case 'start':
      return add(ctx.recordStartedAt, minutes);
    case 'fixed': {
      const [h, m] = (time.at ?? '10:00').split(':').map(Number) as [number, number];
      let day = localDate(ctx.previousDoneAt, c.tz);
      for (let i = 0; i < 370; i++, day = addDays(day, 1)) {
        const at = zonedToUtc(day, h * 60 + m, c.tz);
        const working = ctx.timeModel === 'calendar' || windowOf(day, c) !== null;
        if (at > ctx.previousDoneAt && working) return at;
      }
      return add(ctx.previousDoneAt, minutes);
    }
    case 'dateField': {
      const raw = ctx.data[time.field ?? ''];
      if (typeof raw !== 'string' || !raw) return add(ctx.previousDoneAt, minutes);
      // A plain date means "that day, at the start of the shift".
      const base = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? zonedToUtc(raw, c.shift.start, c.tz) : new Date(raw);
      if (Number.isNaN(base.getTime())) return add(ctx.previousDoneAt, minutes);
      return time.before ? new Date(base.getTime() - minutes * MIN) : add(base, minutes);
    }
    default:
      return add(ctx.previousDoneAt, minutes);
  }
}
