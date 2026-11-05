import { nextCounter, type Db, type Tx } from '@mono/db';
import { addDays, financialYear, salesOrderMachine, transition, type SalesOrderStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { emitEvent } from '../../lib/events';
import { AppError, notFound } from '../../lib/errors';
import { startRecord } from '../fms/engine';
import { recordAction } from '../fms/records';
import type { Actor } from '../work/actor';
import { crmConfigOf, ctxOf, fyCalendar, money, need } from './access';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const orderSchema = z.object({
  customerId: z.string(),
  orderDate: date.optional(),
  /** Paise, before GST. */
  amount: z.number().int().positive().max(1e15),
  gp: z.number().int().min(0).max(1e15).optional(),
  items: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(120),
        qty: z.number().positive().max(1e9),
        rate: z.number().min(0).max(1e12),
      }),
    )
    .max(50)
    .default([]),
  promisedOn: date.optional(),
  note: z.string().trim().max(500).nullish(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

/**
 * An order (taken on a call or entered directly): numbered SO/{FY}/0001, payment due after the customer's credit
 * days, and the after-order FMS record started so it moves through the steps (§11.1 page 6).
 */
export async function createOrder(
  db: Db,
  actor: Actor,
  input: z.input<typeof orderSchema>,
  callId?: string,
  tx?: Tx,
) {
  need(actor, 'crm.create', "You can't take orders");
  const o = orderSchema.parse(input);
  const f = await fyCalendar(db, actor.companyId);
  const orderDate = o.orderDate ?? f.today;
  if (orderDate > f.today)
    throw new AppError(400, 'VALIDATION_FAILED', "An order can't be dated in the future");
  if (o.gp !== undefined && o.gp > o.amount)
    throw new AppError(400, 'VALIDATION_FAILED', "Gross profit can't be more than the amount");
  const c = await db.customer.findFirst({
    where: { id: o.customerId, companyId: actor.companyId, deletedAt: null },
  });
  if (!c) throw notFound('Customer');
  const settings = await db.crmSettings.findUnique({ where: { companyId: actor.companyId } });
  const flowId = settings?.afterOrderFlowId;
  if (!flowId)
    throw new AppError(
      409,
      'CONFLICT',
      'Set up the steps after an order first (Sales CRM setup → After the order)',
    );
  const promisedOn = o.promisedOn ?? addDays(orderDate, 3);
  const dueOn = addDays(orderDate, c.creditDays);
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const fy = financialYear(
    new Date(`${orderDate}T12:00:00Z`),
    company.timezone,
    company.fyStartMonth ?? 4,
  ).short;
  const run = async (t: Tx) => {
    const number = `SO/${fy}/${String(await nextCounter(t, actor.companyId, 'so', fy)).padStart(4, '0')}`;
    // GP: as given, else the customer's usual margin on this amount (0 until they have one).
    let gp = o.gp;
    if (gp === undefined) {
      const past = await t.salesOrder.aggregate({
        where: { customerId: c.id, status: { not: 'CANCELLED' } },
        _sum: { amount: true, gp: true },
      });
      const a = Number(past._sum.amount ?? 0);
      gp = a ? Math.round((o.amount * Number(past._sum.gp ?? 0)) / a) : 0;
    }
    const order = await t.salesOrder.create({
      data: {
        companyId: actor.companyId,
        number,
        customerId: c.id,
        orderDate,
        amount: BigInt(o.amount),
        gp: BigInt(gp),
        items: o.items,
        promisedOn,
        dueOn,
        note: o.note ?? null,
        takenById: actor.userId,
        callId: callId ?? null,
        fields: o.fields as object,
      },
    });
    await writeAudit(t, ctxOf(actor), {
      action: 'crm.order_taken',
      entityType: 'sales_order',
      entityId: order.id,
      after: { ...o, number },
    });
    await emitEvent(t, ctxOf(actor), {
      name: 'crm.order_taken',
      entityType: 'sales_order',
      entityId: order.id,
      payload: {
        number,
        customerId: c.id,
        customer: c.name,
        orderDate,
        amountPaise: String(o.amount),
        gpPaise: String(o.gp ?? 0),
        items: o.items,
        promisedOn: promisedOn ?? null,
        dueOn,
      },
    });
    return order;
  };
  const order = tx ? await run(tx) : await db.$transaction(run);
  const mobile = (c.mobile ?? '').replace(/\D/g, '').slice(-10);
  const record = await startRecord(db, {
    companyId: actor.companyId,
    flowId,
    startedById: actor.userId,
    source: 'crm',
    data: {
      customer: c.name,
      order_no: order.number,
      amount: o.amount / 100,
      promised_on: promisedOn,
      payment_due: dueOn,
      ...(/^[6-9]\d{9}$/.test(mobile) ? { mobile } : {}),
      items: o.items.map((i) => ({ item: i.item, qty: i.qty, rate: i.rate / 100 })),
    },
  });
  await db.salesOrder.update({ where: { id: order.id }, data: { recordId: record.id } });
  return { id: order.id, number: order.number, recordId: record.id };
}

/** Orders whose after-order record has closed are done. */
export async function finishClosedOrders(db: Db, companyId?: string) {
  const open = await db.salesOrder.findMany({
    where: { status: 'OPEN', recordId: { not: null }, ...(companyId ? { companyId } : {}) },
    select: { id: true, recordId: true, companyId: true },
  });
  if (!open.length) return 0;
  const closed = new Set(
    (
      await db.fmsRecord.findMany({
        where: { id: { in: open.map((o) => o.recordId!) }, status: 'CLOSED' },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  let n = 0;
  for (const o of open.filter((x) => closed.has(x.recordId!))) {
    transition(salesOrderMachine, { from: 'OPEN', action: 'finish', roles: ['system'], ctx: {} });
    await db.$transaction(async (tx) => {
      await tx.salesOrder.update({ where: { id: o.id }, data: { status: 'DONE' } });
      await writeAudit(
        tx,
        { companyId: o.companyId, actorId: null },
        { action: 'crm.order_done', entityType: 'sales_order', entityId: o.id },
      );
    });
    n++;
  }
  return n;
}

export async function cancelOrder(db: Db, actor: Actor, id: string, reason: string) {
  need(actor, 'crm.edit', "You can't cancel orders");
  const o = await db.salesOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!o) throw notFound('Order');
  const to = transition(salesOrderMachine, {
    from: o.status as SalesOrderStatus,
    action: 'cancel',
    roles: ['sales'],
    ctx: {},
  }).to;
  await db.$transaction(async (tx) => {
    await tx.salesOrder.update({ where: { id }, data: { status: to } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'crm.order_cancelled',
      entityType: 'sales_order',
      entityId: id,
      after: { reason },
    });
    await emitEvent(tx, ctxOf(actor), {
      name: 'crm.order_cancelled',
      entityType: 'sales_order',
      entityId: id,
      payload: { number: o.number, reason },
    });
  });
  // Its after-order record is cancelled through the FMS machine (as an FMS admin would).
  if (o.recordId) {
    const r = await db.fmsRecord.findUnique({ where: { id: o.recordId }, select: { status: true } });
    if (r && (r.status === 'RUNNING' || r.status === 'ON_HOLD'))
      await recordAction(
        db,
        { ...actor, permissions: [...actor.permissions, 'fms.admin'] },
        o.recordId,
        'cancel',
        reason,
      );
  }
  return { status: to };
}

/**
 * CRM Orders (§11.2): a kanban whose columns are the after-order steps; each running order sits on its open step
 * with the planned time, lateness and the doer. Tiles: orders this month, on-time %, backlog ₹.
 */
export async function ordersBoard(db: Db, actor: Actor) {
  need(actor, 'crm.view', "You can't see orders");
  await finishClosedOrders(db, actor.companyId);
  const config = await crmConfigOf(db, actor.companyId);
  const f = await fyCalendar(db, actor.companyId);
  const orders = await db.salesOrder.findMany({
    where: {
      companyId: actor.companyId,
      OR: [{ status: 'OPEN' }, { orderDate: { gte: `${f.today.slice(0, 7)}-01` } }],
    },
    include: { customer: { select: { name: true, city: true } } },
    orderBy: { orderDate: 'asc' },
  });
  const steps = await db.fmsRecordStep.findMany({
    where: { recordId: { in: orders.map((o) => o.recordId).filter((x): x is string => Boolean(x)) } },
    orderBy: { position: 'asc' },
  });
  const doers = new Map(
    (
      await db.user.findMany({
        where: { id: { in: steps.map((s) => s.doerId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const now = Date.now();
  const cards = orders.map((o) => {
    const own = steps.filter((s) => s.recordId === o.recordId);
    const open = own.find((s) => s.status === 'OPEN');
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      customer: o.customer.name,
      city: o.customer.city,
      amount: money(o.amount),
      orderDate: o.orderDate,
      promisedOn: o.promisedOn,
      dueOn: o.dueOn,
      recordId: o.recordId,
      step: open
        ? {
            id: open.id,
            key: open.stepKey,
            name: open.stepName,
            plannedAt: open.plannedAt,
            doerId: open.doerId,
            doer: open.doerId ? (doers.get(open.doerId) ?? null) : null,
            late: Boolean(open.plannedAt && open.plannedAt.getTime() < now),
          }
        : null,
    };
  });
  const done = steps.filter((s) => s.status === 'DONE' && s.plannedAt && s.doneAt);
  const onTime = done.filter((s) => s.doneAt!.getTime() <= s.plannedAt!.getTime()).length;
  const running = cards.filter((c) => c.status === 'OPEN');
  return {
    columns: config.afterOrder.map((s) => ({
      key: s.key,
      name: s.name,
      cards: running.filter((c) => c.step?.key === s.key),
    })),
    other: running.filter((c) => !c.step || !config.afterOrder.some((s) => s.key === c.step!.key)),
    tiles: {
      ordersThisMonth: cards.filter((c) => c.orderDate >= `${f.today.slice(0, 7)}-01`).length,
      onTimePct: done.length ? Math.round((onTime / done.length) * 100) : null,
      backlog: money(running.reduce((a, c) => a + Number(c.amount), 0)),
      late: running.filter((c) => c.step?.late).length,
    },
  };
}
