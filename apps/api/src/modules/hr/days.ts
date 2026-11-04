import type { Db } from '@mono/db';
import { addDays, daysInMonth, localDate, zonedToUtc } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { attendanceDate, auditPunchFix, evaluateDay, punchWindow, settleDay } from './attendance';
import { canDecideFor, hrPerson, hrRulesOf, hrScope, personRules } from './people';

const tzOf = async (db: Db, companyId: string) =>
  (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } })).timezone;

/** A person's month: each settled day, today as it stands, and today's punches. */
export async function myMonth(db: Db, actor: Actor, month: string, userId = actor.userId, now = new Date()) {
  if (userId !== actor.userId) {
    const s = await hrScope(db, actor);
    if (!s.all && !s.team.includes(userId))
      throw new AppError(403, 'FORBIDDEN', "You can't see this person's attendance");
  }
  const tz = await tzOf(db, actor.companyId);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = `${month}-01`;
  const last = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  const p = await hrPerson(db, actor.companyId, userId);
  // The shift running now: after midnight a night shift is still the evening before's.
  const today = attendanceDate(now, p, tz);
  const win = punchWindow(today, p, tz);
  const [days, punches] = await Promise.all([
    db.attendanceDay.findMany({
      where: { userId, date: { gte: first, lte: last } },
      orderBy: { date: 'asc' },
    }),
    db.punch.findMany({
      where: { userId, at: { gte: win.from, lte: win.to } },
      orderBy: { at: 'asc' },
      select: { id: true, type: true, at: true, flagged: true, flagReason: true, source: true },
    }),
  ]);
  // Always the current shift (the punch card needs it whichever month is open).
  const live = await evaluateDay(db, actor.companyId, p, today, now);
  const rules = personRules(await hrRulesOf(db, actor.companyId), p);
  const usedFixes = await db.correctionRequest.count({
    where: { userId, date: { gte: first, lte: last }, status: { not: 'REJECTED' } },
  });
  return {
    person: { id: p.id, name: p.name, shift: p.shift, pattern: p.pattern, weeklyHours: p.weeklyHours },
    days,
    today: live ? { date: today, ...live } : null,
    punches,
    corrections: { used: usedFixes, limit: rules.punches.correctionsPerMonth },
    selfie: rules.punches.selfie,
  };
}

/** One day for a team (HOD) or everyone (HR): who is in, late, away, and flagged punches. */
export async function teamDay(db: Db, actor: Actor, date: string) {
  const s = await hrScope(db, actor);
  if (!s.all && !s.team.length) throw new AppError(403, 'FORBIDDEN', 'You have no team to see');
  const people = await db.user.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(s.all ? {} : { id: { in: s.team } }),
    },
    select: { id: true, name: true, code: true, mainDepartment: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const saved = new Map(
    (
      await db.attendanceDay.findMany({
        where: { companyId: actor.companyId, date, userId: { in: people.map((p) => p.id) } },
      })
    ).map((d) => [d.userId, d]),
  );
  const rows = [];
  for (const u of people) {
    const d =
      saved.get(u.id) ??
      (await evaluateDay(db, actor.companyId, await hrPerson(db, actor.companyId, u.id), date));
    const tz = await tzOf(db, actor.companyId);
    const flags = await db.punch.findMany({
      where: {
        userId: u.id,
        flagged: true,
        at: { gte: zonedToUtc(date, 0, tz), lt: zonedToUtc(addDays(date, 1), 0, tz) },
      },
      select: { type: true, at: true, flagReason: true },
    });
    rows.push({
      id: u.id,
      name: u.name,
      code: u.code,
      department: u.mainDepartment?.name ?? null,
      status: d.status,
      inAt: d.inAt,
      outAt: d.outAt,
      lateMin: 'lateMin' in d ? d.lateMin : d.lateMinutes,
      settled: saved.has(u.id),
      flags,
    });
  }
  return { date, rows };
}

/** "I forgot to punch": limited per month by the rules; the HOD (or HR) decides. */
export async function requestCorrection(
  db: Db,
  actor: Actor,
  input: { date: string; inAt?: string | null; outAt?: string | null; reason: string },
) {
  if (!input.inAt && !input.outAt)
    throw new AppError(400, 'VALIDATION_FAILED', 'Give the time you came in or left');
  const p = await hrPerson(db, actor.companyId, actor.userId);
  const rules = personRules(await hrRulesOf(db, actor.companyId), p);
  const month = input.date.slice(0, 7);
  const used = await db.correctionRequest.count({
    where: { userId: p.id, date: { startsWith: month }, status: { not: 'REJECTED' } },
  });
  if (used >= rules.punches.correctionsPerMonth)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `Only ${rules.punches.correctionsPerMonth} corrections a month are allowed; this month's are used`,
    );
  const row = await db.$transaction(async (tx) => {
    const c = await tx.correctionRequest.create({
      data: {
        companyId: actor.companyId,
        userId: p.id,
        date: input.date,
        inAt: input.inAt ? new Date(input.inAt) : null,
        outAt: input.outAt ? new Date(input.outAt) : null,
        reason: input.reason,
      },
    });
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'hr.punch_flagged',
        entityType: 'correction',
        entityId: c.id,
        payload: {
          personId: p.id,
          type: 'correction',
          time: (c.inAt ?? c.outAt)!.toISOString(),
          reason: `Correction asked: ${input.reason}`,
          link: '/hr/attendance?tab=corrections',
        },
      },
    );
    return c;
  });
  return row;
}

export async function listCorrections(db: Db, actor: Actor) {
  const s = await hrScope(db, actor);
  const [mine, toDecide] = await Promise.all([
    db.correctionRequest.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    s.all || s.team.length
      ? db.correctionRequest.findMany({
          where: {
            companyId: actor.companyId,
            status: 'PENDING',
            userId: { not: actor.userId, ...(s.all ? {} : { in: s.team }) },
          },
          orderBy: { createdAt: 'asc' },
        })
      : [],
  ]);
  return { mine, toDecide };
}

export async function decideCorrection(db: Db, actor: Actor, id: string, approve: boolean, note?: string) {
  const c = await db.correctionRequest.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Correction not found');
  if (c.status !== 'PENDING') throw new AppError(409, 'CONFLICT', 'This was already decided');
  if (!(await canDecideFor(db, actor, c.userId)))
    throw new AppError(403, 'FORBIDDEN', 'Only their HOD or HR decides this');
  await db.$transaction(async (tx) => {
    await tx.correctionRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedById: actor.userId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });
    if (approve) {
      const add = [
        ...(c.inAt ? [{ type: 'IN', at: c.inAt }] : []),
        ...(c.outAt ? [{ type: 'OUT', at: c.outAt }] : []),
      ];
      await tx.punch.createMany({
        data: add.map((x) => ({
          companyId: c.companyId,
          userId: c.userId,
          type: x.type,
          at: x.at,
          source: 'correction',
        })),
        skipDuplicates: true,
      });
      await auditPunchFix(tx, actor, c.userId, c.date, { correctionId: id, punches: add });
    }
  });
  if (approve) await settleDay(db, actor.companyId, await hrPerson(db, actor.companyId, c.userId), c.date);
  return { ok: true };
}

/**
 * Biometric device export (CSV): employee code (or biometric id), date-time, and IN/OUT if the device gives it.
 * Without IN/OUT, each day's first punch is IN and its last OUT. Repeats are skipped.
 */
export async function importPunches(db: Db, actor: Actor, csv: string) {
  if (!(await hrScope(db, actor)).all) throw new AppError(403, 'FORBIDDEN', 'Only HR imports punches');
  const tz = await tzOf(db, actor.companyId);
  const users = await db.user.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    select: { id: true, code: true, hr: true },
  });
  const byCode = new Map<string, string>();
  for (const u of users) {
    if (u.code) byCode.set(u.code.toLowerCase(), u.id);
    const bio = (u.hr as { biometricId?: string } | null)?.biometricId;
    if (bio) byCode.set(String(bio).toLowerCase(), u.id);
  }
  const unknown = new Set<string>();
  const bad: number[] = [];
  const rows: { userId: string; at: Date; type: string | null }[] = [];
  csv.split(/\r?\n/).forEach((line, i) => {
    const cells = line.split(/[,\t;]/).map((x) => x.trim().replace(/^"|"$/g, ''));
    // Only the first line can be a header, and only if it has no date in it ("EMP-003" is a code, not a header).
    if (!cells[0] || (i === 0 && !parseWhen(cells[1] ?? '', tz))) return;
    const userId = byCode.get(cells[0].toLowerCase());
    if (!userId) return void unknown.add(cells[0]);
    const at = parseWhen(cells[1] ?? '', tz);
    if (!at) return void bad.push(i + 1);
    const dir = (cells[2] ?? '').toUpperCase();
    rows.push({ userId, at, type: dir === 'IN' || dir === 'OUT' ? dir : null });
  });
  // No direction: first of the day IN, last OUT.
  const groups = new Map<string, typeof rows>();
  for (const r of rows.filter((x) => !x.type)) {
    const k = `${r.userId}|${localDate(r.at, tz)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => a.at.getTime() - b.at.getTime());
    g[0]!.type = 'IN';
    if (g.length > 1) g[g.length - 1]!.type = 'OUT';
  }
  const data = rows
    .filter((r) => r.type)
    .map((r) => ({
      companyId: actor.companyId,
      userId: r.userId,
      type: r.type!,
      at: r.at,
      source: 'biometric',
    }));
  const added = (await db.punch.createMany({ data, skipDuplicates: true })).count;
  // Settle (again) every day the import touched.
  const touched = new Set(data.map((d) => `${d.userId}|${d.at.toISOString()}`));
  const days = new Set<string>();
  for (const t of touched) {
    const [userId, iso] = t.split('|') as [string, string];
    const p = await hrPerson(db, actor.companyId, userId);
    days.add(`${userId}|${attendanceDate(new Date(iso), p, tz)}`);
  }
  for (const d of days) {
    const [userId, date] = d.split('|') as [string, string];
    await settleDay(db, actor.companyId, await hrPerson(db, actor.companyId, userId), date);
  }
  return { added, skipped: data.length - added, unknownCodes: [...unknown], badLines: bad };
}

/** "03/11/2026 09:05", "03-11-2026 9:05" or ISO → an instant in the company's time zone. */
export function parseWhen(s: string, tz: string): Date | null {
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})[ T](\d{1,2}):(\d{2})/.exec(s.trim());
  if (m) {
    const [, d, mo, y, h, mi] = m.map(Number) as [number, number, number, number, number, number];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59) return null;
    return zonedToUtc(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, h * 60 + mi, tz);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}
