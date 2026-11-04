import { addDays, zonedToUtc } from '../work/calendar';
import type { LateRules, PunchRules } from './rules';

/** CLAUDE.md §9.2 — what a day counts as. */
export const ATTENDANCE_STATUSES = [
  'PRESENT',
  'LATE',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKLY_OFF',
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type DayKind = 'working' | 'holiday' | 'weeklyOff';
export type PunchIn = { type: 'IN' | 'OUT'; at: Date };

export type DayInput = {
  /** The date the shift starts on (a night shift counts on its start date, decision 17). */
  date: string;
  kind: DayKind;
  /** Approved leave on this day: the whole day, or half of it. */
  leave: 'full' | 'half' | null;
  shift: { start: number; end: number };
  punches: PunchIn[];
  tz: string;
  rules: { late: LateRules; punches: PunchRules };
};

export type DayResult = {
  status: AttendanceStatus;
  inAt: Date | null;
  outAt: Date | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  /** Punched in but never out. */
  missedOut: boolean;
  /** Worked at least half a day on a holiday or weekly off: earns a comp-off. */
  compOff: boolean;
  /** Plain words for the person and HR: why the day counts as it does. */
  reasons: string[];
};

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/** The shift as instants on its date; a night shift (end before start) ends the next morning. */
export function shiftWindow(date: string, shift: { start: number; end: number }, tz: string) {
  const start = zonedToUtc(date, shift.start, tz);
  const end =
    shift.end > shift.start ? zonedToUtc(date, shift.end, tz) : zonedToUtc(addDays(date, 1), shift.end, tz);
  return { start, end };
}

/**
 * One person's day from their punches and the HR rules (§9.1 step 1–2):
 * - more than the grace late → Late; later than "half day after" → Half day;
 * - fewer hours than a full day → Half day (at least half of it) or Absent;
 * - no punch-out → Half day until a correction, or out at shift end (rule);
 * - overtime counts once past shift end by the threshold;
 * - work on a holiday or weekly off earns a comp-off.
 */
export function computeDay(d: DayInput): DayResult {
  const { start, end } = shiftWindow(d.date, d.shift, d.tz);
  const sorted = [...d.punches].sort((a, b) => a.at.getTime() - b.at.getTime());
  const firstIn = sorted.find((p) => p.type === 'IN')?.at ?? null;
  const lastOut = firstIn
    ? ([...sorted].reverse().find((p) => p.type === 'OUT' && p.at > firstIn)?.at ?? null)
    : null;
  const fullDay = d.rules.late.fullDayHours * 60;
  const base: DayResult = {
    status: 'ABSENT',
    inAt: firstIn,
    outAt: lastOut,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
    missedOut: Boolean(firstIn && !lastOut),
    compOff: false,
    reasons: [],
  };
  if (d.leave === 'full') return { ...base, status: 'ON_LEAVE', reasons: ['On leave'] };

  const missedOut = Boolean(firstIn && !lastOut);
  const outAt = lastOut ?? (missedOut && d.rules.late.missedPunchOut === 'shiftEnd' ? end : null);
  const worked = firstIn && outAt ? Math.max(0, minutes(firstIn, outAt)) : 0;

  if (d.kind !== 'working') {
    const status = d.kind === 'holiday' ? 'HOLIDAY' : 'WEEKLY_OFF';
    const compOff = worked >= fullDay / 2;
    return {
      ...base,
      status,
      outAt,
      workedMinutes: worked,
      compOff,
      reasons: compOff ? [`Worked ${Math.round(worked / 6) / 10} h on a day off: comp-off earned`] : [],
    };
  }

  if (!firstIn)
    return d.leave === 'half'
      ? { ...base, status: 'ABSENT', reasons: ['Half-day leave, no punch for the other half'] }
      : { ...base, reasons: ['No punch'] };

  const reasons: string[] = [];
  const late = Math.max(0, minutes(start, firstIn));
  const overtime =
    d.rules.punches.overtime &&
    outAt &&
    minutes(end, outAt) >= Math.max(1, d.rules.punches.overtimeAfterMinutes)
      ? minutes(end, outAt)
      : 0;
  const out = {
    ...base,
    outAt,
    workedMinutes: worked,
    lateMinutes: late,
    overtimeMinutes: overtime,
    missedOut,
  };

  // With half a day on leave, half a day of work is a full day's attendance.
  const needed = d.leave === 'half' ? fullDay / 2 : fullDay;
  let status: AttendanceStatus = 'PRESENT';
  if (missedOut && d.rules.late.missedPunchOut === 'halfDay') {
    status = 'HALF_DAY';
    reasons.push('No punch-out: half day until a correction');
  } else if (worked < needed) {
    status = worked >= needed / 2 ? 'HALF_DAY' : 'ABSENT';
    reasons.push(`Worked ${Math.round(worked / 6) / 10} h of ${needed / 60} h`);
  }
  if (late > d.rules.late.graceMinutes && d.leave !== 'half') {
    if (late >= d.rules.late.halfDayAfterMinutes) {
      if (status === 'PRESENT') status = 'HALF_DAY';
      reasons.push(`${late} min late: half day`);
    } else {
      if (status === 'PRESENT') status = 'LATE';
      reasons.push(`${late} min late`);
    }
  }
  if (missedOut && d.rules.late.missedPunchOut === 'shiftEnd')
    reasons.push('No punch-out: counted to shift end');
  if (overtime) reasons.push(`${overtime} min overtime`);
  return { ...out, status, reasons };
}

/** Straight-line distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type PunchCheck = { allow: boolean; flag: string | null };

/** Geofence (§9.2): inside the branch circle is fine; outside or no location follows the rules. */
export function checkPunchPlace(
  rules: PunchRules,
  branch: { lat: number; lng: number; radiusM: number } | null,
  at: { lat: number; lng: number; accuracy?: number | null } | null,
): PunchCheck {
  if (!branch) return { allow: true, flag: null };
  if (!at)
    return rules.noLocation === 'block'
      ? { allow: false, flag: 'Location could not be read' }
      : { allow: true, flag: 'Location could not be read' };
  // A fuzzy fix gets the benefit of its accuracy, up to 200 m.
  const slack = Math.min(200, Math.max(0, at.accuracy ?? 0));
  const away = distanceM(branch, at) - branch.radiusM - slack;
  if (away <= 0) return { allow: true, flag: null };
  const flag = `${Math.round(away + branch.radiusM)} m from the office`;
  return rules.awayFromOffice === 'block' ? { allow: false, flag } : { allow: true, flag };
}
