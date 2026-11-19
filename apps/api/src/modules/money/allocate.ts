import type { Bill, Tx } from '@mono/db';
import { billMachine, transition } from '@mono/shared';
import { AppError } from '../../lib/errors';

/** What a paper still has to be paid. */
export const dueOf = (b: { total: bigint; credited: bigint; settled: bigint }) =>
  Number(b.total - b.credited - b.settled);

/** How many of a party's oldest unpaid bills are read at a time when money is set against "the oldest first". */
const OLDEST_PAGE = 50;

/** Set a receipt against invoices (or a payment against purchase bills): the ones named, else the oldest first. */
export async function allocate(tx: Tx, money: Bill, named?: { billId: string; amount: number }[]) {
  const owedTypes = money.type === 'RECEIPT' ? ['INVOICE', 'DEBIT_NOTE'] : ['PURCHASE_BILL'];
  const waiting = {
    companyId: money.companyId,
    partyId: money.partyId,
    type: { in: owedTypes },
    status: { in: ['ISSUED', 'PART_PAID'] },
  };
  // Only the bills this money can reach are read: the ones named, or the oldest ones a page at a time until
  // the money is used up. (A walk-in party can have thousands of bills; reading them all for every payment
  // made each payment slower than the last, and held its number's lock meanwhile.)
  const open = named?.length
    ? await tx.bill.findMany({ where: { ...waiting, id: { in: named.map((n) => n.billId) } } })
    : [];
  let left = Number(money.total);
  const plan: { bill: Bill; amount: number }[] = [];
  if (named?.length) {
    for (const n of named) {
      const bill = open.find((b) => b.id === n.billId);
      if (!bill) throw new AppError(400, 'VALIDATION_FAILED', 'That bill is not waiting for money');
      if (n.amount > dueOf(bill) || n.amount > left)
        throw new AppError(400, 'VALIDATION_FAILED', 'That is more than is owed on the bill');
      plan.push({ bill, amount: n.amount });
      left -= n.amount;
    }
  } else {
    for (let skip = 0; left > 0; skip += OLDEST_PAGE) {
      const page = await tx.bill.findMany({
        where: waiting,
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip,
        take: OLDEST_PAGE,
      });
      for (const bill of page) {
        if (left <= 0) break;
        const amount = Math.min(left, dueOf(bill));
        if (amount > 0) plan.push({ bill, amount });
        left -= amount;
      }
      if (page.length < OLDEST_PAGE) break;
    }
  }
  for (const { bill, amount } of plan) await settle(tx, bill, money.id, amount);
  await tx.bill.update({ where: { id: money.id }, data: { settled: BigInt(Number(money.total) - left) } });
}

/** One amount set against one paper (negative takes it back): the paper's `settled` and status follow. */
export async function settle(tx: Tx, bill: Bill, paymentId: string, amount: number) {
  const settled = bill.settled + BigInt(amount);
  const to = transition(billMachine, {
    from: bill.status as 'ISSUED',
    action: 'settle',
    roles: ['system'],
    ctx: { due: dueOf({ ...bill, settled }), total: Number(bill.total - bill.credited), money: false },
  }).to;
  await tx.bill.update({ where: { id: bill.id }, data: { settled, status: to } });
  if (amount > 0)
    await tx.billAllocation.create({
      data: { companyId: bill.companyId, billId: bill.id, paymentId, amount: BigInt(amount) },
    });
}
