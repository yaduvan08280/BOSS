import type { Db } from '@mono/db';
import { addDays, formatINR, localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import type { Actor } from '../work/actor';
import { branchNumbers } from './branches';
import { needOwner, spanOf } from './core';
import { leaks } from './leaks';
import { promises } from './promises';

type Line = { key: string; now: string; before: string; change: number };

/**
 * The weekly owner's letter: last week (Monday–Sunday) against the week before, in one page — the three things
 * that got better, the three that got worse, and the one decision that is waiting on the owner. Every line
 * carries the two numbers it compares, so the letter can be checked.
 */
export async function ownerLetter(db: Db, companyId: string, ownerId: string | null, now = new Date()) {
  const { timezone: tz, name } = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, name: true },
  });
  const today = localDate(now, tz);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  const lastMonday = addDays(today, -weekday - 7);
  const week = { from: lastMonday, to: addDays(lastMonday, 6) };
  const prev = { from: addDays(lastMonday, -7), to: addDays(lastMonday, -1) };
  const actor = { companyId, userId: ownerId ?? '', permissions: ['*'] } as unknown as Actor;
  const numbers = async (s: { from: string; to: string }) => {
    const span = await spanOf(db, companyId, s.from, s.to);
    const [rows, leak, kept] = await Promise.all([
      branchNumbers(db, companyId, span),
      leaks(db, actor, s.from, s.to),
      promises(db, actor, s.from, s.to),
    ]);
    const avg = (k: 'attendancePct' | 'lateWorkPct' | 'checklistMissedPct') => {
      const have = rows.map((r) => r[k]).filter((v): v is number => v !== null);
      return have.length ? Math.round((have.reduce((a, b) => a + b, 0) / have.length) * 10) / 10 : null;
    };
    return {
      sales: rows.reduce((n, r) => n + r.sales, 0),
      attendance: avg('attendancePct'),
      lateWork: avg('lateWorkPct'),
      missed: avg('checklistMissedPct'),
      leaks: leak.totals.all,
      kept: kept.keptPct,
    };
  };
  const [a, b] = await Promise.all([numbers(week), numbers(prev)]);
  const lines: Line[] = [];
  // `good` says which way is better; `change` is positive when the week got better.
  const add = (
    key: string,
    now_: number | null,
    before: number | null,
    good: 'up' | 'down',
    show: (n: number) => string,
  ) => {
    if (now_ === null || before === null || now_ === before) return;
    const base = Math.max(Math.abs(before), 1);
    const delta = ((now_ - before) / base) * (good === 'up' ? 1 : -1);
    lines.push({ key, now: show(now_), before: show(before), change: Math.round(delta * 1000) / 10 });
  };
  const money = (n: number) => formatINR(Math.round(n), { compact: true });
  const p = (n: number) => `${n}%`;
  add('sales', a.sales, b.sales, 'up', money);
  add('attendance', a.attendance, b.attendance, 'up', p);
  add('kept', a.kept, b.kept, 'up', p);
  add('lateWork', a.lateWork, b.lateWork, 'down', p);
  add('missed', a.missed, b.missed, 'down', p);
  add('leaks', a.leaks, b.leaks, 'down', money);
  const better = lines
    .filter((l) => l.change > 0)
    .sort((x, y) => y.change - x.change)
    .slice(0, 3);
  const worse = lines
    .filter((l) => l.change < 0)
    .sort((x, y) => x.change - y.change)
    .slice(0, 3);

  // The one decision: the oldest thing only the owner can move.
  const [slip, leave, adjust] = await Promise.all([
    db.slip.findFirst({
      where: { companyId, deletedAt: null, status: 'WITH_APPROVER' },
      orderBy: { createdAt: 'asc' },
      select: { number: true, problem: true, createdAt: true },
    }),
    db.leaveRequest.findFirst({
      where: { companyId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { from: true, createdAt: true, userId: true },
    }),
    db.stockMove.count({ where: { companyId, status: 'PENDING' } }),
  ]);
  const decision = slip
    ? {
        kind: 'slip',
        text: `#${slip.number} ${slip.problem.slice(0, 120)}`,
        since: localDate(slip.createdAt, tz),
        link: '/help-slips',
      }
    : leave
      ? { kind: 'leave', text: '', since: localDate(leave.createdAt, tz), link: '/hr/leave' }
      : adjust
        ? { kind: 'stock', text: String(adjust), since: null, link: '/ims/stock' }
        : null;
  return { company: name, week, better, worse, decision, numbers: { now: a, before: b } };
}

export async function letterFor(db: Db, actor: Actor) {
  needOwner(actor);
  return ownerLetter(db, actor.companyId, actor.userId);
}

const WORDS: Record<string, string> = {
  sales: 'Sales',
  attendance: 'Attendance',
  kept: 'Promises kept',
  lateWork: 'Late work',
  missed: 'Checklists missed',
  leaks: 'Unexplained money',
};
const dmy = (d: string) => d.split('-').reverse().join('/');

/** The letter goes to the owner once a week, on Monday from 08:00 company time. */
export async function letterSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const companies = await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true },
  });
  let sent = 0;
  for (const c of companies) {
    const today = localDate(now, c.timezone);
    if (new Date(`${today}T12:00:00Z`).getUTCDay() !== 1) continue;
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: c.timezone, hour: '2-digit', hour12: false })
        .format(now)
        .slice(0, 2),
    );
    if (hour < 8) continue;
    if (!(await claimMark(db, c.id, `owner.letter:${today}`))) continue;
    const l = await ownerLetter(db, c.id, null, now);
    if (!l.better.length && !l.worse.length && !l.decision) continue;
    const list = (rows: Line[]) =>
      rows.map((r) => `${WORDS[r.key] ?? r.key} ${r.before} → ${r.now}`).join('; ') || '—';
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId: c.id, actorId: null },
        {
          name: 'report.owner_letter',
          entityType: 'company',
          entityId: c.id,
          payload: {
            week: `${dmy(l.week.from)} – ${dmy(l.week.to)}`,
            better: list(l.better),
            worse: list(l.worse),
            decision: l.decision ? `${l.decision.kind}: ${l.decision.text || 'waiting'}` : '—',
            link: '/owner?tab=letter',
          },
        },
      ),
    );
    sent += 1;
  }
  return sent;
}
