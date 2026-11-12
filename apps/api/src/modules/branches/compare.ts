import { currentReach, type Db } from '@mono/db';
import { localDate } from '@mono/shared';
import type { Actor } from '../work/actor';

const pct = (good: number, total: number) => (total ? Math.round((good / total) * 100) : null);

export type OutletRow = {
  branchId: string;
  name: string;
  type: string;
  people: number;
  /** Days worked out of days that should have been (present, late or half ÷ those plus absent). */
  attendance: number | null;
  /** Checklist runs missed, of those that closed in the period (lower is better). */
  checklistMissed: number | null;
  /** Average hours from a ticket being raised to being fixed. */
  ticketHours: number | null;
  /** Tasks finished by their planned time, of those finished. */
  onTime: number | null;
  /** The average of the parts that have data (a missed-run share counts as 100 − it). Null = no data yet. */
  score: number | null;
  rank: number | null;
};

/**
 * Outlets side by side for a period (phase 12, plan §3.11): attendance, checklist misses, ticket times and
 * on-time work, ranked by one score. Only the branches the reader may see; the numbers of each branch come
 * from the work that carries that branch and the people whose home it is.
 */
export async function compareOutlets(db: Db, actor: Actor, from: Date, to: Date): Promise<OutletRow[]> {
  const companyId = actor.companyId;
  const mine = currentReach()?.branchIds ?? null;
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const branches = await db.branch.findMany({
    where: { companyId, deletedAt: null, ...(mine ? { id: { in: mine } } : {}) },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true },
  });
  const ids = branches.map((b) => b.id);
  if (!ids.length) return [];
  const span = { gte: from, lt: to };
  const people = await db.user.findMany({
    where: { companyId, deletedAt: null, status: 'ACTIVE', branchId: { in: ids } },
    select: { id: true, branchId: true },
  });
  const home = new Map(people.map((p) => [p.id, p.branchId]));
  const [days, runs, tickets, tasks] = await Promise.all([
    db.attendanceDay.findMany({
      where: {
        companyId,
        date: { gte: localDate(from, company.timezone), lt: localDate(to, company.timezone) },
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT'] },
        // A day counts where it was worked (its own branch once stamped), else at the person's home branch.
        OR: [{ branchId: { in: ids } }, { branchId: null, userId: { in: people.map((p) => p.id) } }],
      },
      select: { status: true, userId: true, branchId: true },
    }),
    db.checklistRun.groupBy({
      by: ['branchId', 'status'],
      where: { companyId, branchId: { in: ids }, plannedAt: span, status: { in: ['DONE', 'MISSED'] } },
      _count: true,
    }),
    db.ticket.findMany({
      where: { companyId, deletedAt: null, branchId: { in: ids }, resolvedAt: span },
      select: { branchId: true, createdAt: true, resolvedAt: true },
    }),
    db.task.findMany({
      where: { companyId, deletedAt: null, branchId: { in: ids }, doneAt: span },
      select: { branchId: true, plannedAt: true, doneAt: true },
    }),
  ]);
  const rows = branches.map((b): OutletRow => {
    const att = days.filter((d) => (d.branchId ?? home.get(d.userId)) === b.id);
    const worked = att.filter((d) => d.status !== 'ABSENT').length;
    const count = (status: string) =>
      runs.find((r) => r.branchId === b.id && r.status === status)?._count ?? 0;
    const missed = count('MISSED');
    const fixed = tickets.filter((t) => t.branchId === b.id);
    const hours = fixed.length
      ? fixed.reduce((sum, t) => sum + (t.resolvedAt!.getTime() - t.createdAt.getTime()), 0) /
        fixed.length /
        3_600_000
      : null;
    const done = tasks.filter((t) => t.branchId === b.id);
    const attendance = pct(worked, att.length);
    const checklistMissed = pct(missed, missed + count('DONE'));
    const onTime = pct(done.filter((t) => t.doneAt! <= t.plannedAt).length, done.length);
    const parts = [attendance, checklistMissed === null ? null : 100 - checklistMissed, onTime].filter(
      (x): x is number => x !== null,
    );
    return {
      branchId: b.id,
      name: b.name,
      type: b.type,
      people: people.filter((p) => p.branchId === b.id).length,
      attendance,
      checklistMissed,
      ticketHours: hours === null ? null : Math.round(hours * 10) / 10,
      onTime,
      score: parts.length ? Math.round(parts.reduce((a, x) => a + x, 0) / parts.length) : null,
      rank: null,
    };
  });
  // Best score first; branches with no data yet stay unranked at the end.
  const ranked = rows.filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!);
  ranked.forEach((r, i) => {
    r.rank = i > 0 && ranked[i - 1]!.score === r.score ? ranked[i - 1]!.rank : i + 1;
  });
  return [...ranked, ...rows.filter((r) => r.score === null)];
}
