import type { Db } from '@mono/db';
import {
  addDays,
  formatLocalDate,
  localDate,
  shiftWindow,
  weekdayOf,
  zonedToUtc,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import type { Actor } from '../work/actor';
import { period } from './balance';
import { companyCalendar } from './calendar';
import { runCovers, scheduleCovers } from './cover';
import { hrPerson, hrRulesOf, hrScope, type HrPerson } from './people';
import { openWork, suggestionsFor, type WorkItem } from './work';

const tzOf = async (db: Db, companyId: string) =>
  (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } })).timezone;

/** People who use punching at all (a punch in the last 14 days): only they can be "absent" by missing one. */
async function punchesAtAll(db: Db, userId: string, now: Date) {
  return Boolean(
    await db.punch.findFirst({
      where: { userId, at: { gte: new Date(now.getTime() - 14 * 86_400_000), lte: now } },
      select: { id: true },
    }),
  );
}

/** Has the person punched in for this shift date? */
async function punchedIn(db: Db, p: HrPerson, date: string, tz: string) {
  const { start, end } = shiftWindow(date, p.shift, tz);
  return Boolean(
    await db.punch.findFirst({
      where: { userId: p.id, type: 'IN', at: { gte: new Date(start.getTime() - 4 * 3600_000), lte: end } },
    }),
  );
}

/** How each piece of someone's work stands for a window: covered, a Buddy asked, or nobody yet. */
export async function coverState(db: Db, p: HrPerson, items: WorkItem[], fromAt: Date, toAt: Date) {
  const [covers, asks] = await Promise.all([
    db.cover.findMany({
      where: {
        companyId: p.companyId,
        originalUserId: p.id,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        from: { lt: toAt },
        to: { gt: fromAt },
      },
      select: { entityType: true, entityId: true, buddyUserId: true, status: true, title: true },
    }),
    db.buddyRequest.findMany({
      where: {
        companyId: p.companyId,
        userId: p.id,
        status: { in: ['ASKED', 'ACCEPTED'] },
        from: { lt: toAt },
        to: { gt: fromAt },
      },
      select: { buddyId: true, status: true, items: true },
    }),
  ]);
  // Work already handed to a Buddy is theirs now, so it isn't in the person's open work: add it back from the covers.
  const handed: WorkItem[] = covers
    .filter((c) => !items.some((i) => i.entityType === c.entityType && i.entityId === c.entityId))
    .map((c) => ({
      key: `${c.entityType}:${c.entityId}`,
      entityType: c.entityType as WorkItem['entityType'],
      entityId: c.entityId,
      title: c.title,
      due: null,
      backups: [],
    }));
  return [...items, ...handed].map((it) => {
    const c = covers.find((x) => x.entityType === it.entityType && x.entityId === it.entityId);
    if (c) return { ...it, state: 'covered' as const, buddyId: c.buddyUserId };
    const a = asks.find((x) => (x.items as { key: string }[]).some((i) => i.key === it.key));
    if (a)
      return {
        ...it,
        state: a.status === 'ACCEPTED' ? ('accepted' as const) : ('asked' as const),
        buddyId: a.buddyId,
      };
    return { ...it, state: 'none' as const, buddyId: null };
  });
}

/** Cover board (§9.2): today's absentees and people on leave, their open work, and who covers it. */
export async function coverBoard(db: Db, actor: Actor, date: string) {
  const scope = await hrScope(db, actor);
  if (!scope.all && !scope.team.length) throw new AppError(403, 'FORBIDDEN', 'You have no team to cover');
  const tz = await tzOf(db, actor.companyId);
  const rules = await hrRulesOf(db, actor.companyId);
  const now = new Date();
  const dayFrom = zonedToUtc(date, 0, tz);
  const dayTo = zonedToUtc(addDays(date, 1), 0, tz);
  const people = await db.user.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      status: 'ACTIVE',
      ...(scope.all ? {} : { id: { in: scope.team } }),
    },
    select: { id: true, mainDepartment: { select: { name: true } } },
  });
  const leaves = await db.leaveRequest.findMany({
    where: {
      companyId: actor.companyId,
      status: 'APPROVED',
      from: { lte: date },
      to: { gte: date },
      userId: { in: people.map((u) => u.id) },
    },
  });
  const types = new Map(
    (await db.leaveType.findMany({ where: { companyId: actor.companyId } })).map((t) => [t.id, t.name]),
  );
  const names = new Map(
    (await db.user.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name],
    ),
  );
  const away = [];
  for (const u of people) {
    const p = await hrPerson(db, actor.companyId, u.id);
    const leave = leaves.find((l) => l.userId === u.id);
    let reason: 'leave' | 'absent' | null = leave ? 'leave' : null;
    if (!reason) {
      const cal = await companyCalendar(db, actor.companyId, p.branchId);
      const working = !cal.holidays.has(date) && cal.workingWeekdays.has(weekdayOf(date));
      const { start } = shiftWindow(date, p.shift, tz);
      const past = now.getTime() > start.getTime() + rules.late.graceMinutes * 60_000;
      if (working && past && (await punchesAtAll(db, p.id, now)) && !(await punchedIn(db, p, date, tz)))
        reason = 'absent';
    }
    if (!reason) continue;
    const win = leave ? period(leave.from, leave.to, leave.half, p, tz) : { fromAt: dayFrom, toAt: dayTo };
    const items = await openWork(db, p, dayFrom, dayTo);
    const states = await coverState(db, p, items, win.fromAt, win.toAt);
    const open = states.filter((s) => s.state === 'none');
    const suggested = open.length
      ? await suggestionsFor(db, p, rules, open, { from: date, to: date, fromAt: dayFrom, toAt: dayTo })
      : [];
    away.push({
      person: { id: p.id, name: p.name, department: u.mainDepartment?.name ?? null },
      reason,
      leave: leave
        ? {
            id: leave.id,
            type: types.get(leave.leaveTypeId) ?? '',
            from: leave.from,
            to: leave.to,
            half: leave.half,
          }
        : null,
      items: states.map((s) => ({
        key: s.key,
        entityType: s.entityType,
        title: s.title,
        due: s.due,
        state: s.state,
        buddy: s.buddyId ? { id: s.buddyId, name: names.get(s.buddyId) ?? '?' } : null,
        suggestions: suggested.find((x) => x.key === s.key)?.suggestions.slice(0, 4) ?? [],
      })),
    });
  }
  return {
    date,
    away,
    counts: {
      away: away.length,
      work: away.reduce((n, a) => n + a.items.length, 0),
      uncovered: away.reduce(
        (n, a) => n + a.items.filter((i) => i.state === 'none' || i.state === 'asked').length,
        0,
      ),
    },
  };
}

/** One-click cover from the board (HOD/HR), or the autopilot for someone absent: the Buddy has it at once. */
export async function assignCover(
  db: Db,
  actor: Actor | null,
  input: { companyId: string; userId: string; keys: string[]; buddyId: string; date: string },
) {
  if (actor) {
    const s = await hrScope(db, actor);
    if (!s.all && !s.team.includes(input.userId))
      throw new AppError(403, 'FORBIDDEN', "Only their HOD or HR can give someone's work to a Buddy");
  }
  if (input.buddyId === input.userId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Nobody can be their own Buddy');
  const buddy = await db.user.findFirst({
    where: { id: input.buddyId, companyId: input.companyId, deletedAt: null, status: 'ACTIVE' },
  });
  if (!buddy) throw new AppError(400, 'VALIDATION_FAILED', 'The Buddy is not an active person');
  const tz = await tzOf(db, input.companyId);
  const p = await hrPerson(db, input.companyId, input.userId);
  const leave = await db.leaveRequest.findFirst({
    where: { userId: p.id, status: 'APPROVED', from: { lte: input.date }, to: { gte: input.date } },
  });
  const now = new Date();
  const win = leave
    ? period(leave.from, leave.to, leave.half, p, tz)
    : { fromAt: now, toAt: zonedToUtc(addDays(input.date, 1), 0, tz) };
  const items = (await openWork(db, p, zonedToUtc(input.date, 0, tz), win.toAt)).filter((i) =>
    input.keys.includes(i.key),
  );
  if (!items.length) throw new AppError(400, 'VALIDATION_FAILED', 'Pick the work to cover');
  await db.$transaction(async (tx) => {
    const br = await tx.buddyRequest.create({
      data: {
        companyId: input.companyId,
        leaveRequestId: leave?.id ?? null,
        absenceDate: leave ? null : input.date,
        userId: p.id,
        buddyId: input.buddyId,
        items: items.map(({ key, entityType, entityId, title }) => ({ key, entityType, entityId, title })),
        status: 'ACCEPTED',
        from: win.fromAt,
        to: win.toAt,
        dueAt: now,
        answeredAt: now,
        createdById: actor?.userId ?? null,
      },
    });
    await scheduleCovers(tx, br);
    await emitEvent(
      tx,
      { companyId: input.companyId, actorId: actor?.userId ?? null },
      {
        name: 'hr.buddy_requested',
        entityType: 'buddy_request',
        entityId: br.id,
        payload: {
          buddyId: input.buddyId,
          personId: p.id,
          from: formatLocalDate(input.date),
          to: leave ? formatLocalDate(leave.to) : formatLocalDate(input.date),
          count: items.length,
          work: items.map((i) => i.title).join('\n'),
          link: '/hr/cover',
        },
      },
    );
  });
  await runCovers(db, now);
  return { covered: items.length };
}

/**
 * Every 5 minutes (§9.1 step 5–6): someone not in by the half-day mark with no leave is absent. Their HOD is told
 * which work has no Buddy (or the autopilot gives it to the first suggested Buddy); if it's still uncovered after
 * the confirm time, the owner is told too.
 */
export async function watchAbsences(db: Db, now = new Date(), onlyCompanyId?: string) {
  let flagged = 0;
  for (const c of await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true },
  })) {
    const rules = await hrRulesOf(db, c.id);
    const today = localDate(now, c.timezone);
    const users = await db.user.findMany({
      where: { companyId: c.id, deletedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    for (const u of users) {
      const p = await hrPerson(db, c.id, u.id);
      const cal = await companyCalendar(db, c.id, p.branchId);
      if (cal.holidays.has(today) || !cal.workingWeekdays.has(weekdayOf(today))) continue;
      const { start, end } = shiftWindow(today, p.shift, c.timezone);
      const mark = start.getTime() + rules.late.halfDayAfterMinutes * 60_000;
      if (now.getTime() < mark || now >= end) continue;
      const onLeave = await db.leaveRequest.findFirst({
        where: { userId: p.id, status: 'APPROVED', from: { lte: today }, to: { gte: today } },
      });
      if (onLeave || !(await punchesAtAll(db, p.id, now)) || (await punchedIn(db, p, today, c.timezone)))
        continue;
      const items = await openWork(db, p, now, zonedToUtc(addDays(today, 1), 0, c.timezone));
      if (!items.length) continue;
      const states = await coverState(db, p, items, now, end);
      const open = states.filter((s) => s.state === 'none');
      const late = now.getTime() >= mark + rules.buddyAnswer.absentConfirmHours * 3600_000;
      if (!late && (await claimMark(db, c.id, `hr.absent:${today}:${p.id}`))) {
        if (rules.autopilot.absentToBuddy && open.length) {
          const s = await suggestionsFor(db, p, rules, open, {
            from: today,
            to: today,
            fromAt: now,
            toAt: end,
          });
          const first = s.find((x) => x.suggestions[0])?.suggestions[0];
          if (first)
            await assignCover(db, null, {
              companyId: c.id,
              userId: p.id,
              keys: open.map((o) => o.key),
              buddyId: first.id,
              date: today,
            });
        } else if (open.length) {
          await notifyAbsent(db, c.id, p, open.length, false);
        }
        flagged++;
      } else if (late && open.length && (await claimMark(db, c.id, `hr.absent2:${today}:${p.id}`))) {
        await notifyAbsent(db, c.id, p, open.length, true);
        flagged++;
      }
    }
  }
  return flagged;
}

const notifyAbsent = (db: Db, companyId: string, p: HrPerson, count: number, escalate: boolean) =>
  db.$transaction((tx) =>
    emitEvent(
      tx,
      { companyId, actorId: null },
      {
        name: 'hr.absent_no_cover',
        entityType: 'user',
        entityId: p.id,
        // First the HOD; the owner only once the confirm time has passed.
        payload: {
          personId: p.id,
          count,
          link: '/hr/cover',
          ...(escalate ? {} : { skipRecipients: ['owner'] }),
        },
      },
    ),
  );
