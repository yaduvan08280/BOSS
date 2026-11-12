import type { Db, Payment, SalesOrder, Tx } from '@mono/db';
import { actorFor, type Actor } from '../work/actor';
import { createBillIn } from './bills';
import { partyOfCustomer } from './parties';

/**
 * The CRM through the money core (phase 12M): a sales order is an invoice with the order's own number, a payment
 * is a receipt set against it, a cancelled order is a credit note — so a customer's statement, ageing and the
 * books come from the same papers as everything else. The CRM's own screens keep reading orders and payments.
 * `carryOverCrm` does the same for orders and payments made before the engine existed; numbers do not change.
 */
type OrderRow = Pick<
  SalesOrder,
  'id' | 'companyId' | 'branchId' | 'number' | 'customerId' | 'orderDate' | 'amount' | 'dueOn' | 'items'
>;

/** The order as bill lines: its item lines when they carry a quantity and a rate, else one line for the amount. */
function linesOf(order: OrderRow) {
  const items = (order.items as { item?: string; qty?: number; rate?: number }[] | null) ?? [];
  const usable = items.filter((i) => i.item && Number(i.qty) > 0 && Number(i.rate) >= 0);
  const lines = usable.map((i) => ({
    item: String(i.item),
    qty: Number(i.qty),
    rate: Math.round(Number(i.rate) * 100),
  }));
  const sum = lines.reduce((n, l) => n + Math.round(l.qty * l.rate), 0);
  // The order's amount is what was agreed; lines that don't add up to it are not used.
  return lines.length && sum === Number(order.amount)
    ? lines
    : [{ item: `Order ${order.number}`, qty: 1, rate: Number(order.amount) }];
}

export async function billForOrder(tx: Tx, actor: Actor, order: OrderRow) {
  if (
    await tx.bill.count({
      where: { companyId: order.companyId, sourceType: 'crm_order', sourceId: order.id },
    })
  )
    return;
  await createBillIn(
    tx,
    actor,
    {
      type: 'INVOICE',
      partyId: order.customerId,
      date: order.orderDate,
      branchId: order.branchId,
      lines: linesOf(order),
      charges: [],
      discount: 0,
      taxInclusive: false,
      dueOn: order.dueOn,
    },
    { issue: true, system: true, number: order.number, source: { type: 'crm_order', id: order.id } },
  );
}

/** A cancelled order: its invoice is cancelled the only way an issued paper can be — by a credit note for it. */
export async function creditForOrder(tx: Tx, actor: Actor, order: OrderRow, date: string) {
  const bill = await tx.bill.findFirst({
    where: { companyId: order.companyId, sourceType: 'crm_order', sourceId: order.id },
  });
  if (!bill || bill.status === 'CANCELLED') return;
  const open = Number(bill.total - bill.credited);
  if (open <= 0) return;
  await createBillIn(
    tx,
    actor,
    {
      type: 'CREDIT_NOTE',
      partyId: bill.partyId,
      date,
      branchId: bill.branchId,
      againstId: bill.id,
      lines: [{ item: `Order ${order.number} cancelled`, qty: 1, rate: open }],
      charges: [],
      discount: 0,
      taxInclusive: false,
    },
    { issue: true, system: true, source: { type: 'crm_order_cancel', id: order.id } },
  );
}

export async function receiptForPayment(tx: Tx, actor: Actor, p: Payment) {
  if (await tx.bill.count({ where: { companyId: p.companyId, sourceType: 'crm_payment', sourceId: p.id } }))
    return;
  // Against its own order when the payment names one; otherwise the customer's oldest papers first.
  const own = p.orderId
    ? await tx.bill.findFirst({
        where: {
          companyId: p.companyId,
          sourceType: 'crm_order',
          sourceId: p.orderId,
          status: { in: ['ISSUED', 'PART_PAID'] },
        },
      })
    : null;
  const due = own ? Number(own.total - own.credited - own.settled) : 0;
  await createBillIn(
    tx,
    actor,
    {
      type: 'RECEIPT',
      partyId: p.customerId,
      date: p.date,
      branchId: null,
      lines: [],
      charges: [],
      discount: 0,
      taxInclusive: false,
      amount: Number(p.amount),
      reference: p.reference,
      note: p.note,
    },
    {
      system: true,
      source: { type: 'crm_payment', id: p.id },
      ...(own && due >= Number(p.amount) ? { allocate: [{ billId: own.id, amount: Number(p.amount) }] } : {}),
    },
  );
}

/**
 * Orders and payments from before the engine (and customers not yet parties) are carried over, oldest first, a
 * batch at a time. Safe to run again: what already has its paper is skipped. Returns how many papers were made.
 */
export async function carryOverCrm(db: Db, onlyCompanyId?: string, batch = 200): Promise<number> {
  let made = 0;
  const companies = await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true },
  });
  for (const c of companies) {
    const owner = await db.user.findFirst({
      where: { companyId: c.id, deletedAt: null, role: { key: 'OWNER' } },
      select: { id: true },
    });
    const actor = owner ? await actorFor(db, c.id, owner.id) : null;
    if (!actor) continue;
    // Customers first: a paper needs its party.
    const customers = await db.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM customers c LEFT JOIN parties p ON p.id = c.id
      WHERE c.company_id = ${c.id} AND p.id IS NULL LIMIT ${batch}`;
    for (const { id } of customers)
      await db.$transaction(async (tx) =>
        partyOfCustomer(tx, await tx.customer.findUniqueOrThrow({ where: { id } })),
      );
    const orders = await db.$queryRaw<{ id: string }[]>`
      SELECT o.id FROM sales_orders o
      LEFT JOIN bills b ON b.company_id = o.company_id AND b.source_type = 'crm_order' AND b.source_id = o.id
      WHERE o.company_id = ${c.id} AND b.id IS NULL
      ORDER BY o.order_date, o.created_at LIMIT ${batch}`;
    for (const { id } of orders) {
      await db.$transaction(async (tx) => {
        const o = await tx.salesOrder.findUniqueOrThrow({ where: { id } });
        await billForOrder(tx, actor, o);
        if (o.status === 'CANCELLED') await creditForOrder(tx, actor, o, o.orderDate);
      });
      made++;
    }
    if (orders.length === batch) continue;
    const payments = await db.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM payments p
      LEFT JOIN bills b ON b.company_id = p.company_id AND b.source_type = 'crm_payment' AND b.source_id = p.id
      WHERE p.company_id = ${c.id} AND b.id IS NULL
      ORDER BY p.date, p.created_at LIMIT ${batch}`;
    for (const { id } of payments) {
      await db.$transaction(async (tx) =>
        receiptForPayment(tx, actor, await tx.payment.findUniqueOrThrow({ where: { id } })),
      );
      made++;
    }
  }
  return made;
}
