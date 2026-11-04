import type { Db, Tx } from '@mono/db';
import {
  addDays,
  checkPunchPlace,
  computeDay,
  localDate,
  shiftWindow,
  weekdayOf,
  zonedToUtc,
  type DayKind,
  type DayResult,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { companyCalendar } from './calendar';
import { hrPerson, hrRulesOf, personRules, type HrPerson } from './people';

/** The shift date a punch belongs to: a night shift's morning punches belong to the evening before. */
export function attendanceDate(at: Date, p: HrPerson, tz: string): string {
  const today = localDate(at, tz);
  if (p.shift.end > p.shift.start) return today;
  const { end } = shiftWindow(addDays(today, -1), p.shift, tz);
  return at.getTime() <= end.getTime() + 4 * 3600_000 ? addDays(today, -1) : today;
}

/** The punches that belong to a shift date: from 4 hours before it starts to 8 hours after it ends. */
export function punchWindow(date: string, p: HrPerson, tz: string) {
  const { start, end } = shiftWindow(date, p.shift, tz);
  return {
    from: new Date(start.getTime() - 4 * 3600_000),
    to: new Date(end.getTime() + 8 * 3600_000),
    start,
    end,
  };
}

/**
 * When someone not in yet counts as absent for a shift date, and until when it matters:
 * a fixed shift — its start + "half day after"; daily / weekly hours — the person's latest start, if set.
 */
export function absenceMark(date: string, p: HrPerson, halfDayAfterMinutes: number, tz: string) {
  const { start, end } = shiftWindow(date, p.shift, tz);
  if (p.pattern.kind === 'shift')
    return { mark: new Date(start.getTime() + halfDayAfterMinutes * 60_000), start, end };
  return { mark: p.latestStartMin === null ? null : zonedToUtc(date, p.latestStartMin, tz), start, end };
}

/** The day as the rules see it right now (not saved). */
export async function evaluateDay(
  db: Db | Tx,
  companyId: string,
  p: HrPerson,
  date: string,
  now = new Date(),
): Promise<DayResult & { final: boolean }> {
  const [cal, rules, leave] = await Promise.all([
    companyCalendar(db, companyId, p.branchId),
    hrRulesOf(db, companyId),
    db.leaveRequest.findFirst({
      where: { companyId, userId: p.id, status: 'APPROVED', from: { lte: date }, to: { gte: date } },
      select: { half: true },
    }),
  ]);
  const { from, to, end } = punchWindow(date, p, cal.tz);
  const punches = await db.punch.findMany({
    where: { userId: p.id, at: { gte: from, lte: to } },
    orderBy: { at: 'asc' },
  });
  const kind: DayKind = cal.holidays.has(date)
    ? 'holiday'
    : cal.workingWeekdays.has(weekdayOf(date))
      ? 'working'
      : 'weeklyOff';
  const result = computeDay({
    date,
    kind,
    leave: leave ? (leave.half ? 'half' : 'full') : null,
    shift: p.shift,
    punches: punches.map((x) => ({ type: x.type as 'IN' | 'OUT', at: x.at })),
    tz: cal.tz,
    rules: personRules(rules, p),
    pattern: p.pattern,
  });
  // A day is settled two hours after the shift ends (CLAUDE.md §9.2).
  return { ...result, final: now.getTime() >= end.getTime() + 2 * 3600_000 };
}

/** Compute and keep a day (only once it is settled); returns what it counts as. */
export async function settleDay(db: Db | Tx, companyId: string, p: HrPerson, date: string, now = new Date()) {
  const r = await evaluateDay(db, companyId, p, date, now);
  if (!r.final) return { saved: false, result: r };
  const data = {
    status: r.status,
    inAt: r.inAt,
    outAt: r.outAt,
    workedMin: r.workedMinutes,
    lateMin: r.lateMinutes,
    overtimeMin: r.overtimeMinutes,
    missedOut: r.missedOut,
    compOff: r.compOff,
    reasons: r.reasons,
    computedAt: new Date(),
  };
  const before = await db.attendanceDay.findUnique({ where: { userId_date: { userId: p.id, date } } });
  await db.attendanceDay.upsert({
    where: { userId_date: { userId: p.id, date } },
    create: { companyId, userId: p.id, date, ...data },
    update: data,
  });
  return { saved: true, result: r, first: !before };
}

export type PunchInput = {
  type: 'IN' | 'OUT';
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  selfieId?: string | null;
  deviceId?: string | null;
  /** Punches made offline are sent later with the time they were made (up to a day back). */
  at?: string | null;
};

/** Punch in or out from the phone: geofence and selfie by the rules; flagged punches go to the HOD. */
export async function punch(db: Db, actor: Actor, input: PunchInput) {
  const p = await hrPerson(db, actor.companyId, actor.userId);
  const rules = personRules(await hrRulesOf(db, actor.companyId), p);
  const now = new Date();
  const at = input.at ? new Date(input.at) : now;
  if (
    Number.isNaN(at.getTime()) ||
    at > new Date(now.getTime() + 60_000) ||
    at < new Date(now.getTime() - 24 * 3600_000)
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'That punch time is not possible');
  const branch = await db.branch.findFirst({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      lat: { not: null },
      radiusM: { not: null },
      ...(p.branchId ? { id: p.branchId } : { isDefault: true }),
    },
  });
  const place = checkPunchPlace(
    rules.punches,
    branch ? { lat: Number(branch.lat), lng: Number(branch.lng), radiusM: branch.radiusM! } : null,
    input.lat != null && input.lng != null
      ? { lat: input.lat, lng: input.lng, accuracy: input.accuracy }
      : null,
  );
  if (!place.allow) throw new AppError(400, 'VALIDATION_FAILED', `Punch not allowed: ${place.flag}`);
  if (rules.punches.selfie && !input.selfieId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Take a selfie to punch');
  const tz = (
    await db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } })
  ).timezone;
  const row = await db.$transaction(async (tx) => {
    const created = await tx.punch.create({
      data: {
        companyId: actor.companyId,
        userId: p.id,
        type: input.type,
        at,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        accuracy: input.accuracy != null ? Math.round(input.accuracy) : null,
        selfieId: input.selfieId ?? null,
        deviceId: input.deviceId ?? null,
        branchId: branch?.id ?? null,
        flagged: Boolean(place.flag),
        flagReason: place.flag,
      },
    });
    if (input.selfieId)
      await tx.attachment.updateMany({
        where: {
          id: input.selfieId,
          companyId: actor.companyId,
          uploadedById: actor.userId,
          entityType: 'upload',
        },
        data: { entityType: 'punch', entityId: created.id },
      });
    if (place.flag)
      await emitEvent(
        tx,
        { companyId: actor.companyId, actorId: null },
        {
          name: 'hr.punch_flagged',
          entityType: 'punch',
          entityId: created.id,
          payload: {
            personId: p.id,
            type: input.type === 'IN' ? 'in' : 'out',
            time: at.toISOString(),
            reason: place.flag,
            link: '/hr/attendance?tab=team',
          },
        },
      );
    return created;
  });
  const date = attendanceDate(at, p, tz);
  const day = await settleDay(db, actor.companyId, p, date);
  return { punch: row, date, day: day.result };
}

/** Every 15 minutes: settle yesterday and today for everyone whose shift ended two hours ago; tell about missed punch-outs. */
export async function settleAttendance(db: Db, now = new Date(), onlyCompanyId?: string) {
  const companies = await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true },
  });
  let settled = 0;
  for (const c of companies) {
    const people = await db.user.findMany({
      where: { companyId: c.id, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, createdAt: true },
    });
    const today = localDate(now, c.timezone);
    for (const u of people) {
      const p = await hrPerson(db, c.id, u.id);
      for (const date of [addDays(today, -1), today]) {
        if (date < localDate(u.createdAt, c.timezone)) continue;
        if (await db.attendanceDay.findUnique({ where: { userId_date: { userId: u.id, date } } })) continue;
        const r = await settleDay(db, c.id, p, date, now);
        if (!r.saved) continue;
        settled++;
        if (r.result.missedOut)
          await db.$transaction((tx) =>
            emitEvent(
              tx,
              { companyId: c.id, actorId: null },
              {
                name: 'hr.missed_punch',
                entityType: 'attendance_day',
                entityId: `${u.id}:${date}`,
                payload: {
                  userId: u.id,
                  date,
                  type: 'out',
                  link: `/hr/attendance?tab=corrections&date=${date}`,
                },
              },
            ),
          );
      }
    }
  }
  return settled;
}

export async function auditPunchFix(tx: Tx, actor: Actor, userId: string, date: string, what: object) {
  await writeAudit(
    tx,
    { ...actor, actorId: actor.userId },
    {
      action: 'attendance.corrected',
      entityType: 'attendance_day',
      entityId: `${userId}:${date}`,
      after: what,
    },
  );
}
