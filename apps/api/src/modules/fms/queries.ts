import type { Db, Prisma } from '@mono/db';
import { addDays, localDate, zonedToUtc } from '@mono/shared';
import { notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { parseDefinition } from './engine';
import { liveColumnValues } from './paths';

export const LIVE_TABS = ['running', 'late', 'dueToday', 'onHold', 'closed'] as const;
export type LiveTab = (typeof LIVE_TABS)[number];

export async function dayRange(db: Db, companyId: string) {
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const today = localDate(new Date(), c.timezone);
  return {
    tz: c.timezone,
    fyStart: c.fyStartMonth,
    from: zonedToUtc(today, 0, c.timezone),
    to: zonedToUtc(addDays(today, 1), 0, c.timezone),
  };
}

/** Live FMS (CLAUDE.md §6.2): per flow, the stage strip, the tab counts and the records. */
export async function liveFms(db: Db, actor: Actor, flowId: string | undefined, tab: LiveTab) {
  const flows = await db.flow.findMany({
    where: { companyId: actor.companyId, deletedAt: null, version: { gt: 0 } },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      runName: true,
      currentVersionId: true,
      coordinatorId: true,
      solverId: true,
      liveColumns: true,
    },
  });
  const flow = flows.find((f) => f.id === flowId) ?? flows[0];
  if (!flow) return { flows, flow: null, stages: [], tiles: null, columns: [], records: [] };
  const now = new Date();
  const { from, to, tz } = await dayRange(db, actor.companyId);
  const version = flow.currentVersionId
    ? await db.flowVersion.findUnique({ where: { id: flow.currentVersionId } })
    : null;
  const def = parseDefinition(version?.definition);
  const base = { companyId: actor.companyId, flowId: flow.id, deletedAt: null };
  const open = await db.fmsRecordStep.findMany({
    where: {
      companyId: actor.companyId,
      status: 'OPEN',
      record: { flowId: flow.id, status: 'RUNNING', deletedAt: null },
    },
    select: { recordId: true, stepKey: true, plannedAt: true },
  });
  const stages = def.steps.map((s) => {
    const here = open.filter((o) => o.stepKey === s.key);
    return {
      key: s.key,
      name: s.name,
      type: s.type,
      count: here.length,
      late: here.filter((o) => o.plannedAt < now).length,
    };
  });
  const lateIds = new Set(open.filter((o) => o.plannedAt < now).map((o) => o.recordId));
  const todayIds = new Set(
    open.filter((o) => o.plannedAt >= from && o.plannedAt < to).map((o) => o.recordId),
  );
  const where: Prisma.FmsRecordWhereInput =
    tab === 'onHold'
      ? { ...base, status: 'ON_HOLD' }
      : tab === 'closed'
        ? { ...base, status: { in: ['CLOSED', 'CANCELLED'] }, closedAt: { gte: addDaysUtc(now, -90) } }
        : tab === 'late'
          ? { ...base, id: { in: [...lateIds] } }
          : tab === 'dueToday'
            ? { ...base, id: { in: [...todayIds] } }
            : { ...base, status: 'RUNNING' };
  const [records, running, onHold, closed] = await Promise.all([
    db.fmsRecord.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 300,
      include: {
        steps: { where: { status: 'OPEN' }, orderBy: { position: 'asc' } },
        version: { select: { definition: true } },
      },
    }),
    db.fmsRecord.count({ where: { ...base, status: 'RUNNING' } }),
    db.fmsRecord.count({ where: { ...base, status: 'ON_HOLD' } }),
    db.fmsRecord.count({
      where: { ...base, status: { in: ['CLOSED', 'CANCELLED'] }, closedAt: { gte: addDaysUtc(now, -90) } },
    }),
  ]);
  // The extra columns this process's list shows (linked, remembered and worked-out values — plan §2.5).
  const extra = await liveColumnValues(db, actor, flow, def, tz, records);
  return {
    flows,
    flow,
    stages,
    tiles: { running, late: lateIds.size, dueToday: todayIds.size, onHold, closed },
    columns: extra.columns,
    records: records.map((r) => {
      const steps = parseDefinition(r.version.definition).steps.length;
      const { version: _v, ...rest } = r;
      return {
        ...rest,
        cols: extra.values.get(r.id) ?? {},
        of: steps,
        lateMs: Math.max(0, ...r.steps.map((s) => now.getTime() - s.plannedAt.getTime())),
      };
    }),
  };
}

const addDaysUtc = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** My FMS steps: open steps I do (with their form), records I started, and flows I can start. */
export async function myFms(db: Db, actor: Actor) {
  const now = new Date();
  const [steps, owned, flows] = await Promise.all([
    db.fmsRecordStep.findMany({
      where: {
        companyId: actor.companyId,
        doerId: actor.userId,
        status: 'OPEN',
        record: { status: { in: ['RUNNING', 'ON_HOLD'] }, deletedAt: null },
      },
      orderBy: { plannedAt: 'asc' },
      include: {
        record: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            flow: { select: { name: true, runName: true } },
          },
        },
      },
    }),
    db.fmsRecord.findMany({
      where: {
        companyId: actor.companyId,
        startedById: actor.userId,
        deletedAt: null,
        startedAt: { gte: addDaysUtc(now, -120) },
      },
      orderBy: { startedAt: 'desc' },
      take: 200,
      include: {
        steps: { where: { status: 'OPEN' } },
        flow: { select: { name: true } },
        version: { select: { definition: true } },
      },
    }),
    can(actor, 'fms.create')
      ? db.flow.findMany({
          where: { companyId: actor.companyId, deletedAt: null, status: 'PUBLISHED' },
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            runName: true,
            departmentIds: true,
            currentVersionId: true,
            _count: { select: { records: { where: { status: 'RUNNING' } } } },
          },
        })
      : Promise.resolve([]),
  ]);
  return {
    steps: steps.map((s) => ({ ...s, late: s.plannedAt < now })),
    owned: owned.map((r) => {
      const { version, ...rest } = r;
      return { ...rest, of: parseDefinition(version.definition).steps.length };
    }),
    flows: flows.map((f) => ({
      id: f.id,
      name: f.name,
      runName: f.runName,
      departmentIds: f.departmentIds,
      running: f._count.records,
    })),
  };
}

/** A record with its flow version, every step (planned vs actual), history, documents and files. */
export async function recordDetail(db: Db, actor: Actor, id: string) {
  const r = await db.fmsRecord.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    include: {
      flow: true,
      version: true,
      steps: { orderBy: [{ createdAt: 'asc' }] },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!r) throw notFound('Record');
  const stepIds = r.steps.map((s) => s.id);
  const [documents, files] = await Promise.all([
    db.document.findMany({
      where: { companyId: actor.companyId, recordId: r.id },
      include: { type: { select: { name: true } } },
    }),
    db.attachment.findMany({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        OR: [
          { entityType: 'fms_record', entityId: r.id },
          { entityType: 'fms_step', entityId: { in: stepIds } },
        ],
      },
      select: { id: true, entityId: true, originalName: true, mime: true },
    }),
  ]);
  const f = r.flow;
  const manager =
    [f.coordinatorId, f.coordinatorBackupId, f.solverId, f.solverBackupId].includes(actor.userId) ||
    can(actor, 'fms.admin');
  const { version, flow: _flow, ...rest } = r;
  return {
    ...rest,
    flow: {
      id: f.id,
      name: f.name,
      runName: f.runName,
      coordinatorId: f.coordinatorId,
      solverId: f.solverId,
    },
    definition: parseDefinition(version.definition),
    version: version.version,
    documents: documents.map((d) => ({ ...d, total: d.total === null ? null : Number(d.total) })),
    files: files.map((x) => ({ ...x, url: `/api/files/${x.id}` })),
    can: {
      manage: manager,
      doSteps: r.steps
        .filter(
          (s) =>
            s.status === 'OPEN' &&
            (s.doerId === actor.userId ||
              [f.solverId, f.solverBackupId].includes(actor.userId) ||
              can(actor, 'fms.admin')),
        )
        .map((s) => s.id),
    },
  };
}

/** FMS report (CLAUDE.md §6.2): per step and per person — how many passed, planned vs actual, on time. */
export async function flowReport(db: Db, actor: Actor, flowId: string, days = 90) {
  const since = addDaysUtc(new Date(), -days);
  const done = await db.fmsRecordStep.findMany({
    where: {
      companyId: actor.companyId,
      status: 'DONE',
      type: { not: 'AUTO' },
      doneAt: { gte: since },
      record: { flowId },
    },
    select: {
      stepKey: true,
      stepName: true,
      position: true,
      doerId: true,
      startedAt: true,
      plannedAt: true,
      doneAt: true,
    },
  });
  const byStep = new Map<string, typeof done>();
  for (const s of done) byStep.set(s.stepKey, [...(byStep.get(s.stepKey) ?? []), s]);
  const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
  const steps = [...byStep.entries()]
    .map(([key, list]) => {
      const onTime = list.filter((s) => s.doneAt! <= s.plannedAt).length;
      return {
        key,
        name: list[0]!.stepName,
        position: list[0]!.position,
        passed: list.length,
        plannedHours: hours(
          list.reduce((a, s) => a + (s.plannedAt.getTime() - s.startedAt.getTime()), 0) / list.length,
        ),
        actualHours: hours(
          list.reduce((a, s) => a + (s.doneAt!.getTime() - s.startedAt.getTime()), 0) / list.length,
        ),
        onTimePct: Math.round((onTime / list.length) * 100),
      };
    })
    .sort((a, b) => a.position - b.position);
  const byPerson = new Map<string, { total: number; onTime: number }>();
  for (const s of done) {
    if (!s.doerId) continue;
    const p = byPerson.get(s.doerId) ?? { total: 0, onTime: 0 };
    p.total++;
    if (s.doneAt! <= s.plannedAt) p.onTime++;
    byPerson.set(s.doerId, p);
  }
  return {
    days,
    steps,
    worst: [...steps]
      .sort((a, b) => a.onTimePct - b.onTimePct)
      .slice(0, 3)
      .map((s) => s.key),
    people: [...byPerson.entries()].map(([id, p]) => ({
      id,
      total: p.total,
      onTimePct: Math.round((p.onTime / p.total) * 100),
    })),
  };
}
