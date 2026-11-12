import { Prisma, type ChecklistRun, type Db, type Tx } from '@mono/db';
import { formatNumber, nextCounter } from '@mono/db';
import {
  checklistMachine,
  hhmmToMinutes,
  minutesToHHmm,
  transition,
  type ChecklistMasterInput,
  type RunStatus,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { attachUploads, can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';

export type Item = {
  key: string;
  text: string;
  requirePhoto: boolean;
  requireVoice: boolean;
  requireValue: boolean;
};

export function masterOut<T extends { dueMin: number }>(m: T) {
  return { ...m, dueTime: minutesToHHmm(m.dueMin) };
}

async function checkPeople(tx: Tx, companyId: string, ids: string[]) {
  const n = await tx.user.count({ where: { companyId, id: { in: ids }, deletedAt: null, status: 'ACTIVE' } });
  if (n !== new Set(ids).size) throw new AppError(400, 'VALIDATION_FAILED', 'Pick active people only');
}

/** Each branch once, a live branch of this company, with active people. */
async function checkBranchPlans(tx: Tx, companyId: string, plans: ChecklistMasterInput['perBranch']) {
  if (!plans?.length) return;
  const ids = plans.map((p) => p.branchId);
  if (new Set(ids).size !== ids.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'A branch is listed twice');
  const found = await tx.branch.count({ where: { id: { in: ids }, companyId, deletedAt: null } });
  if (found !== ids.length) throw notFound('Branch');
  await checkPeople(tx, companyId, [
    ...new Set(plans.flatMap((p) => [...p.doerIds, ...(p.verifierId ? [p.verifierId] : [])])),
  ]);
}

function masterData(input: ChecklistMasterInput) {
  const { dueTime, items, ...rest } = input;
  return {
    ...rest,
    departmentId: input.departmentId ?? null,
    branchId: input.branchId ?? null,
    verifierId: input.verifierId ?? null,
    reminderPatternId: input.reminderPatternId ?? null,
    perBranch: input.perBranch?.length
      ? (input.perBranch as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull,
    dueMin: hhmmToMinutes(dueTime),
    items: items as unknown as Prisma.InputJsonValue,
    frequency: input.frequency as unknown as Prisma.InputJsonValue,
  };
}

export async function createMaster(tx: Tx, actor: Actor, input: ChecklistMasterInput) {
  if (!can(actor, 'checklist.edit')) throw new AppError(403, 'FORBIDDEN', "You can't set up checklists");
  await checkPeople(tx, actor.companyId, [...input.doerIds, ...(input.verifierId ? [input.verifierId] : [])]);
  await checkBranchPlans(tx, actor.companyId, input.perBranch);
  const code = formatNumber('CHK', await nextCounter(tx, actor.companyId, 'checklist'));
  const m = await tx.checklistMaster.create({
    data: { ...masterData(input), companyId: actor.companyId, code, createdById: actor.userId },
  });
  await writeAudit(
    tx,
    { ...actor, actorId: actor.userId },
    {
      action: 'checklist.master_created',
      entityType: 'checklist_master',
      entityId: m.id,
      after: masterOut(m),
    },
  );
  await emitEvent(
    tx,
    { companyId: actor.companyId, actorId: actor.userId },
    { name: 'checklist.master_changed', entityType: 'checklist_master', entityId: m.id },
  );
  return masterOut(m);
}

/** Edits apply to runs created from now on; existing runs keep their items (records are never rewritten). */
export async function updateMaster(tx: Tx, actor: Actor, id: string, input: Partial<ChecklistMasterInput>) {
  if (!can(actor, 'checklist.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change checklists");
  const before = await tx.checklistMaster.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
  });
  if (!before) throw notFound('Checklist');
  if (input.doerIds || input.verifierId)
    await checkPeople(tx, actor.companyId, [
      ...(input.doerIds ?? []),
      ...(input.verifierId ? [input.verifierId] : []),
    ]);
  if (input.perBranch) await checkBranchPlans(tx, actor.companyId, input.perBranch);
  const merged = { ...masterOut(before), ...input } as unknown as ChecklistMasterInput;
  const m = await tx.checklistMaster.update({ where: { id }, data: masterData(merged) });
  await writeAudit(
    tx,
    { ...actor, actorId: actor.userId },
    {
      action: 'checklist.master_changed',
      entityType: 'checklist_master',
      entityId: id,
      before: masterOut(before),
      after: masterOut(m),
    },
  );
  await emitEvent(
    tx,
    { companyId: actor.companyId, actorId: actor.userId },
    { name: 'checklist.master_changed', entityType: 'checklist_master', entityId: id },
  );
  return masterOut(m);
}

export async function deleteMaster(tx: Tx, actor: Actor, id: string) {
  if (!can(actor, 'checklist.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change checklists");
  const before = await tx.checklistMaster.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
  });
  if (!before) throw notFound('Checklist');
  await tx.checklistMaster.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
  await writeAudit(
    tx,
    { ...actor, actorId: actor.userId },
    {
      action: 'checklist.master_deleted',
      entityType: 'checklist_master',
      entityId: id,
      before: masterOut(before),
    },
  );
  return { ok: true };
}

export type RunScope = 'mine' | 'all';

export async function runWhere(
  db: Db | Tx,
  actor: Actor,
  scope: RunScope,
): Promise<Prisma.ChecklistRunWhereInput> {
  // Runs of a deleted checklist stay in the database as history but drop out of everyday lists.
  const base = { companyId: actor.companyId, master: { deletedAt: null } };
  if (scope === 'all' && can(actor, 'checklist.admin')) return base;
  const people = scope === 'all' ? await teamOf(db, actor.companyId, actor.userId) : [];
  return {
    ...base,
    OR: [
      { doerId: actor.userId },
      { verifierId: actor.userId },
      ...(people.length ? [{ doerId: { in: people } }] : []),
    ],
  };
}

function runRoles(actor: Actor, run: ChecklistRun) {
  const roles: ('doer' | 'verifier' | 'admin')[] = [];
  if (run.doerId === actor.userId) roles.push('doer');
  if (run.verifierId === actor.userId) roles.push('verifier');
  if (can(actor, 'checklist.admin')) roles.push('admin');
  return roles;
}

async function loadRun(tx: Tx, actor: Actor, runId: string) {
  const run = await tx.checklistRun.findFirst({
    where: { AND: [await runWhere(tx, actor, 'all'), { id: runId }] },
    include: { items: { orderBy: { sortOrder: 'asc' } }, master: { select: { name: true } } },
  });
  if (!run) throw notFound('Checklist');
  return run;
}

export async function runDetail(db: Db, actor: Actor, runId: string) {
  return db.$transaction(async (tx) => {
    const run = await loadRun(tx, actor, runId);
    const s = await moduleSettings(tx, actor.companyId, 'checklist');
    const ids = run.items.map((i) => i.attachmentId).filter((x): x is string => Boolean(x));
    const files = await tx.attachment.findMany({
      where: { id: { in: ids } },
      select: { id: true, mime: true },
    });
    return {
      ...run,
      proofRequired: s.photoVoiceProof,
      files: files.map((f) => ({ ...f, url: `/api/files/${f.id}` })),
      roles: runRoles(actor, run),
    };
  });
}

/** Tick or untick one item. Photo/voice/value are required when the item asks for them (and the setting is on). */
export async function tickItem(
  db: Db,
  actor: Actor,
  runId: string,
  input: {
    itemId: string;
    done: boolean;
    value?: string | null;
    note?: string | null;
    attachmentId?: string | null;
  },
) {
  return db.$transaction(async (tx) => {
    const run = await loadRun(tx, actor, runId);
    const s = await moduleSettings(tx, actor.companyId, 'checklist');
    transition(checklistMachine, {
      from: run.status as RunStatus,
      action: 'tick',
      roles: runRoles(actor, run),
      ctx: { verifierStep: s.verifierStep, hasVerifier: Boolean(run.verifierId), allItemsDone: false },
    });
    const item = run.items.find((i) => i.id === input.itemId);
    if (!item) throw notFound('Item');
    if (input.attachmentId)
      await attachUploads(tx, actor.companyId, actor.userId, [input.attachmentId], 'checklist_item', item.id);
    const attachmentId = input.attachmentId ?? item.attachmentId;
    if (input.done) {
      if (item.requireValue && !(input.value ?? item.value))
        throw new AppError(400, 'VALIDATION_FAILED', `Enter the value for "${item.text}"`);
      if (s.photoVoiceProof && (item.requirePhoto || item.requireVoice) && !attachmentId) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          `"${item.text}" needs a ${item.requirePhoto ? 'photo' : 'voice note'}`,
        );
      }
    }
    await tx.checklistRunItem.update({
      where: { id: item.id },
      data: {
        done: input.done,
        doneAt: input.done ? new Date() : null,
        value: input.value ?? item.value,
        note: input.note ?? item.note,
        attachmentId,
      },
    });
    const itemsDone = await tx.checklistRunItem.count({ where: { runId: run.id, done: true } });
    return tx.checklistRun.update({ where: { id: run.id }, data: { itemsDone } });
  });
}

export async function runAction(
  db: Db,
  actor: Actor,
  runId: string,
  input: { action: 'submit'; note?: string } | { action: 'verify' } | { action: 'reject'; comment: string },
) {
  return db.$transaction(async (tx) => {
    const run = await loadRun(tx, actor, runId);
    const s = await moduleSettings(tx, actor.companyId, 'checklist');
    const ctx = {
      verifierStep: s.verifierStep,
      hasVerifier: Boolean(run.verifierId) && run.verifierId !== run.doerId,
      allItemsDone: run.itemsDone >= run.itemsTotal,
    };
    const step = transition(checklistMachine, {
      from: run.status as RunStatus,
      action: input.action,
      roles: runRoles(actor, run),
      ctx,
    });
    const now = new Date();
    const data: Prisma.ChecklistRunUpdateInput = { status: step.to };
    if (input.action === 'submit') Object.assign(data, { submittedAt: now, note: input.note ?? run.note });
    if (input.action === 'verify') data.verifiedAt = now;
    if (input.action === 'reject') Object.assign(data, { submittedAt: null, note: input.comment });
    const updated = await tx.checklistRun.update({ where: { id: run.id }, data });
    const payload = {
      doerId: run.doerId,
      verifierId: run.verifierId,
      checklist: run.master.name,
      due: run.plannedAt.toISOString(),
      link: `/checklists?run=${run.id}`,
      comment: input.action === 'reject' ? input.comment : undefined,
      // Photos taken on the items travel with the "please verify" message.
      proof:
        input.action === 'submit'
          ? (
              await tx.checklistRunItem.findMany({
                where: { runId: run.id, attachmentId: { not: null } },
                select: { attachmentId: true },
                take: 5,
              })
            ).map((i) => i.attachmentId!)
          : undefined,
    };
    const event =
      input.action === 'submit'
        ? step.to === 'PENDING_VERIFY'
          ? 'checklist.completed'
          : null
        : input.action === 'verify'
          ? 'checklist.verified'
          : 'checklist.rejected';
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: `checklist.${input.action}`,
        entityType: 'checklist_run',
        entityId: run.id,
        before: { status: run.status },
        after: { status: step.to },
      },
    );
    if (event)
      await emitEvent(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        { name: event, entityType: 'checklist_run', entityId: run.id, payload },
      );
    return updated;
  });
}
