import type { Db, Tx } from '@mono/db';
import { localDate } from '@mono/shared';

/**
 * Branch history (phase 12, plan §3.4): where each person worked on each day. A move is recorded with the day it
 * takes effect; attendance, cover and pay read the branch of the day, so a move in the middle of a month splits
 * the days — and the cost — between the two branches.
 */
type Stay = { userId: string; branchId: string | null; from: string; fromBranchId: string | null };

/** A reader of "which branch on that day?" for some people (their current branch when nothing was recorded). */
export async function branchHistory(db: Db | Tx, companyId: string, userIds?: string[]) {
  const [stays, people] = await Promise.all([
    db.branchStay.findMany({
      where: { companyId, ...(userIds ? { userId: { in: userIds } } : {}) },
      orderBy: { from: 'asc' },
      select: { userId: true, branchId: true, from: true, fromBranchId: true },
    }),
    db.user.findMany({
      where: { companyId, ...(userIds ? { id: { in: userIds } } : {}) },
      select: { id: true, branchId: true },
    }),
  ]);
  const now = new Map(people.map((p) => [p.id, p.branchId]));
  const byUser = new Map<string, Stay[]>();
  for (const s of stays) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
  return {
    /** The person's branch on a day (YYYY-MM-DD). */
    on(userId: string, date: string): string | null {
      const mine = byUser.get(userId);
      if (!mine?.length) return now.get(userId) ?? null;
      let at: string | null = mine[0]!.fromBranchId;
      for (const s of mine) {
        if (s.from > date) break;
        at = s.branchId;
      }
      return at;
    },
  };
}

/** The beginning of time, for someone given their first branch: they count as having always been there. */
const ALWAYS = '0000-01-01';

/**
 * Record a move to a branch from a day (the same day again replaces what was recorded) and return where the
 * person is today. A first branch for someone who had none counts from the beginning, unless a day is named.
 */
export async function recordMove(
  tx: Tx,
  at: {
    companyId: string;
    userId: string;
    branchId: string | null;
    from: string | undefined;
    today: string;
    actorId: string | null;
  },
  before: string | null,
): Promise<string | null> {
  const first = (await tx.branchStay.count({ where: { userId: at.userId } })) === 0;
  const from = at.from ?? (first && before === null ? ALWAYS : at.today);
  await tx.branchStay.upsert({
    where: { userId_from: { userId: at.userId, from } },
    create: {
      companyId: at.companyId,
      userId: at.userId,
      branchId: at.branchId,
      from,
      fromBranchId: first ? before : null,
      createdById: at.actorId,
    },
    update: { branchId: at.branchId, createdById: at.actorId },
  });
  const now = await tx.branchStay.findFirst({
    where: { userId: at.userId, from: { lte: at.today } },
    orderBy: { from: 'desc' },
    select: { branchId: true },
  });
  // Every recorded stay is still ahead: the person stays where they were until the day comes.
  return now ? now.branchId : before;
}

/**
 * Daily (and whenever a move is saved): a person's home branch follows their history, so a move planned for a
 * later day switches over on that day. Returns how many people moved.
 */
export async function applyBranchMoves(db: Db, now = new Date(), onlyCompanyId?: string): Promise<number> {
  const companies = await db.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : {},
    select: { id: true, timezone: true },
  });
  let moved = 0;
  for (const c of companies) {
    const today = localDate(now, c.timezone);
    const due = await db.branchStay.findMany({
      where: { companyId: c.id, from: { lte: today } },
      orderBy: { from: 'asc' },
      select: { userId: true, branchId: true },
    });
    // The last stay that has begun is where the person is now.
    const latest = new Map(due.map((s) => [s.userId, s.branchId]));
    if (!latest.size) continue;
    const people = await db.user.findMany({
      where: { companyId: c.id, id: { in: [...latest.keys()] }, deletedAt: null },
      select: { id: true, branchId: true },
    });
    for (const p of people) {
      const to = latest.get(p.id) ?? null;
      if (p.branchId === to) continue;
      await db.user.update({ where: { id: p.id }, data: { branchId: to } });
      moved++;
    }
  }
  return moved;
}
