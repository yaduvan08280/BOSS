import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, pct, places, spanOf } from './core';

/**
 * The promise ledger: a planned date is a promise. For each person over the span — work that fell due, how much
 * was done by its date (kept), how often they moved a date and by how many days, and what they declined. A
 * manager's line also carries the kept-promise rate of the people who report to them.
 */
export async function promises(db: Db, actor: Actor, from?: string, to?: string) {
  needOwner(actor);
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId, from ?? undefined, to);
  const span = from
    ? s
    : await spanOf(
        db,
        companyId,
        new Date(s.end.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
        s.to,
      );
  const pl = await places(db, companyId);
  const [tasks, moves, declines, steps, runs] = await Promise.all([
    db.task.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { not: 'CANCELLED' },
        plannedAt: { gte: span.start, lt: span.end },
      },
      select: { doerId: true, plannedAt: true, doneAt: true },
    }),
    db.taskEvent.findMany({
      where: { companyId, type: 'date_moved', createdAt: { gte: span.start, lt: span.end } },
      select: { actorId: true, fromDate: true, toDate: true, task: { select: { doerId: true } } },
    }),
    db.taskEvent.findMany({
      where: {
        companyId,
        type: 'status',
        toStatus: 'RETURNED_TO_CREATOR',
        createdAt: { gte: span.start, lt: span.end },
      },
      select: { actorId: true },
    }),
    db.fmsRecordStep.findMany({
      where: {
        companyId,
        type: { not: 'AUTO' },
        doerId: { not: null },
        plannedAt: { gte: span.start, lt: span.end },
        status: { in: ['OPEN', 'DONE'] },
      },
      select: { doerId: true, plannedAt: true, doneAt: true },
    }),
    db.checklistRun.findMany({
      where: {
        companyId,
        plannedAt: { gte: span.start, lt: span.end },
        status: { in: ['DONE', 'MISSED', 'PENDING_VERIFY'] },
        master: { deletedAt: null },
      },
      select: { doerId: true, status: true },
    }),
  ]);
  const now = Date.now();
  type Row = { due: number; kept: number; broken: number; moved: number; slipDays: number; declined: number };
  const rows = new Map<string, Row>();
  const row = (id: string) =>
    rows.get(id) ?? rows.set(id, { due: 0, kept: 0, broken: 0, moved: 0, slipDays: 0, declined: 0 }).get(id)!;
  const grade = (doerId: string | null, plannedAt: Date, doneAt: Date | null) => {
    if (!doerId) return;
    if (!doneAt && plannedAt.getTime() > now) return; // not due yet
    const r = row(doerId);
    r.due += 1;
    if (doneAt && doneAt <= plannedAt) r.kept += 1;
    else r.broken += 1;
  };
  for (const t of tasks) grade(t.doerId, t.plannedAt, t.doneAt);
  for (const st of steps) grade(st.doerId, st.plannedAt, st.doneAt);
  for (const c of runs) {
    const r = row(c.doerId);
    r.due += 1;
    if (c.status === 'MISSED') r.broken += 1;
    else r.kept += 1;
  }
  for (const m of moves) {
    // A date moved by the doer is their promise slipping; moved by the giver, it is a new plan.
    if (!m.actorId || m.actorId !== m.task.doerId || !m.fromDate || !m.toDate) continue;
    const r = row(m.actorId);
    r.moved += 1;
    r.slipDays += Math.max(0, (m.toDate.getTime() - m.fromDate.getTime()) / 86_400_000);
  }
  for (const d of declines) if (d.actorId) row(d.actorId).declined += 1;

  const team = (managerId: string) => {
    const ids = pl.people.filter((p) => p.reportsToId === managerId).map((p) => p.id);
    const due = ids.reduce((n, id) => n + (rows.get(id)?.due ?? 0), 0);
    const kept = ids.reduce((n, id) => n + (rows.get(id)?.kept ?? 0), 0);
    return { people: ids.length, keptPct: pct(kept, due) };
  };
  const people = [...rows]
    .map(([userId, r]) => ({
      userId,
      name: pl.name(userId),
      branch: pl.branches.find((b) => b.id === pl.people.find((p) => p.id === userId)?.branchId)?.name ?? '',
      ...r,
      keptPct: pct(r.kept, r.due),
      avgSlipDays: r.moved ? Math.round((r.slipDays / r.moved) * 10) / 10 : 0,
      team: team(userId),
    }))
    .filter((r) => r.due > 0 || r.moved > 0 || r.declined > 0)
    .sort((a, b) => (a.keptPct ?? 101) - (b.keptPct ?? 101) || b.broken - a.broken);
  const due = people.reduce((n, r) => n + r.due, 0);
  return {
    from: span.from,
    to: span.to,
    keptPct: pct(
      people.reduce((n, r) => n + r.kept, 0),
      due,
    ),
    due,
    people,
  };
}
