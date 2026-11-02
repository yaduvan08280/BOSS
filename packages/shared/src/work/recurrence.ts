import { z } from 'zod';
import { addDays, daysBetween, daysInMonth, localDate, weekdayOf, zonedToUtc } from './calendar';

const day = z.union([z.number().int().min(1).max(31), z.literal('last')]);

export const frequencySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('daily') }),
  z.object({ type: z.literal('weekdays'), weekdays: z.array(z.number().int().min(1).max(7)).min(1) }),
  z.object({ type: z.literal('weekly'), weekday: z.number().int().min(1).max(7) }),
  z.object({ type: z.literal('monthly'), day }),
  z.object({ type: z.literal('quarterly'), day }),
  z.object({
    type: z.literal('yearly'),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  z.object({ type: z.literal('everyN'), everyN: z.number().int().min(2).max(365) }),
]);
export type Frequency = z.infer<typeof frequencySchema>;

function dayMatches(date: string, want: number | 'last') {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const last = daysInMonth(y, m);
  // "31st" in a 30-day month means the last day.
  return want === 'last' ? d === last : d === Math.min(want, last);
}

/** Does the schedule fall on this local date (ignoring holidays)? */
export function occursOn(freq: Frequency, date: string, startDate: string): boolean {
  if (date < startDate) return false;
  switch (freq.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return freq.weekdays.includes(weekdayOf(date));
    case 'weekly':
      return weekdayOf(date) === freq.weekday;
    case 'monthly':
      return dayMatches(date, freq.day);
    case 'quarterly': {
      const month = Number(date.slice(5, 7));
      const startMonth = Number(startDate.slice(5, 7));
      return (month - startMonth + 12) % 3 === 0 && dayMatches(date, freq.day);
    }
    case 'yearly':
      return Number(date.slice(5, 7)) === freq.month && dayMatches(date, freq.day);
    case 'everyN':
      return daysBetween(startDate, date) % freq.everyN === 0;
  }
}

export type RecurrenceCalendar = {
  tz: string;
  /** Local dates that are holidays. */
  holidays: Set<string>;
  /** Working weekdays (1–7) from the default shift; others are weekly offs. */
  workingWeekdays: Set<number>;
};

/** Due instants of a checklist master between two instants, skipping holidays/weekly offs if asked. */
export function occurrences(
  master: { frequency: Frequency; dueMin: number; startDate: string; skipHolidays: boolean },
  from: Date,
  to: Date,
  cal: RecurrenceCalendar,
): Date[] {
  const out: Date[] = [];
  const last = localDate(to, cal.tz);
  for (let date = localDate(from, cal.tz); date <= last; date = addDays(date, 1)) {
    if (!occursOn(master.frequency, date, master.startDate)) continue;
    if (master.skipHolidays && (cal.holidays.has(date) || !cal.workingWeekdays.has(weekdayOf(date))))
      continue;
    const at = zonedToUtc(date, master.dueMin, cal.tz);
    if (at >= from && at <= to) out.push(at);
  }
  return out;
}
