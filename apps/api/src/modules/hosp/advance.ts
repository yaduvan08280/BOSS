import type { Db } from '@mono/db';
import { checkMachine, transition, type CheckStatus } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { applyCredit, creditLeft } from '../money/credit';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { checkView, creditOf, type Payment } from './checks-read';
import { settleOrder } from './settle';
import { loadOrder, needOpenDay } from './pos-core';

/**
 * An advance against a restaurant bill (P28). First the booking's own deposit (phase 16); else any plain advance
 * the order's party paid earlier (Money → an ADVANCE paper not tied to a booking, stay or event), oldest first.
 * The advance is set against the check's invoice (as much as both allow); the rest of the bill is paid as usual,
 * and anything left of the advance stays the party's unused credit.
 */
export async function advanceFor(db: Db, companyId: string, orderId: string) {
  const order = await db.posOrder.findFirst({ where: { id: orderId, companyId } });
  if (!order) return null;
  if (order.reservationId) {
    const r = await db.reservation.findFirst({ where: { id: order.reservationId, companyId } });
    if (r?.depositBillId && ['PAID', 'USED'].includes(r.depositState ?? '')) {
      const left = await db.$transaction((tx) => creditLeft(tx, companyId, r.depositBillId!));
      if (left > 0) return { reservationId: r.id as string | null, advanceId: r.depositBillId, left };
    }
  }
  if (!order.partyId) return null;
  const papers = await db.bill.findMany({
    where: {
      companyId,
      partyId: order.partyId,
      type: 'ADVANCE',
      sourceType: null,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    take: 50,
  });
  // A deposit taken for a booking is that booking's: it is never spent on another visit by this rule.
  const deposits = new Set(
    (
      await db.reservation.findMany({
        where: { companyId, depositBillId: { in: papers.map((b) => b.id) } },
        select: { depositBillId: true },
      })
    ).map((r) => r.depositBillId),
  );
  for (const paper of papers) {
    if (deposits.has(paper.id)) continue;
    const left = Number(paper.total - paper.settled);
    if (left > 0) return { reservationId: null as string | null, advanceId: paper.id, left };
  }
  return null;
}

export async function useAdvance(db: Db, actor: Actor, checkId: string) {
  need(actor, 'hosp.create', "You can't take payments");
  const check = await db.posCheck.findFirst({ where: { id: checkId, companyId: actor.companyId } });
  if (!check) throw notFound('Bill');
  const { order, outlet } = await loadOrder(db, actor, check.orderId);
  if (check.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This bill is not open');
  await needOpenDay(db, outlet, check.businessDay);
  const advance = await advanceFor(db, actor.companyId, order.id);
  if (!advance) throw new AppError(409, 'CONFLICT', 'There is no deposit or advance to use on this bill');
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: check.billId } });
    const due = Number(bill.total - bill.credited - bill.settled) - creditOf(check.payments);
    const used = await applyCredit(
      tx,
      actor.companyId,
      advance.advanceId,
      bill.id,
      Math.min(due, advance.left),
    );
    if (used <= 0) throw new AppError(409, 'CONFLICT', 'Nothing is left to pay on this bill');
    const taken: Payment[] = [
      ...((check.payments as Payment[] | null) ?? []),
      {
        modeId: '',
        mode: advance.reservationId ? 'Deposit' : 'Advance',
        kind: 'ADVANCE',
        amount: used,
        reference: null,
        receiptId: null,
        advanceId: advance.advanceId,
        billId: bill.id,
        byId: actor.userId,
        at: new Date().toISOString(),
      },
    ];
    const status = transition(checkMachine, {
      from: check.status as CheckStatus,
      action: 'settle',
      roles: ['cashier'],
      ctx: { due: due - used },
    }).to;
    await tx.posCheck.update({
      where: { id: check.id },
      data: { payments: taken, status, ...(status === 'PAID' ? { paidAt: new Date() } : {}) },
    });
    if (advance.reservationId)
      await tx.reservation.update({ where: { id: advance.reservationId }, data: { depositState: 'USED' } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.check_advance_used',
      entityType: 'pos_check',
      entityId: check.id,
      after: { advanceId: advance.advanceId, used, status },
    });
    const orderStatus = status === 'PAID' ? await settleOrder(tx, actor, outlet, order.id) : order.status;
    return { ...(await checkView(tx, outlet, check.id)), orderStatus };
  });
}
