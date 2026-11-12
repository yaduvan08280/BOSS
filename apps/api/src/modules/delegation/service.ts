import type { Db, Task, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  delegationMachine,
  initialTaskStatus,
  STATUS_KEEPING_ACTIONS,
  transition,
  type DelegationSettings,
  type TaskActionInput,
  type TaskCreateInput,
  type TaskRole,
  type TaskStatus,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { writeAudit } from '../../lib/audit';
import { emitEvent } from '../../lib/events';
import { attachUploads, can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { homeBranchOf } from '../branches/reach';

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);
const link = (t: { id: string }) => `/delegation?task=${t.id}`;

/**
 * The verifier who actually has to check it: the task's own, else the EA (or creator) when "EA verifies" is on.
 * Nobody verifies their own work, so when that person is the doer there is no verification step at all.
 */
export function effectiveVerifier(
  t: Pick<Task, 'verifierId' | 'creatorId' | 'doerId'>,
  s: DelegationSettings,
): string | null {
  const v = t.verifierId ?? (s.eaVerifies ? (s.eaUserId ?? t.creatorId) : null);
  return v === t.doerId ? null : v;
}

export function rolesFor(actor: Actor, t: Task, s: DelegationSettings): TaskRole[] {
  const roles: TaskRole[] = ['any'];
  if (t.doerId === actor.userId) roles.push('doer');
  if (t.creatorId === actor.userId) roles.push('creator');
  if (effectiveVerifier(t, s) === actor.userId) roles.push('verifier');
  if (can(actor, 'delegation.admin')) roles.push('admin');
  return roles;
}

export async function checkPerson(tx: Tx, companyId: string, id: string, what: string) {
  const u = await tx.user.findFirst({
    where: { id, companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!u) throw new AppError(400, 'VALIDATION_FAILED', `${what} is not an active person`);
}

export async function log(
  tx: Tx,
  t: Task,
  actorId: string,
  type: string,
  extra: {
    note?: string | null;
    fromUserId?: string;
    toUserId?: string;
    fromStatus?: string;
    toStatus?: string;
    fromDate?: Date;
    toDate?: Date;
  } = {},
) {
  await tx.taskEvent.create({ data: { companyId: t.companyId, taskId: t.id, actorId, type, ...extra } });
}

/** People who did an earlier part and passed the task on: they keep seeing it and hear about its notes. */
export async function pastDoers(db: Db | Tx, companyId: string, taskId: string): Promise<string[]> {
  const rows = await db.taskEvent.findMany({
    where: { companyId, taskId, type: 'passed_on' },
    select: { fromUserId: true },
    distinct: ['fromUserId'],
  });
  return rows.flatMap((r) => (r.fromUserId ? [r.fromUserId] : []));
}

/**
 * Files sent along with a message: the newest (up to 5) one person attached to a record.
 * "New task" carries the creator's brief; "done" / "fixed" carry the doer's proof — never each other's.
 */
export async function proofOf(
  tx: Tx,
  companyId: string,
  entityType: string,
  entityId: string,
  uploadedById: string,
) {
  const files = await tx.attachment.findMany({
    where: { companyId, entityType, entityId, uploadedById, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { id: true },
  });
  return files.map((f) => f.id);
}

/** Create one task: number, initial status, attachments, history, audit and the "assigned" event. */
export async function createTask(
  tx: Tx,
  actor: Actor,
  input: Omit<TaskCreateInput, 'attachmentIds'> & {
    attachmentIds?: string[];
    source?: string;
    sourceId?: string;
  },
) {
  if (!can(actor, 'delegation.create')) throw new AppError(403, 'FORBIDDEN', "You can't give tasks");
  await checkPerson(tx, actor.companyId, input.doerId, 'The doer');
  if (input.verifierId) await checkPerson(tx, actor.companyId, input.verifierId, 'The verifier');
  const s = await moduleSettings(tx, actor.companyId, 'delegation');
  const plannedAt = new Date(input.plannedAt);
  const status = initialTaskStatus(s, input.doerId, actor.userId);
  const number = await nextCounter(tx, actor.companyId, 'task');
  const task = await tx.task.create({
    data: {
      companyId: actor.companyId,
      // The work happens where the doer is: the task belongs to the doer's home branch (phase 12).
      branchId: await homeBranchOf(tx, actor.companyId, input.doerId),
      number,
      description: input.description,
      doerId: input.doerId,
      creatorId: actor.userId,
      verifierId: input.verifierId ?? null,
      plannedAt,
      originalPlannedAt: plannedAt,
      status,
      requireProof: input.requireProof ?? false,
      source: input.source ?? 'web',
      sourceId: input.sourceId ?? null,
      acceptedAt: status === 'OPEN' ? new Date() : null,
    },
  });
  await attachUploads(tx, actor.companyId, actor.userId, input.attachmentIds ?? [], 'task', task.id);
  await log(tx, task, actor.userId, 'created', { toStatus: status });
  await writeAudit(
    tx,
    { ...actor, actorId: actor.userId },
    { action: 'task.created', entityType: 'task', entityId: task.id, after: task },
  );
  await emitEvent(
    tx,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      name: 'delegation.assigned',
      entityType: 'task',
      entityId: task.id,
      payload: {
        doerId: task.doerId,
        creatorId: task.creatorId,
        verifierId: effectiveVerifier(task, s),
        number: task.number,
        title: short(task.description),
        due: task.plannedAt.toISOString(),
        link: link(task),
        telegramActions: status === 'AWAITING_ACCEPTANCE' ? ['accept'] : ['done', 'move'],
        // The brief the creator attached goes with the message (photos into Telegram).
        files: await proofOf(tx, actor.companyId, 'task', task.id, actor.userId),
      },
    },
  );
  return task;
}

/**
 * Every change of a task goes through here: the state machine decides if it's allowed,
 * then history, audit and the domain event that drives notifications.
 */
export async function actOnTask(db: Db, actor: Actor, taskId: string, input: TaskActionInput): Promise<Task> {
  return db.$transaction(async (tx) => {
    const t = await tx.task.findFirst({ where: { id: taskId, companyId: actor.companyId, deletedAt: null } });
    if (!t) throw notFound('Task');
    const s = await moduleSettings(tx, actor.companyId, 'delegation');
    const roles = rolesFor(actor, t, s);
    // People outside the task (not the doer's HOD, nor someone who did an earlier part) can't even see it.
    const helpers = await pastDoers(tx, actor.companyId, t.id);
    if (
      roles.length === 1 &&
      !helpers.includes(actor.userId) &&
      !(await teamOf(tx, actor.companyId, actor.userId)).includes(t.doerId)
    )
      throw notFound('Task');
    const verifier = effectiveVerifier(t, s);
    const ctx = {
      doerMustAccept: s.doerMustAccept,
      allowReopen: s.allowReopen,
      needsVerify: Boolean(verifier),
      toCreator: 'doerId' in input && input.doerId === t.creatorId,
    };
    const step = transition(delegationMachine, {
      from: t.status as TaskStatus,
      action: input.action,
      roles: rolesFor(actor, t, s),
      ctx,
    });
    const now = new Date();
    const keep = STATUS_KEEPING_ACTIONS.includes(input.action);
    const to = keep ? (t.status as TaskStatus) : step.to;
    const data: Record<string, unknown> = { status: to };
    let event: string | null = null;
    const payload: Record<string, unknown> = {
      doerId: t.doerId,
      creatorId: t.creatorId,
      verifierId: verifier,
      number: t.number,
      title: short(t.description),
      due: t.plannedAt.toISOString(),
      link: link(t),
    };

    switch (input.action) {
      case 'accept':
        data.acceptedAt = now;
        event = 'delegation.accepted';
        break;
      case 'decline':
        payload.reason = input.reason;
        event = 'delegation.declined';
        await log(tx, t, actor.userId, 'comment', { note: input.reason });
        break;
      case 'moveDate': {
        const next = new Date(input.plannedAt);
        data.plannedAt = next;
        data.revisionCount = t.revisionCount + 1;
        data.lastOverdueNotifiedAt = null;
        payload.due = next.toISOString();
        payload.reason = input.reason;
        event = 'delegation.date_moved';
        await log(tx, t, actor.userId, 'date_moved', {
          note: input.reason,
          fromDate: t.plannedAt,
          toDate: next,
        });
        break;
      }
      case 'addFollowUp':
        payload.note = input.note;
        event = 'delegation.follow_up';
        await log(tx, t, actor.userId, 'follow_up', { note: input.note });
        break;
      case 'addNote':
        payload.note = input.note;
        payload.helperIds = helpers;
        event = 'delegation.note';
        await log(tx, t, actor.userId, 'note', { note: input.note });
        break;
      case 'passOn': {
        if (input.doerId === t.doerId)
          throw new AppError(400, 'VALIDATION_FAILED', 'Pick the person who does the next part');
        await checkPerson(tx, actor.companyId, input.doerId, 'The next person');
        const next = new Date(input.plannedAt);
        if (next.getTime() < now.getTime() - 5 * 60_000)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'Pick a time for the next part that has not passed yet',
          );
        await attachUploads(tx, actor.companyId, actor.userId, input.attachmentIds, 'task', t.id);
        // A new part, planned on its own: not a revision of the date.
        data.doerId = input.doerId;
        data.plannedAt = next;
        data.acceptedAt = to === 'OPEN' ? now : null;
        data.lastOverdueNotifiedAt = null;
        data.passCount = t.passCount + 1;
        payload.doerId = input.doerId;
        payload.verifierId = effectiveVerifier({ ...t, doerId: input.doerId }, s);
        payload.due = next.toISOString();
        payload.note = input.note;
        payload.telegramActions = to === 'AWAITING_ACCEPTANCE' ? ['accept'] : ['done', 'move'];
        payload.telegramActionsFor = input.doerId;
        // The next person gets the creator's brief and what was attached for this part.
        payload.files = [
          ...(await proofOf(tx, t.companyId, 'task', t.id, t.creatorId)),
          ...(t.doerId === t.creatorId ? [] : await proofOf(tx, t.companyId, 'task', t.id, t.doerId)),
        ];
        event = 'delegation.passed_on';
        await log(tx, t, actor.userId, 'passed_on', {
          note: input.note,
          fromUserId: t.doerId,
          toUserId: input.doerId,
          fromDate: t.plannedAt,
          toDate: next,
        });
        break;
      }
      case 'markDone': {
        const linked = await attachUploads(
          tx,
          actor.companyId,
          actor.userId,
          input.attachmentIds,
          'task',
          t.id,
        );
        if (
          t.requireProof &&
          !linked &&
          !(await tx.attachment.count({
            where: { entityType: 'task', entityId: t.id, uploadedById: t.doerId, deletedAt: null },
          }))
        ) {
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'This task needs a photo or file as proof before it can be marked done',
          );
        }
        data.doneAt = now;
        data.doneNote = input.note;
        if (to === 'DONE') data.verifiedAt = null;
        payload.note = input.note;
        payload.telegramActions = to === 'PENDING_VERIFY' ? ['verify'] : [];
        // The verifier sees the proof right in the message (Telegram gets the photos themselves).
        payload.proof = await proofOf(tx, t.companyId, 'task', t.id, t.doerId);
        event = 'delegation.done';
        await log(tx, t, actor.userId, 'comment', { note: input.note });
        break;
      }
      case 'verify':
        data.verifiedAt = now;
        event = 'delegation.verified';
        if (input.comment) await log(tx, t, actor.userId, 'comment', { note: input.comment });
        break;
      case 'reject':
      case 'reopen':
        data.doneAt = null;
        data.verifiedAt = null;
        data.reopenCount = t.reopenCount + 1;
        data.lastOverdueNotifiedAt = null;
        payload.comment = input.comment;
        event = input.action === 'reject' ? 'delegation.rejected' : 'delegation.reopened';
        await log(tx, t, actor.userId, 'comment', { note: input.comment });
        break;
      case 'reassign':
        await checkPerson(tx, actor.companyId, input.doerId, 'The doer');
        await log(tx, t, actor.userId, 'reassigned', { fromUserId: t.doerId, toUserId: input.doerId });
        data.doerId = input.doerId;
        data.acceptedAt = to === 'OPEN' ? now : null;
        if (input.plannedAt) data.plannedAt = new Date(input.plannedAt);
        payload.doerId = input.doerId;
        payload.due = input.plannedAt ?? payload.due;
        payload.telegramActions = to === 'AWAITING_ACCEPTANCE' ? ['accept'] : ['done', 'move'];
        payload.files = await proofOf(tx, t.companyId, 'task', t.id, t.creatorId);
        event = 'delegation.assigned';
        break;
      case 'cancel':
        data.cancelledAt = now;
        payload.reason = input.reason;
        event = 'delegation.cancelled';
        if (input.reason) await log(tx, t, actor.userId, 'comment', { note: input.reason });
        break;
    }

    const updated = await tx.task.update({ where: { id: t.id }, data });
    if (to !== t.status) await log(tx, t, actor.userId, 'status', { fromStatus: t.status, toStatus: to });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: `task.${input.action}`, entityType: 'task', entityId: t.id, before: t, after: updated },
    );
    if (event)
      await emitEvent(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        { name: event, entityType: 'task', entityId: t.id, payload },
      );
    return updated;
  });
}
