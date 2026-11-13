import type { Db } from '@mono/db';
import { checkMachine, transition, type CheckStatus } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { applyCredit, creditLeft } from '../money/credit';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { checkView, creditOf, type Payment } from './checks-read';
import { settleOrder } from './payments';
import { loadOrder, needOpenDay } from './pos-core';

/**
 * Phase 16 — a table deposit against the dinner's bill. The booking's ADVANCE paper is set against the check's
 * invoice (as much as both allow); the rest of the bill is paid as usual, and anything left of the deposit stays
 * the guest's unused advance.
 */
export async function advanceFor(db: Db, companyId: string, orderId: string) {
  const order = await db.posOrder.findFirst({ where: { id: orderId, companyId } });
  if (!order?.reservationId) return null;
  const r = await db.reservation.findFirst({ where: { id: order.reservationId, companyId } });
  if (!r?.depositBillId || !['PAID', 'USED'].includes(r.depositState ?? '')) return null;
  const left = await db.$transaction((tx) => creditLeft(tx, companyId, r.depositBillId!));
  return left > 0 ? { reservationId: r.id, advanceId: r.depositBillId, left } : null;
}

export async function useAdvance(db: Db, actor: Actor, checkId: string) {
  need(actor, 'hosp.create', "You can't take payments");
  const check = await db.posCheck.findFirst({ where: { id: checkId, companyId: actor.companyId } });
  if (!check) throw notFound('Bill');
  const { order, outlet } = await loadOrder(db, actor, check.orderId);
  if (check.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This bill is not open');
  await needOpenDay(db, outlet, check.businessDay);
  const advance = await advanceFor(db, actor.companyId, order.id);
  if (!advance) throw new AppError(409, 'CONFLICT', 'There is no deposit to use on this bill');
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
        mode: 'Deposit',
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
