import type { Db } from '@mono/db';
import { nextStepKey } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { releaseForm } from '../forms';
import { can, checkPerson, type Actor } from '../work/actor';
import { closeRecord, contextFor, log, openStep, payloadOf } from './engine';

/** Give the open step to someone else (coordinator, problem solver, admin). */
export async function reassignStep(db: Db, actor: Actor, stepId: string, doerId: string, reason?: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.fmsRecordStep.findFirst({ where: { id: stepId, companyId: actor.companyId } });
    if (!row || row.status !== 'OPEN') throw notFound('Open step');
    const record = await tx.fmsRecord.findUniqueOrThrow({ where: { id: row.recordId } });
    const ctx = await contextFor(tx, record.flowId, record.flowVersionId, actor.userId);
    const f = ctx.flow;
    if (
      ![f.coordinatorId, f.coordinatorBackupId, f.solverId, f.solverBackupId].includes(actor.userId) &&
      !can(actor, 'fms.admin')
    )
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the coordinator, the problem solver or an admin can reassign',
      );
    await checkPerson(tx, actor.companyId, doerId, 'The new doer');
    await tx.fmsRecordStep.update({
      where: { id: row.id },
      data: {
        doerId,
        originalDoerId: row.originalDoerId ?? row.doerId,
        lateNotifiedAt: null,
        solverNotifiedAt: null,
      },
    });
    await log(tx, record, 'reassigned', {
      stepKey: row.stepKey,
      actorId: actor.userId,
      note: reason ?? null,
      data: { from: row.doerId, to: doerId },
    });
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'fms.step_assigned',
        entityType: 'fms_step',
        entityId: row.id,
        payload: payloadOf(ctx, record, { doerId, step: row.stepName, due: row.plannedAt.toISOString() }),
      },
    );
    return { ok: true };
  });
}

/** Hold, resume, close or cancel a record (coordinator, problem solver, admin). */
export async function recordAction(
  db: Db,
  actor: Actor,
  recordId: string,
  action: 'hold' | 'resume' | 'close' | 'cancel',
  reason?: string,
) {
  return db.$transaction(async (tx) => {
    const record = await tx.fmsRecord.findFirst({
      where: { id: recordId, companyId: actor.companyId, deletedAt: null },
    });
    if (!record) throw notFound('Record');
    const ctx = await contextFor(tx, record.flowId, record.flowVersionId, actor.userId);
    const f = ctx.flow;
    if (
      ![f.coordinatorId, f.coordinatorBackupId, f.solverId, f.solverBackupId].includes(actor.userId) &&
      !can(actor, 'fms.admin')
    )
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the coordinator, the problem solver or an admin can do this',
      );
    const allowed: Record<typeof action, string[]> = {
      hold: ['RUNNING'],
      resume: ['ON_HOLD'],
      close: ['RUNNING', 'ON_HOLD'],
      cancel: ['RUNNING', 'ON_HOLD'],
    };
    if (!allowed[action].includes(record.status))
      throw new AppError(409, 'CONFLICT', `Can't ${action} a ${record.status.toLowerCase()} record`);
    if ((action === 'hold' || action === 'cancel') && !(reason ?? '').trim())
      throw new AppError(400, 'VALIDATION_FAILED', 'Say why');
    if (action === 'close') {
      await tx.fmsRecordStep.updateMany({
        where: { recordId, status: 'OPEN' },
        data: { status: 'SKIPPED', doneAt: new Date() },
      });
      await closeRecord(tx, ctx, record, actor.userId);
      if (reason) await log(tx, record, 'note', { actorId: actor.userId, note: reason });
      return { ok: true };
    }
    const status = action === 'hold' ? 'ON_HOLD' : action === 'resume' ? 'RUNNING' : 'CANCELLED';
    await tx.fmsRecord.update({
      where: { id: recordId },
      data: {
        status,
        holdReason: action === 'hold' ? reason : null,
        closedAt: action === 'cancel' ? new Date() : null,
      },
    });
    if (action === 'cancel') {
      await tx.fmsRecordStep.updateMany({
        where: { recordId, status: 'OPEN' },
        data: { status: 'SKIPPED', doneAt: new Date() },
      });
      await releaseForm(tx, {
        companyId: record.companyId,
        owner: { kind: 'flow', id: record.flowId },
        recordId,
      });
    }
    await log(tx, record, action === 'hold' ? 'hold' : action === 'resume' ? 'resumed' : 'cancelled', {
      actorId: actor.userId,
      note: reason ?? null,
    });
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: `fms.record_${action}`,
        entityType: 'fms_record',
        entityId: recordId,
        payload: payloadOf(ctx, record, { reason }),
      },
    );
    return { ok: true };
  });
}

/** Worker: an AUTO webhook step finished (or failed for good) — move the record on. */
export async function finishAutoStep(db: Db, stepId: string, note: string) {
  return db.$transaction(async (tx) => {
    const row = await tx.fmsRecordStep.findUniqueOrThrow({ where: { id: stepId } });
    if (row.status !== 'OPEN') return;
    const record = await tx.fmsRecord.findUniqueOrThrow({ where: { id: row.recordId } });
    const ctx = await contextFor(tx, record.flowId, record.flowVersionId, null);
    const now = new Date();
    await tx.fmsRecordStep.update({ where: { id: row.id }, data: { status: 'DONE', doneAt: now, note } });
    await log(tx, record, 'auto', { stepKey: row.stepKey, note });
    if (record.status === 'RUNNING') await openStep(tx, ctx, record, nextStepKey(ctx.def, row.stepKey), now);
  });
}
