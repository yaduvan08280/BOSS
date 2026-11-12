import type { Db, FmsRecord, Flow, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import { createId } from '@paralleldrive/cuid2';
import {
  END,
  flowDefinitionSchema,
  mergeData,
  nextStepKey,
  plannedAt,
  recordTitle,
  type FlowDefinition,
  type FlowStep,
  type WorkCalendar,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { processForm } from '../forms';
import { attachUploads, can, type Actor } from '../work/actor';
import { workCalendar } from './calendar';
import { createDocument } from './documents';
import { customerContact, runAuto } from './auto';

export const fmsLink = (r: { id: string }) => `/fms/live?record=${r.id}`;

export function parseDefinition(json: unknown): FlowDefinition {
  return flowDefinitionSchema.parse(json ?? {});
}

/** A step can be finished from a Telegram button only when it asks for nothing but a tap. */
function telegramActions(step: FlowStep): string[] {
  const simple =
    !step.fields.some((f) => f.required) &&
    !step.checklist.length &&
    !step.proofRequired &&
    !step.documents.length;
  if (!simple) return [];
  if (step.type === 'DECISION') return ['yes', 'no'];
  if (step.type === 'APPROVAL') return ['approve'];
  return ['fmsdone'];
}

export async function log(
  tx: Tx,
  record: Pick<FmsRecord, 'id' | 'companyId'>,
  type: string,
  extra: { stepKey?: string; actorId?: string | null; note?: string | null; data?: object } = {},
) {
  await tx.fmsRecordEvent.create({
    data: { companyId: record.companyId, recordId: record.id, type, ...extra },
  });
}

/** Among the step's doers, the one with the fewest open steps right now (simple load balancing). */
async function pickDoer(tx: Tx, step: FlowStep, record: FmsRecord): Promise<string | null> {
  if (step.type === 'AUTO') return null;
  if (step.starter && record.startedById) return record.startedById;
  if (!step.doerIds.length) return record.startedById;
  if (step.doerIds.length === 1) return step.doerIds[0]!;
  const loads = await tx.fmsRecordStep.groupBy({
    by: ['doerId'],
    where: { companyId: record.companyId, status: 'OPEN', doerId: { in: step.doerIds } },
    _count: true,
  });
  const load = new Map(loads.map((l) => [l.doerId, l._count]));
  return [...step.doerIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0))[0]!;
}

export type Ctx = { flow: Flow; def: FlowDefinition; cal: WorkCalendar; actorId: string | null };

/** The payload every FMS event carries (names for templates come from the ids). */
export function payloadOf(ctx: Ctx, record: FmsRecord, extra: Record<string, unknown> = {}) {
  return {
    flow: ctx.flow.name,
    run: ctx.flow.runName,
    record: `${record.title} (#${record.number})`,
    coordinatorId: ctx.flow.coordinatorId,
    solverId: ctx.flow.solverId,
    link: fmsLink(record),
    ...extra,
  };
}

/**
 * Open a step for a record: pick the doer, work out when it is due, tell them. AUTO steps run right away
 * (message, document, stock) and the record moves on; webhooks are left open for the worker to call.
 */
export async function openStep(
  tx: Tx,
  ctx: Ctx,
  record: FmsRecord,
  stepKey: string,
  previousDoneAt: Date,
  depth = 0,
) {
  if (stepKey === END) return closeRecord(tx, ctx, record, null);
  if (depth > 40) throw new AppError(409, 'CONFLICT', 'This flow keeps looping through automatic steps');
  const position = ctx.def.steps.findIndex((s) => s.key === stepKey);
  const step = ctx.def.steps[position];
  if (!step) throw new AppError(409, 'CONFLICT', `Step "${stepKey}" is not in this flow version`);
  const data = await recordData(tx, record);
  const due = plannedAt(step.time, {
    previousDoneAt,
    recordStartedAt: record.startedAt,
    data,
    calendar: ctx.cal,
    timeModel: ctx.def.timeModel,
  });
  // A public-form record has no starter: steps meant for the starter go to the coordinator.
  const doerId = (await pickDoer(tx, step, record)) ?? (step.type === 'AUTO' ? null : ctx.flow.coordinatorId);
  const row = await tx.fmsRecordStep.create({
    data: {
      companyId: record.companyId,
      recordId: record.id,
      stepKey: step.key,
      stepName: step.name,
      type: step.type,
      position,
      doerId,
      plannedAt: due,
      startedAt: previousDoneAt,
    },
  });
  await log(tx, record, 'step_assigned', { stepKey: step.key, data: { doerId, plannedAt: due } });

  if (step.type === 'AUTO') {
    if (step.auto?.action === 'webhook') return row; // the worker calls it and moves on
    await runAuto(tx, ctx, record, step, data);
    const now = new Date();
    await tx.fmsRecordStep.update({ where: { id: row.id }, data: { status: 'DONE', doneAt: now } });
    return openStep(tx, ctx, record, nextStepKey(ctx.def, step.key), now, depth + 1);
  }
  await emitEvent(
    tx,
    { companyId: record.companyId, actorId: ctx.actorId },
    {
      name: step.type === 'APPROVAL' ? 'fms.approval_needed' : 'fms.step_assigned',
      entityType: 'fms_step',
      entityId: row.id,
      payload: payloadOf(ctx, record, {
        doerId,
        approverId: step.type === 'APPROVAL' ? doerId : undefined,
        step: step.name,
        due: due.toISOString(),
        telegramActions: telegramActions(step),
      }),
    },
  );
  return row;
}

/** Start form values plus everything entered on finished steps (later steps can use earlier answers). */
export async function recordData(tx: Tx, record: FmsRecord): Promise<Record<string, unknown>> {
  const done = await tx.fmsRecordStep.findMany({
    where: { recordId: record.id, status: 'DONE' },
    orderBy: { doneAt: 'asc' },
  });
  return mergeData(record.data, ...done.map((s) => s.data));
}

export async function closeRecord(tx: Tx, ctx: Ctx, record: FmsRecord, actorId: string | null) {
  const now = new Date();
  await tx.fmsRecord.update({ where: { id: record.id }, data: { status: 'CLOSED', closedAt: now } });
  await log(tx, record, 'closed', { actorId });
  const hours = Math.round((now.getTime() - record.startedAt.getTime()) / 3_600_000);
  await emitEvent(
    tx,
    { companyId: record.companyId, actorId },
    {
      name: 'fms.record_closed',
      entityType: 'fms_record',
      entityId: record.id,
      payload: payloadOf(ctx, record, {
        duration: hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} h`,
      }),
    },
  );
  return null;
}

export async function contextFor(
  tx: Tx,
  flowId: string,
  versionId: string,
  actorId: string | null,
): Promise<Ctx> {
  const flow = await tx.flow.findUniqueOrThrow({ where: { id: flowId } });
  const version = await tx.flowVersion.findUniqueOrThrow({ where: { id: versionId } });
  return {
    flow,
    def: parseDefinition(version.definition),
    cal: await workCalendar(tx, flow.companyId),
    actorId,
  };
}

/** Start a record from the start form (web, the public form, or the API). */
export async function startRecord(
  db: Db,
  input: {
    companyId: string;
    flowId: string;
    data: Record<string, unknown>;
    startedById: string | null;
    source: string;
    attachmentIds?: string[];
  },
) {
  return db.$transaction(async (tx) => {
    const flow = await tx.flow.findFirst({
      where: { id: input.flowId, companyId: input.companyId, deletedAt: null },
    });
    if (!flow || flow.status !== 'PUBLISHED' || !flow.currentVersionId)
      throw new AppError(409, 'CONFLICT', 'This process is not published yet');
    const ctx = await contextFor(tx, flow.id, flow.currentVersionId, input.startedById);
    const id = createId(); // known before the record exists, so its unique values can be claimed for it
    const values = await processForm(
      tx,
      {
        companyId: flow.companyId,
        actorId: input.startedById,
        owner: { kind: 'flow', id: flow.id },
        recordId: id,
        publicForm: input.source === 'public',
      },
      ctx.def.startFields,
      input.data,
    );
    const number = await nextCounter(tx, flow.companyId, `fms:${flow.id}`);
    const record = await tx.fmsRecord.create({
      data: {
        id,
        companyId: flow.companyId,
        flowId: flow.id,
        flowVersionId: flow.currentVersionId,
        number,
        title: recordTitle(ctx.def.startFields, values, flow.runName, number),
        data: values as object,
        startedById: input.startedById,
        source: input.source,
      },
    });
    if (input.startedById && input.attachmentIds?.length)
      await attachUploads(
        tx,
        flow.companyId,
        input.startedById,
        input.attachmentIds,
        'fms_record',
        record.id,
      );
    await log(tx, record, 'started', {
      actorId: input.startedById,
      note: input.source === 'public' ? 'From the public form' : null,
    });
    await emitEvent(
      tx,
      { companyId: flow.companyId, actorId: input.startedById },
      {
        name: 'fms.record_started',
        entityType: 'fms_record',
        entityId: record.id,
        payload: payloadOf(ctx, record),
      },
    );
    await openStep(tx, ctx, record, ctx.def.steps[0]?.key ?? END, record.startedAt);
    return record;
  });
}

export type StepInput = {
  data?: Record<string, unknown>;
  checklistDone?: string[];
  decision?: 'yes' | 'no' | 'approved' | 'rejected';
  note?: string;
  attachmentIds?: string[];
};

/** Who may finish a step: its doer, the flow's problem solver (who steps in when stuck), or an FMS admin. */
function mayDo(actor: Actor, flow: Flow, doerId: string | null) {
  return (
    doerId === actor.userId ||
    flow.solverId === actor.userId ||
    flow.solverBackupId === actor.userId ||
    can(actor, 'fms.admin')
  );
}

/**
 * Finish a step: form fields, checklist and proof are checked; decisions pick the branch, a rejected
 * approval goes back; documents are made; the next step opens (or the record closes).
 */
export async function completeStep(db: Db, actor: Actor, stepId: string, input: StepInput) {
  return db.$transaction(async (tx) => {
    const row = await tx.fmsRecordStep.findFirst({ where: { id: stepId, companyId: actor.companyId } });
    if (!row) throw notFound('Step');
    const record = await tx.fmsRecord.findUniqueOrThrow({ where: { id: row.recordId } });
    const ctx = await contextFor(tx, record.flowId, record.flowVersionId, actor.userId);
    if (!mayDo(actor, ctx.flow, row.doerId)) throw new AppError(403, 'FORBIDDEN', 'This step is not yours');
    if (row.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This step is already done');
    if (record.status !== 'RUNNING')
      throw new AppError(
        409,
        'CONFLICT',
        record.status === 'ON_HOLD' ? 'This record is on hold' : 'This record is closed',
      );
    const step = ctx.def.steps.find((s) => s.key === row.stepKey)!;

    const values = await processForm(
      tx,
      {
        companyId: record.companyId,
        actorId: actor.userId,
        owner: { kind: 'flow', id: record.flowId },
        recordId: record.id,
        known: await recordData(tx, record),
        canAddValues: can(actor, 'fms.admin'),
      },
      step.fields,
      input.data ?? {},
    );
    const ticked = new Set(input.checklistDone ?? []);
    const missing = step.checklist.filter((c) => !ticked.has(c));
    if (missing.length) throw new AppError(400, 'VALIDATION_FAILED', `Tick the checklist: ${missing[0]}`);
    const linked = await attachUploads(
      tx,
      actor.companyId,
      actor.userId,
      input.attachmentIds ?? [],
      'fms_step',
      row.id,
    );
    if (
      step.proofRequired &&
      !linked &&
      !(await tx.attachment.count({ where: { entityType: 'fms_step', entityId: row.id, deletedAt: null } }))
    )
      throw new AppError(400, 'VALIDATION_FAILED', 'This step needs a photo or file as proof');
    let decision = input.decision ?? null;
    if (step.type === 'DECISION' && decision !== 'yes' && decision !== 'no')
      throw new AppError(400, 'VALIDATION_FAILED', 'Answer Yes or No');
    if (step.type === 'APPROVAL') {
      if (decision !== 'approved' && decision !== 'rejected')
        throw new AppError(400, 'VALIDATION_FAILED', 'Approve or reject');
      if (decision === 'rejected' && !(input.note ?? '').trim())
        throw new AppError(400, 'VALIDATION_FAILED', 'Say why it is rejected');
    }
    if (step.type !== 'DECISION' && step.type !== 'APPROVAL') decision = null;

    const now = new Date();
    await tx.fmsRecordStep.update({
      where: { id: row.id },
      data: {
        status: 'DONE',
        doneAt: now,
        data: values as object,
        decision,
        note: input.note ?? null,
        checklistDone: [...ticked],
      },
    });
    await log(tx, record, 'step_done', {
      stepKey: step.key,
      actorId: actor.userId,
      note: input.note ?? null,
      data: decision ? { decision } : undefined,
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'fms.step_done', entityType: 'fms_step', entityId: row.id, after: { decision, values } },
    );

    const data = await recordData(tx, record);
    for (const code of step.documents) {
      const doc = await createDocument(tx, {
        companyId: record.companyId,
        typeCode: code,
        recordId: record.id,
        stepKey: step.key,
        data,
        party: record.title,
        createdById: actor.userId,
      });
      await log(tx, record, 'document', { stepKey: step.key, actorId: actor.userId, note: doc.number });
    }
    if (step.notifyCustomer)
      await emitEvent(
        tx,
        { companyId: record.companyId, actorId: actor.userId },
        {
          name: 'fms.customer_update',
          entityType: 'fms_record',
          entityId: record.id,
          payload: payloadOf(ctx, record, {
            ...customerContact(ctx.def, data),
            customer: record.title,
            text: `${step.name}: done`,
          }),
        },
      );
    await emitEvent(
      tx,
      { companyId: record.companyId, actorId: actor.userId },
      {
        name: 'fms.step_done',
        entityType: 'fms_step',
        entityId: row.id,
        payload: payloadOf(ctx, record, { step: step.name, decision }),
      },
    );
    await openStep(tx, ctx, record, nextStepKey(ctx.def, step.key, decision), now);
    return tx.fmsRecord.findUniqueOrThrow({ where: { id: record.id } });
  });
}
