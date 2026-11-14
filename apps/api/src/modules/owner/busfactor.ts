import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, places } from './core';

/**
 * The bus-factor map: work that only one person does. A process step only one person has done in the last six
 * months, a recurring checklist with one doer, a branch with one manager, a department head with nobody else
 * in the department. Sorted by how much rests on each person — the list to read before someone resigns.
 */
export async function busFactor(db: Db, actor: Actor) {
  needOwner(actor);
  const companyId = actor.companyId;
  const since = new Date(Date.now() - 180 * 86_400_000);
  const [pl, steps, masters, managers, departments, flows] = await Promise.all([
    places(db, companyId),
    db.fmsRecordStep.groupBy({
      by: ['stepName', 'doerId', 'recordId'],
      where: { companyId, type: { not: 'AUTO' }, doerId: { not: null }, doneAt: { gte: since } },
    }),
    db.checklistMaster.findMany({
      where: { companyId, deletedAt: null, active: true },
      select: { name: true, doerIds: true, verifierId: true },
    }),
    db.branchManager.findMany({
      where: { companyId, role: 'MANAGER', branchId: { not: null } },
      select: { branchId: true, userId: true },
    }),
    db.department.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, hodUserId: true },
    }),
    db.fmsRecord.findMany({
      where: { companyId, deletedAt: null, startedAt: { gte: since } },
      select: { id: true, flow: { select: { name: true } } },
    }),
  ]);
  const flowOfRecord = new Map(flows.map((r) => [r.id, r.flow.name]));
  type Item = { kind: 'step' | 'checklist' | 'branch' | 'department'; what: string; times?: number };
  const held = new Map<string, Item[]>();
  const add = (userId: string, item: Item) => held.set(userId, [...(held.get(userId) ?? []), item]);

  // Process steps: who has done each (process, step) — one name only means nobody else knows it.
  const doers = new Map<string, Map<string, number>>();
  for (const st of steps) {
    const key = `${flowOfRecord.get(st.recordId) ?? '?'} → ${st.stepName}`;
    const m = doers.get(key) ?? doers.set(key, new Map()).get(key)!;
    m.set(st.doerId!, (m.get(st.doerId!) ?? 0) + 1);
  }
  for (const [what, m] of doers)
    if (m.size === 1)
      for (const [userId, times] of m) if (times >= 2) add(userId, { kind: 'step', what, times });
  for (const c of masters)
    if (c.doerIds.length === 1) add(c.doerIds[0]!, { kind: 'checklist', what: c.name });
  const active = (id: string) => pl.people.some((p) => p.id === id && !p.deletedAt && p.status === 'ACTIVE');
  for (const b of pl.branches) {
    const mine = managers.filter((m) => m.branchId === b.id && active(m.userId));
    if (mine.length === 1) add(mine[0]!.userId, { kind: 'branch', what: b.name });
  }
  const members = await db.user.groupBy({
    by: ['mainDepartmentId'],
    where: { companyId, deletedAt: null, status: 'ACTIVE' },
    _count: { _all: true },
  });
  for (const d of departments) {
    const n = members.find((m) => m.mainDepartmentId === d.id)?._count._all ?? 0;
    if (d.hodUserId && n <= 1) add(d.hodUserId, { kind: 'department', what: d.name });
  }
  const people = [...held]
    .filter(([userId]) => active(userId))
    .map(([userId, items]) => ({
      userId,
      name: pl.name(userId),
      branch: pl.branches.find((b) => b.id === pl.people.find((p) => p.id === userId)?.branchId)?.name ?? '',
      count: items.length,
      items: items.sort((a, b) => a.kind.localeCompare(b.kind) || a.what.localeCompare(b.what)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { people, total: people.reduce((n, p) => n + p.count, 0), since: since.toISOString().slice(0, 10) };
}
