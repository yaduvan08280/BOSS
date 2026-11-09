import type { Db } from '@mono/db';
import { fmsWeekRow, weekOf, type FmsStepFact } from '@mono/shared';
import { can, teamOf, type Actor } from '../work/actor';

/**
 * The FMS steps people hold that are graded in a week (decision 101): planned or done in it, never AUTO or
 * skipped, from records that weren't deleted or cancelled; an open step only while its record runs.
 * `ids` null = everyone in the company.
 */
export async function weekSteps(
  db: Db,
  companyId: string,
  ids: string[] | null,
  week: { from: Date; to: Date },
) {
  const range = { gte: week.from, lt: week.to };
  const found = await db.fmsRecordStep.findMany({
    where: {
      companyId,
      type: { not: 'AUTO' },
      status: { not: 'SKIPPED' },
      doerId: ids ? { in: ids } : { not: null },
      record: { deletedAt: null, status: { not: 'CANCELLED' } },
      OR: [{ plannedAt: range }, { doneAt: range }],
    },
    select: {
      doerId: true,
      status: true,
      plannedAt: true,
      doneAt: true,
      record: { select: { status: true, flow: { select: { id: true, name: true } } } },
    },
  });
  return found
    .filter((s) => s.status !== 'OPEN' || s.record.status === 'RUNNING')
    .map((s) => ({ ...s, doerId: s.doerId! }));
}

/**
 * Delegation sheet → FMS report: one week of process steps per person and per flow.
 * Admins see everyone, HODs their team and themselves, everyone else themselves (like the Weekly MIS).
 */
export async function fmsPeopleReport(db: Db, actor: Actor, at: Date, now = new Date()) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const week = weekOf(at, company.timezone);
  const everyone = can(actor, 'core.admin');
  const ids = everyone
    ? null
    : [...new Set([...(await teamOf(db, actor.companyId, actor.userId)), actor.userId])];
  const steps = await weekSteps(db, actor.companyId, ids, week);

  const group = <K extends string>(key: (s: (typeof steps)[number]) => K) => {
    const m = new Map<K, FmsStepFact[]>();
    for (const s of steps) m.set(key(s), [...(m.get(key(s)) ?? []), s]);
    return m;
  };
  const byPerson = group((s) => s.doerId);
  const byFlow = group((s) => s.record.flow.id);
  const names = new Map(
    (
      await db.user.findMany({
        where: { companyId: actor.companyId, id: { in: [...byPerson.keys()] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const flowNames = new Map(steps.map((s) => [s.record.flow.id, s.record.flow.name]));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

  return {
    week: { start: week.start, end: week.end },
    total: fmsWeekRow(steps, week, now),
    rows: [...byPerson.entries()]
      .map(([personId, list]) => ({
        personId,
        name: names.get(personId) ?? '—',
        ...fmsWeekRow(list, week, now),
      }))
      .sort(byName),
    flows: [...byFlow.entries()]
      .map(([flowId, list]) => ({
        flowId,
        name: flowNames.get(flowId) ?? '—',
        ...fmsWeekRow(list, week, now),
      }))
      .sort(byName),
  };
}
