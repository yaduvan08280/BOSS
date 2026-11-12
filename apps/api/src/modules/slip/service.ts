import type { Db, Slip, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  availableActions,
  slipEntryStatus,
  slipMachine,
  transition,
  type SlipActionInput,
  type SlipCreateInput,
  type SlipRole,
  type SlipSettings,
  type SlipStatus,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { createTask, proofOf } from '../delegation/service';
import { attachUploads, can, checkPerson, hodFor, ownerOf, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { chainFor } from '../branches/approvals';
import { homeBranchOf } from '../branches/reach';

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);
const link = (s: { id: string }) => `/help-slips?slip=${s.id}`;
const HOUR = 3600_000;

export const slipCtx = (s: SlipSettings) => ({
  receiverScreens: s.receiverScreens,
  approverStep: s.approverStep,
});

export function slipRoles(actor: Actor, slip: Slip): SlipRole[] {
  const roles: SlipRole[] = [];
  if (slip.raiserId === actor.userId) roles.push('raiser');
  if (slip.receiverId === actor.userId) roles.push('receiver');
  if (slip.approverId === actor.userId) roles.push('approver');
  if (can(actor, 'slip.admin')) roles.push('admin');
  return roles;
}

/** Whose move it is and by when (the time limits of §5.3), or null when nobody is being waited on. */
export function slipWaitingOn(
  slip: Pick<Slip, 'status' | 'raiserId' | 'receiverId' | 'approverId' | 'stepSince'>,
  s: SlipSettings,
): { userId: string; dueAt: Date } | null {
  const after = (h: number) => new Date(slip.stepSince.getTime() + h * HOUR);
  switch (slip.status as SlipStatus) {
    case 'SUBMITTED':
      // With the approver step off the receiver decides, within the decision time.
      return {
        userId: slip.receiverId,
        dueAt: after(s.approverStep ? s.receiverForwardHours : s.approverDecideHours),
      };
    case 'WITH_APPROVER':
      return { userId: slip.approverId, dueAt: after(s.approverDecideHours) };
    case 'RETURNED':
      return { userId: slip.raiserId, dueAt: after(s.receiverForwardHours) };
    case 'APPROVED':
    case 'REJECTED':
      return { userId: slip.raiserId, dueAt: after(s.raiserCloseHours) };
    default:
      return null;
  }
}

async function log(
  tx: Tx,
  slip: Slip,
  actorId: string | null,
  type: string,
  extra: { note?: string | null; fromStatus?: string; toStatus?: string } = {},
) {
  await tx.slipEvent.create({
    data: { companyId: slip.companyId, slipId: slip.id, actorId, type, ...extra },
  });
}

const payloadOf = (slip: Slip) => ({
  raiserId: slip.raiserId,
  receiverId: slip.receiverId,
  approverId: slip.approverId,
  accountableId: slip.accountableId,
  number: slip.number,
  problem: short(slip.problem),
  link: link(slip),
});

function checkSolutions(solutions: string[], s: SlipSettings) {
  if (solutions.length < s.solutionsRequired)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `Give at least ${s.solutionsRequired} solution${s.solutionsRequired > 1 ? 's' : ''}`,
    );
}

export async function createSlip(db: Db, actor: Actor, input: SlipCreateInput) {
  if (!can(actor, 'slip.create')) throw new AppError(403, 'FORBIDDEN', "You can't raise help slips");
  return db.$transaction(async (tx) => {
    const s = await moduleSettings(tx, actor.companyId, 'slip');
    checkSolutions(input.solutions, s);
    const owner = await ownerOf(tx, actor.companyId);
    // The owner's approval route (phase 12), when set: its first step screens the slip, the next one decides.
    const route = await chainFor(tx, actor.companyId, 'slip', { requesterId: actor.userId });
    const held = route?.steps.filter((x) => x.userIds.length).map((x) => x.userIds[0]!) ?? [];
    const receiverId = route
      ? (held[0] ?? owner)
      : (s.receiverUserId ?? (await hodFor(tx, actor.companyId, actor.userId)) ?? owner);
    const approverId = route ? (held[1] ?? owner) : (s.approverUserId ?? owner);
    if (!receiverId || !approverId)
      throw new AppError(409, 'CONFLICT', 'Set a receiver and an approver first');
    const status = slipEntryStatus(slipCtx(s));
    const slip = await tx.slip.create({
      data: {
        companyId: actor.companyId,
        branchId: await homeBranchOf(tx, actor.companyId, actor.userId),
        number: await nextCounter(tx, actor.companyId, 'slip'),
        problem: input.problem,
        raiserId: actor.userId,
        receiverId,
        approverId,
        accountableId:
          s.accountability === 'receiver'
            ? receiverId
            : s.accountability === 'approver'
              ? approverId
              : actor.userId,
        departmentId: input.departmentId ?? null,
        status,
        solutions: {
          create: input.solutions.map((text, position) => ({ companyId: actor.companyId, position, text })),
        },
      },
    });
    await attachUploads(tx, actor.companyId, actor.userId, input.attachmentIds, 'slip', slip.id);
    await log(tx, slip, actor.userId, 'created', { toStatus: status });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'slip.created', entityType: 'slip', entityId: slip.id, after: slip },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: status === 'WITH_APPROVER' ? 'slip.forwarded' : 'slip.submitted',
        entityType: 'slip',
        entityId: slip.id,
        payload: {
          ...payloadOf(slip),
          files: await proofOf(tx, slip.companyId, 'slip', slip.id, actor.userId),
        },
      },
    );
    return slip;
  });
}

async function visible(tx: Tx | Db, actor: Actor, slip: Slip) {
  if (slipRoles(actor, slip).length || slip.accountableId === actor.userId) return true;
  return (await teamOf(tx, actor.companyId, actor.userId)).includes(slip.raiserId);
}

/** Every change of a slip goes through the state machine, with history, audit and the event for notifications. */
export async function actOnSlip(db: Db, actor: Actor, slipId: string, input: SlipActionInput) {
  return db.$transaction(async (tx) => {
    const slip = await tx.slip.findFirst({
      where: { id: slipId, companyId: actor.companyId, deletedAt: null },
    });
    if (!slip || !(await visible(tx, actor, slip))) throw notFound('Help slip');
    const s = await moduleSettings(tx, actor.companyId, 'slip');
    const step = transition(slipMachine, {
      from: slip.status as SlipStatus,
      action: input.action,
      roles: slipRoles(actor, slip),
      ctx: slipCtx(s),
    });
    const now = new Date();
    const data: Record<string, unknown> = { status: step.to, stepSince: now, lateNotifiedAt: null };
    const payload: Record<string, unknown> = payloadOf(slip);
    let event: string | null = null;
    let note: string | null = null;

    switch (input.action) {
      case 'forward':
        note = input.note ?? null;
        event = 'slip.forwarded';
        break;
      case 'return':
        note = input.comment;
        data.returnCount = slip.returnCount + 1;
        payload.comment = input.comment;
        event = 'slip.returned';
        break;
      case 'resubmit': {
        if (input.problem) data.problem = input.problem;
        if (input.solutions) {
          checkSolutions(input.solutions, s);
          await tx.slipSolution.deleteMany({ where: { slipId: slip.id } });
          await tx.slipSolution.createMany({
            data: input.solutions.map((text, position) => ({
              companyId: slip.companyId,
              slipId: slip.id,
              position,
              text,
            })),
          });
        }
        if (input.problem) payload.problem = short(input.problem);
        event = step.to === 'WITH_APPROVER' ? 'slip.forwarded' : 'slip.submitted';
        break;
      }
      case 'approve': {
        let solution = input.ownSolution?.trim();
        if (input.solutionId) {
          const chosen = await tx.slipSolution.findFirst({
            where: { id: input.solutionId, slipId: slip.id },
          });
          if (!chosen) throw new AppError(400, 'VALIDATION_FAILED', 'Pick one of the solutions');
          solution = chosen.text;
          data.chosenSolutionId = chosen.id;
        } else if (solution) data.ownSolution = solution;
        if (!solution) throw new AppError(400, 'VALIDATION_FAILED', 'Pick a solution or write your own');
        await checkPerson(tx, actor.companyId, input.doerId, 'The doer');
        // The decision becomes a delegation task, linked both ways.
        const task = await createTask(tx, actor, {
          doerId: input.doerId,
          plannedAt: input.plannedAt,
          description: `Help slip #${slip.number}: ${solution}`,
          verifierId: null,
          requireProof: false,
          source: 'slip',
          sourceId: slip.id,
        });
        Object.assign(data, {
          taskId: task.id,
          decisionNote: input.note ?? null,
          decidedById: actor.userId,
          decidedAt: now,
        });
        note = input.note ?? null;
        payload.decision = `Approved — ${short(solution)} (task #${task.number})`;
        event = 'slip.decided';
        break;
      }
      case 'reject':
        Object.assign(data, { decisionNote: input.reason, decidedById: actor.userId, decidedAt: now });
        note = input.reason;
        payload.decision = `Rejected — ${input.reason}`;
        event = 'slip.decided';
        break;
      case 'close':
        data.closedAt = now;
        note = input.note ?? null;
        event = 'slip.closed';
        break;
      case 'withdraw':
        data.closedAt = now;
        note = input.reason ?? null;
        event = 'slip.withdrawn';
        break;
    }

    const updated = await tx.slip.update({ where: { id: slip.id }, data });
    if (note) await log(tx, slip, actor.userId, 'comment', { note });
    if (step.to !== slip.status)
      await log(tx, slip, actor.userId, 'status', { fromStatus: slip.status, toStatus: step.to });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: `slip.${input.action}`, entityType: 'slip', entityId: slip.id, before: slip, after: updated },
    );
    if (event)
      await emitEvent(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        { name: event, entityType: 'slip', entityId: slip.id, payload },
      );
    return updated;
  });
}

/** System close (worker): decided slips the raiser left open past the time limit. */
export async function autoCloseSlip(tx: Tx, slip: Slip) {
  transition(slipMachine, {
    from: slip.status as SlipStatus,
    action: 'close',
    roles: ['system'],
    ctx: { receiverScreens: true, approverStep: true },
  });
  const now = new Date();
  const res = await tx.slip.updateMany({
    where: { id: slip.id, status: slip.status },
    data: { status: 'CLOSED', closedAt: now, stepSince: now },
  });
  if (!res.count) return false;
  await log(tx, slip, null, 'status', {
    fromStatus: slip.status,
    toStatus: 'CLOSED',
    note: 'Closed automatically',
  });
  await emitEvent(
    tx,
    { companyId: slip.companyId, actorId: null },
    { name: 'slip.closed', entityType: 'slip', entityId: slip.id, payload: payloadOf(slip) },
  );
  return true;
}

export async function slipDetail(db: Db, actor: Actor, id: string) {
  const slip = await db.slip.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    include: {
      solutions: { orderBy: { position: 'asc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!slip || !(await visible(db, actor, slip))) throw notFound('Help slip');
  const s = await moduleSettings(db, actor.companyId, 'slip');
  const [files, task] = await Promise.all([
    db.attachment.findMany({
      where: { companyId: actor.companyId, entityType: 'slip', entityId: slip.id, deletedAt: null },
      select: { id: true, originalName: true, mime: true, size: true },
    }),
    slip.taskId
      ? db.task.findFirst({
          where: { id: slip.taskId },
          select: { id: true, number: true, status: true, doerId: true },
        })
      : null,
  ]);
  return {
    ...slip,
    files: files.map((f) => ({ ...f, url: `/api/files/${f.id}` })),
    task,
    waitingOn: slipWaitingOn(slip, s),
    solutionsRequired: s.solutionsRequired,
    delegateWithinHours: s.delegateWithinHours,
    actions: availableActions(slipMachine, slip.status as SlipStatus, slipRoles(actor, slip), slipCtx(s)),
  };
}
