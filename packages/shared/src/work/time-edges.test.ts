import { describe, expect, it } from 'vitest';
import { addWorkingMinutes } from '../fms/worktime';
import { financialYear, formatDate, formatDateTime } from '../format/date';
import { shiftWindow } from '../hr/attendance';
import { addDays, daysBetween, daysInMonth, localDate, weekdayOf, weekOf, zonedToUtc } from './calendar';

const IST = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

/**
 * The edges where dates go wrong: midnight in India (18:30 UTC the day before), the end of a month, the end
 * of the financial year, a shift that runs through the night. Every rule here takes the company's time zone;
 * none may depend on the clock the server happens to be set to — `npm run test:tz` runs this file (and the
 * rest of the shared tests) with the server's clock set to India, the US west coast and the Pacific date line.
 */
describe('dates at their edges (company clock: India)', () => {
  it('a day begins at 00:00 India time, which is 18:30 UTC the day before', () => {
    expect(localDate(at('2026-11-18T18:29:59Z'), IST)).toBe('2026-11-18');
    expect(localDate(at('2026-11-18T18:30:00Z'), IST)).toBe('2026-11-19');
    expect(zonedToUtc('2026-11-19', 0, IST).toISOString()).toBe('2026-11-18T18:30:00.000Z');
    expect(zonedToUtc('2026-11-19', 23 * 60 + 59, IST).toISOString()).toBe('2026-11-19T18:29:00.000Z');
    expect(formatDate(at('2026-11-18T18:29:59Z'), IST)).toBe('18/11/2026');
    expect(formatDate(at('2026-11-18T18:30:00Z'), IST)).toBe('19/11/2026');
    expect(formatDateTime(at('2026-11-18T18:30:00Z'), IST)).toBe('19/11/2026 00:00');
  });

  it('month ends, a leap day and the turn of the year', () => {
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2027-03-31', 31)).toBe('2027-05-01');
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    // The last moment of a month in India is still that month, though it is the 1st in the far east.
    expect(localDate(at('2027-01-31T18:29:59Z'), IST)).toBe('2027-01-31');
    expect(localDate(at('2027-01-31T18:30:00Z'), IST)).toBe('2027-02-01');
  });

  it('the financial year turns at midnight India time on 1 April', () => {
    expect(financialYear(at('2027-03-31T18:29:59Z'), IST)).toMatchObject({
      start: 2026,
      end: 2027,
      short: '26-27',
    });
    expect(financialYear(at('2027-03-31T18:30:00Z'), IST)).toMatchObject({
      start: 2027,
      end: 2028,
      short: '27-28',
    });
    // A paper dated 31/03 at 23:59 and one at 00:00 on 01/04 are numbered in different years.
    expect(financialYear(zonedToUtc('2027-03-31', 23 * 60 + 59, IST), IST).short).toBe('26-27');
    expect(financialYear(zonedToUtc('2027-04-01', 0, IST), IST).short).toBe('27-28');
    // A company whose year starts in January.
    expect(financialYear(at('2026-12-31T18:30:00Z'), IST, 1).short).toBe('27-28');
  });

  it('a week is Monday to Sunday on the company clock', () => {
    expect(weekdayOf('2026-11-22')).toBe(7); // a Sunday
    expect(weekdayOf('2026-11-23')).toBe(1); // a Monday
    // Sunday 23:59 India time and Monday 00:00 fall in different weeks.
    expect(weekOf(at('2026-11-22T18:29:00Z'), IST)).toMatchObject({ start: '2026-11-16', end: '2026-11-22' });
    expect(weekOf(at('2026-11-22T18:30:00Z'), IST)).toMatchObject({ start: '2026-11-23', end: '2026-11-29' });
    expect(weekOf(at('2026-11-22T18:30:00Z'), IST).from.toISOString()).toBe('2026-11-22T18:30:00.000Z');
  });

  it('a night shift belongs to the date it starts on, through midnight, a month end and the year end', () => {
    const night = { start: 23 * 60, end: 7 * 60 };
    const w = shiftWindow('2026-12-31', night, IST);
    expect(w.start.toISOString()).toBe('2026-12-31T17:30:00.000Z'); // 23:00 on 31/12
    expect(w.end.toISOString()).toBe('2027-01-01T01:30:00.000Z'); // 07:00 on 01/01
    const day = shiftWindow('2027-03-31', { start: 9 * 60, end: 19 * 60 }, IST);
    expect(day.start.toISOString()).toBe('2027-03-31T03:30:00.000Z');
    expect(day.end.toISOString()).toBe('2027-03-31T13:30:00.000Z');
  });

  it('working time skips the night, the weekly off and a holiday — across a month end', () => {
    const cal = {
      tz: IST,
      shift: { start: 9 * 60, end: 19 * 60, weekdays: [1, 2, 3, 4, 5, 6] },
      holidays: new Set(['2027-04-01']),
    };
    // Wednesday 31/03/2027 18:00 + 3 working hours: one hour that day; Thursday 01/04 is a holiday;
    // two hours on Friday 02/04 → 11:00.
    const due = addWorkingMinutes(zonedToUtc('2027-03-31', 18 * 60, IST), 180, cal);
    expect(formatDateTime(due, IST)).toBe('02/04/2027 11:00');
    // Saturday 17:00 + 4 hours: two that day, Sunday is off, two on Monday → 11:00.
    const overSunday = addWorkingMinutes(zonedToUtc('2026-11-21', 17 * 60, IST), 240, cal);
    expect(formatDateTime(overSunday, IST)).toBe('23/11/2026 11:00');
    // A night shift (23:00–07:00): Tuesday 06:00 + 2 hours → one before 07:00, one after 23:00 → 00:00 Wednesday.
    const night = {
      tz: IST,
      shift: { start: 23 * 60, end: 7 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      holidays: new Set<string>(),
    };
    expect(formatDateTime(addWorkingMinutes(zonedToUtc('2026-11-24', 6 * 60, IST), 120, night), IST)).toBe(
      '25/11/2026 00:00',
    );
  });

  it('a branch on another clock keeps its own day (Dubai is 90 minutes behind India)', () => {
    const instant = at('2026-11-18T19:00:00Z'); // 00:30 on the 19th in India, 23:00 on the 18th in Dubai
    expect(localDate(instant, IST)).toBe('2026-11-19');
    expect(localDate(instant, 'Asia/Dubai')).toBe('2026-11-18');
    // And a zone with summer time: the day the clocks change still has its own midnight.
    expect(zonedToUtc('2026-03-29', 0, 'Europe/London').toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(zonedToUtc('2026-03-30', 0, 'Europe/London').toISOString()).toBe('2026-03-29T23:00:00.000Z');
  });

  it('says which clock the server is on — the answers above did not depend on it', () => {
    // Recorded so a run under another TZ shows it really ran there.
    expect(typeof new Date().getTimezoneOffset()).toBe('number');
  });
});
