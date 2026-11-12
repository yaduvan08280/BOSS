import type { Bill, Db } from '@mono/db';
import { OWED_BILLS, type BillType } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { dueOf } from './bills';

/** Reading bills: one shape for lists, the drawer and the public API. */
export const billOut = (b: Bill) => ({
  id: b.id,
  type: b.type as BillType,
  status: b.status,
  number: b.status === 'DRAFT' ? null : b.number,
  date: b.date,
  partyId: b.partyId,
  branchId: b.branchId,
  entityId: b.entityId,
  currency: b.currency,
  lines: b.lines,
  charges: b.charges,
  discount: Number(b.discount),
  taxInclusive: b.taxInclusive,
  taxable: Number(b.taxable),
  tax: Number(b.tax),
  taxes: b.taxes,
  roundOff: b.roundOff,
  total: Number(b.total),
  settled: Number(b.settled),
  credited: Number(b.credited),
  due: OWED_BILLS.includes(b.type as BillType) && !['DRAFT', 'CANCELLED'].includes(b.status) ? dueOf(b) : 0,
  dueOn: b.dueOn,
  promisedOn: b.promisedOn,
  againstId: b.againstId,
  modeId: b.modeId,
  reference: b.reference,
  note: b.note,
  source: b.sourceType ? { type: b.sourceType, id: b.sourceId } : null,
  createdAt: b.createdAt,
});

export async function listBills(
  db: Db,
  actor: Actor,
  q: { type?: string; status?: string; partyId?: string; from?: string; to?: string },
) {
  if (!can(actor, 'money.view')) throw new AppError(403, 'FORBIDDEN', "You can't see bills");
  const rows = await db.bill.findMany({
    where: {
      companyId: actor.companyId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'CANCELLED' } }),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.from || q.to
        ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });
  return rows.map(billOut);
}

export async function getBill(db: Db, actor: Actor, id: string) {
  if (!can(actor, 'money.view')) throw new AppError(403, 'FORBIDDEN', "You can't see bills");
  const bill = await db.bill.findFirst({ where: { id, companyId: actor.companyId } });
  if (!bill) throw notFound('Bill');
  const [party, allocations, voucher] = await Promise.all([
    db.party.findUnique({
      where: { id: bill.partyId },
      select: { id: true, name: true, code: true, state: true },
    }),
    db.billAllocation.findMany({ where: { OR: [{ billId: id }, { paymentId: id }] } }),
    db.voucher.findMany({ where: { billId: id }, orderBy: { createdAt: 'asc' } }),
  ]);
  return {
    ...billOut(bill),
    party,
    allocations: allocations.map((a) => ({
      billId: a.billId,
      paymentId: a.paymentId,
      amount: Number(a.amount),
    })),
    vouchers: voucher.map((v) => ({
      date: v.date,
      narration: v.narration,
      reversal: v.reversal,
      lines: v.lines,
    })),
  };
}

/** A promise to pay by a day (collections): kept on the paper, shown in the receivables. */
export async function setPromise(db: Db, actor: Actor, id: string, promisedOn: string | null) {
  if (!can(actor, 'money.edit')) throw new AppError(403, 'FORBIDDEN', "You can't change this");
  const res = await db.bill.updateMany({ where: { id, companyId: actor.companyId }, data: { promisedOn } });
  if (!res.count) throw notFound('Bill');
  return { ok: true };
}
