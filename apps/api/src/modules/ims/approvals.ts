import type { Db } from '@mono/db';
import { adjustMachine, transition, type MoveType } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { canApprove, ctxOf, imsRulesOf, routedApprove } from './access';
import { applyMove } from './moves';
import { noteStepDecision } from './step-reversal';

/**
 * Approve or reject a move that waits for an approver: an adjustment (damaged, expired, lost, found, counted), a
 * line a process step could not issue, or a reversal that could not be applied. With "any one of them" off, every
 * listed approver must say yes. Approving applies the move as it stands — stock still can't go below zero.
 */
export async function decideAdjustment(
  db: Db,
  actor: Actor,
  id: string,
  approve: boolean,
  note?: string | null,
) {
  const move = await db.stockMove.findFirst({
    where: { id, companyId: actor.companyId, OR: [{ type: 'ADJUST' }, { refType: 'fms_record' }] },
  });
  if (!move) throw notFound('Adjustment');
  const rules = await imsRulesOf(db, actor.companyId);
  const routed = (await routedApprove(db, actor, move)) !== null;
  if (!(await canApprove(db, actor, rules, move)))
    throw new AppError(403, 'FORBIDDEN', "You aren't one of the approvers for stock adjustments");
  const to = transition(adjustMachine, {
    from: move.status as 'PENDING',
    action: approve ? 'approve' : 'reject',
    roles: ['approver'],
    ctx: { own: move.createdById === actor.userId, neverOwn: rules.people.neverOwn },
  }).to;
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const approvals = [...new Set([...move.approvals, actor.userId])];
    // "Every approver": wait for all listed approvers (the owner's yes, when not listed, is final).
    const listed = rules.people.approverIds;
    const missing = listed.filter((a) => !approvals.includes(a)).length;
    if (!routed && approve && !rules.people.anyOne && listed.includes(actor.userId) && missing > 0) {
      await tx.stockMove.update({ where: { id }, data: { approvals } });
      await writeAudit(tx, ctx, {
        action: 'ims.adjust_approved_part',
        entityType: 'stock_move',
        entityId: id,
      });
      return { status: 'PENDING', waitingFor: missing };
    }
    const decided = {
      decidedById: actor.userId,
      decidedAt: new Date(),
      decisionNote: note ?? null,
      approvals,
    };
    if (to === 'APPLIED') {
      await tx.stockMove.update({ where: { id }, data: decided });
      await applyMove(
        tx,
        ctx,
        {
          itemId: move.itemId,
          type: move.type as MoveType,
          delta: Number(move.qty),
          reason: move.reason,
          refType: move.refType,
          refId: move.refId,
          at: move.at,
          // Phase 13: where it was asked for, which batch, and a write-off may take an expired batch.
          locationId: move.locationId,
          batchId: move.batchId,
          rate: move.rate,
          qty2: move.qty2 === null ? null : Number(move.qty2),
          allowExpired: Number(move.qty) < 0,
        },
        id,
      );
    } else {
      await tx.stockMove.update({ where: { id }, data: { ...decided, status: 'REJECTED' } });
    }
    await writeAudit(tx, ctx, {
      action: approve ? 'ims.adjust_approved' : 'ims.adjust_rejected',
      entityType: 'stock_move',
      entityId: id,
      after: { note },
    });
    // A line of a process step: the record's history says what the approver decided.
    if (move.refType === 'fms_record') await noteStepDecision(tx, move, approve, actor.userId, note);
    return { status: to };
  });
}
