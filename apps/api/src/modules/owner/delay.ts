import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, places, spanOf } from './core';

type Stored = Record<string, number>;
const valuesOf = async (db: Db, companyId: string) => {
  const c = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { settings: true } });
  return (((c.settings ?? {}) as { ownerDelay?: Stored }).ownerDelay ?? {}) as Stored;
};

/** What one day of delay costs for a process (rupees a day, typed by the owner). */
export async function saveDelayValue(db: Db, actor: Actor, input: { flowId: string; rupeesPerDay: number }) {
  needOwner(actor);
  const c = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { settings: true },
  });
  const settings = (c.settings ?? {}) as { ownerDelay?: Stored };
  const next = { ...settings.ownerDelay, [input.flowId]: Math.max(0, Math.round(input.rupeesPerDay)) };
  await db.company.update({
    where: { id: actor.companyId },
    data: { settings: { ...settings, ownerDelay: next } as object },
  });
  return { ok: true };
}

/**
 * Cost of delay: every process has a value per day; a step done late (or still open past its time) costs its
 * late days × that value. Totals by process, by step and by person — "4 days late" becomes rupees.
 */
export async function costOfDelay(db: Db, actor: Actor, from?: string, to?: string) {
  needOwner(actor);
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId, from, to);
  const span = from
    ? s
    : await spanOf(
        db,
        companyId,
        new Date(s.end.getTime() - 30 * 86_400_000).toISOString().slice(0, 10),
        s.to,
      );
  const [values, flows, steps, pl] = await Promise.all([
    valuesOf(db, companyId),
    db.flow.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, status: true },
    }),
    db.fmsRecordStep.findMany({
      where: {
        companyId,
        type: { not: 'AUTO' },
        plannedAt: { gte: span.start, lt: span.end },
        status: { in: ['OPEN', 'DONE'] },
        record: { deletedAt: null, status: { not: 'CANCELLED' } },
      },
      select: {
        doerId: true,
        stepName: true,
        plannedAt: true,
        doneAt: true,
        status: true,
        record: { select: { flowId: true, status: true } },
      },
    }),
    places(db, companyId),
  ]);
  const now = Date.now();
  const byFlow = new Map<string, { lateDays: number; lateSteps: number; steps: number }>();
  const byPerson = new Map<string, { lateDays: number; cost: number; lateSteps: number }>();
  const byStep = new Map<
    string,
    { flowId: string; step: string; lateDays: number; cost: number; lateSteps: number }
  >();
  for (const st of steps) {
    const f =
      byFlow.get(st.record.flowId) ??
      byFlow.set(st.record.flowId, { lateDays: 0, lateSteps: 0, steps: 0 }).get(st.record.flowId)!;
    f.steps += 1;
    // An open step counts only while its record runs (on hold is not late).
    const end = st.doneAt?.getTime() ?? (st.record.status === 'RUNNING' ? now : st.plannedAt.getTime());
    const lateDays = Math.max(0, (end - st.plannedAt.getTime()) / 86_400_000);
    if (lateDays <= 0) continue;
    const cost = lateDays * (values[st.record.flowId] ?? 0) * 100;
    f.lateDays += lateDays;
    f.lateSteps += 1;
    if (st.doerId) {
      const p =
        byPerson.get(st.doerId) ??
        byPerson.set(st.doerId, { lateDays: 0, cost: 0, lateSteps: 0 }).get(st.doerId)!;
      p.lateDays += lateDays;
      p.cost += cost;
      p.lateSteps += 1;
    }
    const key = `${st.record.flowId}|${st.stepName}`;
    const x =
      byStep.get(key) ??
      byStep
        .set(key, { flowId: st.record.flowId, step: st.stepName, lateDays: 0, cost: 0, lateSteps: 0 })
        .get(key)!;
    x.lateDays += lateDays;
    x.cost += cost;
    x.lateSteps += 1;
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const flowName = new Map(flows.map((f) => [f.id, f.name]));
  const processes = flows
    .filter((f) => f.status === 'PUBLISHED' || byFlow.has(f.id))
    .map((f) => {
      const x = byFlow.get(f.id) ?? { lateDays: 0, lateSteps: 0, steps: 0 };
      const perDay = values[f.id] ?? 0;
      return {
        flowId: f.id,
        name: f.name,
        rupeesPerDay: perDay,
        steps: x.steps,
        lateSteps: x.lateSteps,
        lateDays: r1(x.lateDays),
        cost: Math.round(x.lateDays * perDay * 100),
      };
    })
    .sort((a, b) => b.cost - a.cost || b.lateDays - a.lateDays);
  return {
    from: span.from,
    to: span.to,
    total: processes.reduce((n, p) => n + p.cost, 0),
    unpriced: processes.filter((p) => !p.rupeesPerDay && p.lateSteps > 0).length,
    processes,
    people: [...byPerson]
      .map(([userId, p]) => ({
        userId,
        name: pl.name(userId),
        lateSteps: p.lateSteps,
        lateDays: r1(p.lateDays),
        cost: Math.round(p.cost),
      }))
      .sort((a, b) => b.cost - a.cost || b.lateDays - a.lateDays)
      .slice(0, 30),
    steps: [...byStep.values()]
      .map((x) => ({
        ...x,
        process: flowName.get(x.flowId) ?? '',
        lateDays: r1(x.lateDays),
        cost: Math.round(x.cost),
      }))
      .sort((a, b) => b.cost - a.cost || b.lateDays - a.lateDays)
      .slice(0, 20),
  };
}
