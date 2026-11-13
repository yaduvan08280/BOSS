import type { Tx } from '@mono/db';
import { AppError, notFound } from '../../lib/errors';
import { dueOf, settle } from './bills';

/**
 * Money already taken (an advance, or a receipt with something left over) set against a bill later — a table
 * deposit against the dinner's bill, a booking advance against the stay's invoice.
 */
const unused = (m: { total: bigint; settled: bigint }) => Number(m.total - m.settled);

/** How much of a money paper is still not set against anything. */
export async function creditLeft(tx: Tx, companyId: string, moneyId: string) {
  const m = await tx.bill.findFirst({ where: { id: moneyId, companyId } });
  return m && m.status !== 'CANCELLED' && m.status !== 'DRAFT' ? unused(m) : 0;
}

/** Set up to `amount` of a money paper against a bill; returns what was used (never more than either has). */
export async function applyCredit(
  tx: Tx,
  companyId: string,
  moneyId: string,
  billId: string,
  amount: number,
) {
  const money = await tx.bill.findFirst({ where: { id: moneyId, companyId } });
  const bill = await tx.bill.findFirst({ where: { id: billId, companyId } });
  if (!money || !['ADVANCE', 'RECEIPT'].includes(money.type)) throw notFound('Advance');
  if (!bill || !['INVOICE', 'DEBIT_NOTE'].includes(bill.type)) throw notFound('Bill');
  if (money.status === 'CANCELLED' || money.status === 'DRAFT')
    throw new AppError(409, 'CONFLICT', 'That advance was voided');
  if (!['ISSUED', 'PART_PAID'].includes(bill.status))
    throw new AppError(409, 'CONFLICT', 'That bill is not waiting for money');
  const use = Math.min(amount, unused(money), dueOf(bill));
  if (use <= 0) return 0;
  await settle(tx, bill, money.id, use);
  await tx.bill.update({ where: { id: money.id }, data: { settled: money.settled + BigInt(use) } });
  return use;
}

/** Take a money paper off a bill again (the bill was cancelled): the bill is owed, the money is unused once more. */
export async function releaseCredit(tx: Tx, companyId: string, moneyId: string, billId: string) {
  const rows = await tx.billAllocation.findMany({ where: { companyId, paymentId: moneyId, billId } });
  const back = rows.reduce((n, r) => n + Number(r.amount), 0);
  if (!back) return 0;
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId } });
  await settle(tx, bill, moneyId, -back);
  await tx.billAllocation.deleteMany({ where: { companyId, paymentId: moneyId, billId } });
  const money = await tx.bill.findUniqueOrThrow({ where: { id: moneyId } });
  await tx.bill.update({ where: { id: moneyId }, data: { settled: money.settled - BigInt(back) } });
  return back;
}
