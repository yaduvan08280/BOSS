import { randomBytes } from 'node:crypto';
import type { Db, Tx } from '@mono/db';
import { formatNumber, nextCounter } from '@mono/db';
import {
  flowDefinitionSchema,
  flowMetaPatchSchema,
  flowMetaSchema,
  mainPathHours,
  readiness,
  validateFlow,
  type FlowDefinition,
  type FlowMeta,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { parseDefinition } from './engine';

const need = (actor: Actor, key: 'fms.edit' | 'fms.admin', what: string) => {
  if (!can(actor, key)) throw new AppError(403, 'FORBIDDEN', `You can't ${what}`);
};

async function activePeople(db: Db | Tx, companyId: string) {
  return new Set(
    (
      await db.user.findMany({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
}

/** Builder list: status, version, steps, people, readiness, running / late records. */
export async function listFlows(db: Db, actor: Actor) {
  const flows = await db.flow.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    orderBy: [{ status: 'asc' }, { code: 'asc' }],
    include: { _count: { select: { kpis: true } } },
  });
  const now = new Date();
  const [running, late] = await Promise.all([
    db.fmsRecord.groupBy({
      by: ['flowId'],
      where: { companyId: actor.companyId, status: 'RUNNING', deletedAt: null },
      _count: true,
    }),
    db.fmsRecordStep.findMany({
      where: { companyId: actor.companyId, status: 'OPEN', plannedAt: { lt: now } },
      select: { record: { select: { flowId: true } } },
    }),
  ]);
  const runningBy = new Map(running.map((r) => [r.flowId, r._count]));
  const lateBy = new Map<string, number>();
  for (const s of late) lateBy.set(s.record.flowId, (lateBy.get(s.record.flowId) ?? 0) + 1);
  return flows.map((f) => {
    const def = parseDefinition(f.draft);
    const r = readiness(def, f, f._count.kpis);
    return {
      id: f.id,
      code: f.code,
      name: f.name,
      runName: f.runName,
      status: f.status,
      version: f.version,
      dirty: f.dirty,
      departmentIds: f.departmentIds,
      coordinatorId: f.coordinatorId,
      solverId: f.solverId,
      videoUrl: f.videoUrl,
      steps: def.steps.length,
      doers: [...new Set(def.steps.flatMap((s) => s.doerIds))],
      readiness: { score: r.score, of: r.of, checks: r.checks },
      running: runningBy.get(f.id) ?? 0,
      late: lateBy.get(f.id) ?? 0,
      updatedAt: f.updatedAt,
    };
  });
}

/** One flow for the editor: draft, meta, versions, KPI cards and the header metrics. */
export async function getFlow(db: Db, actor: Actor, id: string) {
  const flow = await db.flow.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        select: { id: true, version: true, publishedAt: true, publishedById: true },
      },
      kpis: { orderBy: { position: 'asc' } },
    },
  });
  if (!flow) throw notFound('Process');
  const def = parseDefinition(flow.draft);
  const people = await activePeople(db, actor.companyId);
  const shift = await db.shift.findFirst({
    where: { companyId: actor.companyId, deletedAt: null },
    orderBy: { isDefault: 'desc' },
  });
  const hoursPerDay =
    def.timeModel === 'shifts' && shift ? ((shift.endMin - shift.startMin + 1440) % 1440 || 1440) / 60 : 24;
  return {
    ...flow,
    definition: def,
    issues: validateFlow(def, people),
    readiness: readiness(def, flow, flow.kpis.length),
    stats: {
      steps: def.steps.length,
      people: new Set(def.steps.flatMap((s) => s.doerIds)).size,
      days: Math.round((mainPathHours(def, hoursPerDay) / hoursPerDay) * 10) / 10,
    },
  };
}

export async function createFlow(db: Db, actor: Actor, meta: FlowMeta, definition?: unknown) {
  need(actor, 'fms.edit', 'build processes');
  const def = definition ? flowDefinitionSchema.parse(definition) : flowDefinitionSchema.parse({});
  return db.$transaction(async (tx) => {
    const flow = await tx.flow.create({
      data: {
        companyId: actor.companyId,
        code: formatNumber('PRC', await nextCounter(tx, actor.companyId, 'flow')),
        ...metaData(meta),
        name: meta.name,
        draft: def as object,
        createdById: actor.userId,
      },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'flow.created', entityType: 'flow', entityId: flow.id, after: flow },
    );
    return flow;
  });
}

function metaData(meta: Partial<FlowMeta>) {
  return {
    ...(meta.name !== undefined ? { name: meta.name } : {}),
    ...(meta.runName !== undefined ? { runName: meta.runName } : {}),
    ...(meta.departmentIds !== undefined ? { departmentIds: meta.departmentIds } : {}),
    ...(meta.coordinatorId !== undefined ? { coordinatorId: meta.coordinatorId ?? null } : {}),
    ...(meta.coordinatorBackupId !== undefined
      ? { coordinatorBackupId: meta.coordinatorBackupId ?? null }
      : {}),
    ...(meta.solverId !== undefined ? { solverId: meta.solverId ?? null } : {}),
    ...(meta.solverBackupId !== undefined ? { solverBackupId: meta.solverBackupId ?? null } : {}),
    ...(meta.videoUrl !== undefined ? { videoUrl: meta.videoUrl || null } : {}),
    ...(meta.description !== undefined ? { description: meta.description ?? null } : {}),
  };
}

/** Save the editor: meta and/or the draft definition. Published versions are never touched. */
export async function saveFlow(
  db: Db,
  actor: Actor,
  id: string,
  input: { meta?: Partial<FlowMeta>; definition?: unknown },
) {
  need(actor, 'fms.edit', 'build processes');
  const meta = input.meta ? flowMetaPatchSchema.parse(input.meta) : undefined;
  let def: FlowDefinition | undefined;
  if (input.definition !== undefined) {
    const parsed = flowDefinitionSchema.safeParse(input.definition);
    if (!parsed.success)
      throw new AppError(400, 'VALIDATION_FAILED', parsed.error.issues[0]?.message ?? 'Check the steps');
    def = parsed.data;
  }
  return db.$transaction(async (tx) => {
    const flow = await tx.flow.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
    if (!flow) throw notFound('Process');
    if (flow.status === 'ARCHIVED')
      throw new AppError(409, 'CONFLICT', 'Bring the process back from the archive first');
    const updated = await tx.flow.update({
      where: { id },
      data: { ...(meta ? metaData(meta) : {}), ...(def ? { draft: def as object, dirty: true } : {}) },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'flow.saved',
        entityType: 'flow',
        entityId: id,
        before: { name: flow.name },
        after: { name: updated.name },
      },
    );
    return updated;
  });
}

/** Publish: every check must pass; the draft becomes version N+1 and new records use it. */
export async function publishFlow(db: Db, actor: Actor, id: string) {
  need(actor, 'fms.admin', 'publish processes');
  return db.$transaction(async (tx) => {
    const flow = await tx.flow.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
    if (!flow) throw notFound('Process');
    const def = parseDefinition(flow.draft);
    const issues = validateFlow(def, await activePeople(tx, actor.companyId));
    if (issues.length)
      throw new AppError(400, 'VALIDATION_FAILED', `${issues.length} thing(s) to fix before publishing`, {
        issues,
      });
    const version = await tx.flowVersion.create({
      data: {
        companyId: actor.companyId,
        flowId: id,
        version: flow.version + 1,
        definition: def as object,
        publishedById: actor.userId,
      },
    });
    const updated = await tx.flow.update({
      where: { id },
      data: { status: 'PUBLISHED', version: version.version, currentVersionId: version.id, dirty: false },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'flow.published', entityType: 'flow', entityId: id, after: { version: version.version } },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { name: 'flow.published', entityType: 'flow', entityId: id, payload: { version: version.version } },
    );
    return updated;
  });
}

export async function duplicateFlow(db: Db, actor: Actor, id: string) {
  const flow = await db.flow.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!flow) throw notFound('Process');
  return createFlow(
    db,
    actor,
    {
      ...flowMetaSchema.parse({
        name: `Copy of ${flow.name}`.slice(0, 100),
        runName: flow.runName,
        departmentIds: flow.departmentIds,
      }),
      coordinatorId: flow.coordinatorId,
      solverId: flow.solverId,
    },
    flow.draft,
  );
}

/** Archive (records already running carry on) or bring back. */
export async function archiveFlow(db: Db, actor: Actor, id: string, archive: boolean) {
  need(actor, 'fms.admin', 'archive processes');
  const flow = await db.flow.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!flow) throw notFound('Process');
  return db.flow.update({
    where: { id },
    data: { status: archive ? 'ARCHIVED' : flow.version ? 'PUBLISHED' : 'DRAFT' },
  });
}

/** The public "share a form" link: on (a token is made once) or off. */
export async function setPublicForm(db: Db, actor: Actor, id: string, enabled: boolean) {
  need(actor, 'fms.admin', 'share forms');
  const flow = await db.flow.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!flow) throw notFound('Process');
  return db.flow.update({
    where: { id },
    data: { publicEnabled: enabled, publicToken: flow.publicToken ?? randomBytes(18).toString('base64url') },
    select: { publicEnabled: true, publicToken: true },
  });
}

export const kpiCardSchema = z.object({
  label: z.string().trim().min(1).max(60),
  // `count`, a start-form value or a step's value; the value may be a column of a linked row (`start:item.rate`).
  source: z
    .string()
    .max(140)
    .regex(/^(count|start:[a-z0-9_]+(\.[a-z0-9_]+)?|step:[a-z0-9_]+:[a-z0-9_]+(\.[a-z0-9_]+)?)$/),
  aggregation: z.enum(['COUNT', 'TOTAL', 'AVERAGE', 'MIN', 'MAX']),
  period: z.enum(['TODAY', 'WEEK', 'MONTH', 'FY']),
});

/** Replace a flow's KPI cards (the dashboard tab edits them as a list). */
export async function setKpiCards(
  db: Db,
  actor: Actor,
  flowId: string,
  cards: z.infer<typeof kpiCardSchema>[],
) {
  need(actor, 'fms.edit', 'change KPI cards');
  const flow = await db.flow.findFirst({
    where: { id: flowId, companyId: actor.companyId, deletedAt: null },
  });
  if (!flow) throw notFound('Process');
  return db.$transaction(async (tx) => {
    await tx.kpiCard.deleteMany({ where: { flowId } });
    await tx.kpiCard.createMany({
      data: cards.map((c, i) => ({ ...c, companyId: actor.companyId, flowId, position: i })),
    });
    return tx.kpiCard.findMany({ where: { flowId }, orderBy: { position: 'asc' } });
  });
}

export const documentTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{2,20}$/, 'Use 2–20 capital letters or digits'),
  name: z.string().trim().min(2).max(60),
  prefix: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{1,8}$/, 'Use up to 8 capital letters'),
  header: z.string().max(1000).nullish(),
  footer: z.string().max(1000).nullish(),
  terms: z.string().max(4000).nullish(),
  active: z.boolean().default(true),
});

export async function saveDocumentType(db: Db, actor: Actor, input: z.infer<typeof documentTypeSchema>) {
  if (!can(actor, 'docs.edit') && !can(actor, 'fms.admin'))
    throw new AppError(403, 'FORBIDDEN', "You can't change document types");
  return db.documentType.upsert({
    where: { companyId_code: { companyId: actor.companyId, code: input.code } },
    create: { companyId: actor.companyId, ...input },
    update: input,
  });
}
