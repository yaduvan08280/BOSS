import type { Db } from '@mono/db';
import {
  addDays,
  daysInMonth,
  formatDateTime,
  localDate,
  weekdayOf,
  type AttendanceStatus,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { evaluateDay, punchWindow } from './attendance';
import { companyCalendar, type CompanyCalendar } from './calendar';
import { hrPerson, hrScope } from './people';

/**
 * The month's attendance for many people at once (asked for 14/11/2026): the muster register — one row per person,
 * one code per day — and the daily punch report behind it. It reads exactly what the rest of HR reads: settled
 * days (`AttendanceDay`), the last two days worked out as they stand (like payroll), holidays and weekly offs from
 * the person's branch calendar, approved leave by its type, and nothing before the person joined.
 */
export type MusterQuery = { month: string; departmentId?: string | undefined; branchId?: string | undefined };

export type MusterCell = {
  date: string;
  /** P, LT, HD, A, WO, H, a leave code (CL, SL …, "½" for half a day), WO/P or H/P when worked, "–" no record. */
  code: string;
  status: AttendanceStatus | null;
  inAt: string | null;
  outAt: string | null;
  workedMin: number;
  lateMin: number;
  overtimeMin: number;
  missedOut: boolean;
  /** Not settled yet (today, or a day still inside its shift): worked out as it stands. */
  live: boolean;
  /** Before the person joined, or after today. */
  blank: boolean;
  punches: { type: string; at: string; flagged: boolean; source: string }[];
  reasons: string[];
};

export type MusterTotals = {
  present: number;
  late: number;
  halfDays: number;
  absent: number;
  leave: number;
  weeklyOffs: number;
  holidays: number;
  noRecord: number;
  workedMin: number;
  lateMin: number;
  overtimeMin: number;
};

export type MusterPerson = {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  shift: string;
  cells: MusterCell[];
  totals: MusterTotals;
};

const CODE: Record<AttendanceStatus, string> = {
  PRESENT: 'P',
  LATE: 'LT',
  HALF_DAY: 'HD',
  ABSENT: 'A',
  ON_LEAVE: 'L',
  HOLIDAY: 'H',
  WEEKLY_OFF: 'WO',
};
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export async function musterMonth(db: Db, actor: Actor, q: MusterQuery, now = new Date()) {
  const [y, m] = q.month.split('-').map(Number) as [number, number];
  if (m < 1 || m > 12) throw new AppError(400, 'VALIDATION_FAILED', 'Pick a month');
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true, name: true },
  });
  const tz = company.timezone;
  const dates = Array.from(
    { length: daysInMonth(y, m) },
    (_, i) => `${q.month}-${String(i + 1).padStart(2, '0')}`,
  );
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const today = localDate(now, tz);

  // Who: HR sees everyone, a manager or HOD their people, anyone else only themselves.
  const s = await hrScope(db, actor);
  const ids = s.all ? null : [...new Set([actor.userId, ...s.team, ...s.branchPeople])];
  const users = await db.user.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...(ids ? { id: { in: ids } } : {}),
      ...(q.departmentId ? { mainDepartmentId: q.departmentId } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
    },
    select: {
      id: true,
      code: true,
      name: true,
      hr: true,
      status: true,
      createdAt: true,
      mainDepartment: { select: { name: true } },
      designation: { select: { name: true } },
      branch: { select: { name: true } },
    },
    orderBy: [{ code: 'asc' }, { name: 'asc' }],
  });
  const userIds = users.map((u) => u.id);
  const [saved, leaves, types, punches] = await Promise.all([
    db.attendanceDay.findMany({ where: { userId: { in: userIds }, date: { gte: first, lte: last } } }),
    db.leaveRequest.findMany({
      where: { userId: { in: userIds }, status: 'APPROVED', from: { lte: last }, to: { gte: first } },
      select: { userId: true, from: true, to: true, half: true, leaveTypeId: true },
    }),
    db.leaveType.findMany({ where: { companyId: actor.companyId }, select: { id: true, code: true } }),
    // A night shift's punches run into the next morning: read a day either side.
    db.punch.findMany({
      where: {
        userId: { in: userIds },
        at: {
          gte: new Date(Date.parse(`${addDays(first, -1)}T00:00:00Z`)),
          lt: new Date(Date.parse(`${addDays(last, 2)}T00:00:00Z`)),
        },
      },
      orderBy: { at: 'asc' },
      select: { userId: true, type: true, at: true, flagged: true, source: true },
    }),
  ]);
  const dayOf = new Map(saved.map((d) => [`${d.userId}|${d.date}`, d]));
  const typeCode = new Map(types.map((t) => [t.id, t.code]));
  const calendars = new Map<string | null, CompanyCalendar>();
  const calendarOf = async (branchId: string | null) => {
    if (!calendars.has(branchId))
      calendars.set(branchId, await companyCalendar(db, actor.companyId, branchId));
    return calendars.get(branchId)!;
  };

  const people: MusterPerson[] = [];
  for (const u of users) {
    const p = await hrPerson(db, actor.companyId, u.id);
    const cal = await calendarOf(p.branchId);
    const doj = (u.hr as { doj?: string } | null)?.doj;
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(doj ?? '') ? doj! : localDate(u.createdAt, tz);
    const mine = punches.filter((x) => x.userId === u.id);
    const totals: MusterTotals = {
      present: 0,
      late: 0,
      halfDays: 0,
      absent: 0,
      leave: 0,
      weeklyOffs: 0,
      holidays: 0,
      noRecord: 0,
      workedMin: 0,
      lateMin: 0,
      overtimeMin: 0,
    };
    const cells: MusterCell[] = [];
    for (const date of dates) {
      const win = punchWindow(date, p, cal.tz);
      const dayPunches = mine
        .filter((x) => x.at >= win.from && x.at <= win.to)
        .map((x) => ({ type: x.type, at: x.at.toISOString(), flagged: x.flagged, source: x.source }));
      const blank = date < joined || date > today;
      const leave = leaves.find((l) => l.userId === u.id && l.from <= date && l.to >= date);
      const leaveCode = leave ? `${typeCode.get(leave.leaveTypeId) ?? 'L'}${leave.half ? '½' : ''}` : null;
      const kind = cal.holidays.has(date) ? 'H' : cal.workingWeekdays.has(weekdayOf(date)) ? null : 'WO';
      const rec = dayOf.get(`${u.id}|${date}`);
      let cell: MusterCell = {
        date,
        code: '',
        status: null,
        inAt: null,
        outAt: null,
        workedMin: 0,
        lateMin: 0,
        overtimeMin: 0,
        missedOut: false,
        live: false,
        blank,
        punches: dayPunches,
        reasons: [],
      };
      if (blank) {
        cells.push(cell);
        continue;
      }
      if (rec) {
        cell = {
          ...cell,
          status: rec.status as AttendanceStatus,
          inAt: rec.inAt?.toISOString() ?? null,
          outAt: rec.outAt?.toISOString() ?? null,
          workedMin: rec.workedMin,
          lateMin: rec.lateMin,
          overtimeMin: rec.overtimeMin,
          missedOut: rec.missedOut,
          reasons: rec.reasons,
        };
      } else if (date >= addDays(today, -2)) {
        // Not settled yet: as it stands now (payroll does the same for the last two days).
        const live = await evaluateDay(db, actor.companyId, p, date, now);
        cell = {
          ...cell,
          status: live.status,
          inAt: live.inAt?.toISOString() ?? null,
          outAt: live.outAt?.toISOString() ?? null,
          workedMin: live.workedMinutes,
          lateMin: live.lateMinutes,
          overtimeMin: live.overtimeMinutes,
          missedOut: live.missedOut,
          live: !live.final,
          reasons: live.reasons,
        };
        // A shift that hasn't started yet is not an absence.
        if (!live.final && !live.inAt && live.status === 'ABSENT') cell.status = null;
      } else if (kind || leaveCode) {
        // No settled row, but the calendar or an approved leave says what the day was.
        cell.status = leaveCode ? 'ON_LEAVE' : kind === 'H' ? 'HOLIDAY' : 'WEEKLY_OFF';
      }
      const st = cell.status;
      const worked = cell.workedMin > 0 || Boolean(cell.inAt);
      cell.code = !st
        ? cell.live
          ? ''
          : '–'
        : st === 'ON_LEAVE'
          ? (leaveCode ?? 'L')
          : (st === 'HOLIDAY' || st === 'WEEKLY_OFF') && worked
            ? `${CODE[st]}/P`
            : st === 'HALF_DAY' && leaveCode
              ? `HD/${leaveCode}`
              : CODE[st];
      if (!st && !cell.live) totals.noRecord++;
      if (st === 'PRESENT') totals.present++;
      if (st === 'LATE') {
        totals.present++;
        totals.late++;
      }
      if (st === 'HALF_DAY') totals.halfDays++;
      if (st === 'ABSENT') totals.absent++;
      if (st === 'ON_LEAVE') totals.leave += leave?.half ? 0.5 : 1;
      if (st === 'HALF_DAY' && leave?.half) totals.leave += 0.5;
      if (st === 'WEEKLY_OFF') totals.weeklyOffs++;
      if (st === 'HOLIDAY') totals.holidays++;
      totals.workedMin += cell.workedMin;
      totals.lateMin += cell.lateMin;
      totals.overtimeMin += cell.overtimeMin;
      cells.push(cell);
    }
    // Someone who has left shows only for a month they still have days in.
    if (u.status === 'LEFT' && !cells.some((c) => dayOf.has(`${u.id}|${c.date}`))) continue;
    people.push({
      id: u.id,
      code: u.code,
      name: u.name,
      department: u.mainDepartment?.name ?? null,
      designation: u.designation?.name ?? null,
      branch: u.branch?.name ?? null,
      shift: p.pattern.kind === 'shift' ? `${hhmm(p.shift.start)}–${hhmm(p.shift.end)}` : p.pattern.kind,
      cells,
      totals,
    });
  }
  return {
    month: q.month,
    company: company.name,
    tz,
    days: dates.map((date) => ({ date, weekday: weekdayOf(date) })),
    people,
  };
}

export type Muster = Awaited<ReturnType<typeof musterMonth>>;

/** "09:58" in the company's clock, or "" */
export const clock = (iso: string | null, tz: string) => (iso ? formatDateTime(iso, tz).slice(-5) : '');
export { hhmm };
