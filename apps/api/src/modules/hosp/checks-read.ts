import type { Db, Tx } from '@mono/db';
import { upiLink, type PrintLine } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { dayAt, live, loadOrder, posOutlet, type LoadedOrder, type PosOutlet } from './pos-core';
import { queuePrint } from './print';

const money = (n: number) => `Rs ${(n / 100).toFixed(2)}`;

/** The print lines of a bill. */
export function billLines(
  outlet: PosOutlet,
  check: { number: string; total: number },
  order: LoadedOrder,
  lines: { name: string; qty: number; amount: number }[],
  extras: [string, number][],
  duplicate: boolean,
): PrintLine[] {
  return [
    { text: outlet.name, bold: true, big: true, align: 'center' },
    ...(duplicate ? [{ text: 'DUPLICATE', bold: true, align: 'center' } satisfies PrintLine] : []),
    { cols: [`Bill ${check.number}`, order.businessDay.split('-').reverse().join('/')] },
    { rule: true },
    ...lines.map((l): PrintLine => ({ cols: [`${l.qty} x ${l.name}`, money(l.amount)] })),
    { rule: true },
    ...extras.map(([k, v]): PrintLine => ({ cols: [k, money(v)] })),
    { cols: ['TOTAL', money(check.total)], bold: true },
    ...(outlet.charges.upiId
      ? [
          {
            text: upiLink(outlet.charges.upiId, outlet.name, check.total, `Bill ${check.number}`),
          } satisfies PrintLine,
        ]
      : []),
  ];
}

const cashier = (a: Actor) => need(a, 'hosp.create', "You can't make bills");

export async function checkView(db: Db | Tx, outlet: PosOutlet, id: string) {
  const c = await db.posCheck.findUniqueOrThrow({ where: { id } });
  const bill = await db.bill.findUniqueOrThrow({ where: { id: c.billId } });
  const due = Math.max(0, Number(bill.total - bill.credited - bill.settled)) - creditOf(c.payments);
  return {
    id: c.id,
    orderId: c.orderId,
    checkNo: c.checkNo,
    number: c.number,
    status: c.status,
    businessDay: c.businessDay,
    total: Number(c.total),
    taxable: Number(bill.taxable),
    tax: Number(bill.tax),
    taxes: bill.taxes as { name: string; amount: number }[],
    roundOff: Number(bill.roundOff),
    serviceCharge: Number(c.serviceCharge),
    discount: c.discount as { amount: number; kind: string; value: number; reason?: string | null } | null,
    ncReason: c.ncReason,
    parts: c.parts as number[] | null,
    payments: (c.payments as Payment[] | null) ?? [],
    tips: (c.tips as { amount: number; stewardId: string | null }[] | null) ?? [],
    due: Math.max(0, due),
    printed: c.printed,
    cancelReason: c.cancelReason,
    upi:
      outlet.charges.upiId && due > 0
        ? upiLink(outlet.charges.upiId, outlet.name, due, `Bill ${c.number}`)
        : null,
  };
}
export type Payment = {
  modeId: string;
  mode: string;
  kind: string;
  amount: number;
  reference: string | null;
  receiptId: string | null;
  byId: string;
  at: string;
  /** An advance (a table deposit) set against the bill, and the bill it was set against. */
  advanceId?: string;
  billId?: string;
};
/** What was put on a company's account rather than paid: it stays owed in the money core. */
export const creditOf = (payments: unknown) =>
  ((payments as Payment[] | null) ?? [])
    .filter((p) => p.kind === 'COMPANY')
    .reduce((n, p) => n + p.amount, 0);

/** Print the bill again: it is marked DUPLICATE and counted. */
export async function reprintCheck(db: Db, actor: Actor, id: string) {
  cashier(actor);
  const c = await db.posCheck.findFirst({ where: { id, companyId: actor.companyId } });
  if (!c) throw notFound('Bill');
  const { order, outlet } = await loadOrder(db, actor, c.orderId);
  const items = live(order).filter((i) => i.checkNo === c.checkNo);
  return db.$transaction(async (tx) => {
    const after = await tx.posCheck.update({ where: { id }, data: { printed: { increment: 1 } } });
    const job = await queuePrint(
      tx,
      actor.companyId,
      outlet.billPrinterId,
      'BILL',
      id,
      billLines(
        outlet,
        { number: c.number, total: Number(c.total) },
        order,
        items.map((i) => ({
          name: i.name,
          qty: Number(i.qty),
          amount: Math.round(Number(i.qty) * Number(i.price)),
        })),
        [],
        true,
      ),
    );
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.check_reprinted',
      entityType: 'pos_check',
      entityId: id,
      after: { printed: after.printed },
    });
    return { printed: after.printed, duplicate: true, queued: Boolean(job) };
  });
}

/** The bills of a business day at an outlet (newest first). */
export async function listChecks(db: Db, actor: Actor, outletId: string, businessDay?: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await posOutlet(db, actor, outletId);
  const rows = await db.posCheck.findMany({
    where: { companyId: actor.companyId, outletId, businessDay: businessDay ?? dayAt(outlet) },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const out = [];
  for (const r of rows) out.push(await checkView(db, outlet, r.id));
  return out;
}
