import type { Db, Tx } from '@mono/db';
import { cashTotal } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { reserveNumbers } from '../money/bills';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import type { Payment } from './checks-read';
import { dayAt, isApprover, isOwner, posOutlet, type PosOutlet } from './pos-core';

/**
 * Phase 15 — shift and day close. The X report is a cashier's shift so far; the Z report is the business day:
 * sales, tax, charges, discounts, no-charge, voids, what came in by each mode, tips. Closing a day needs every
 * order finished and the cash counted by denomination; a closed day takes nothing more, and only the owner
 * reopens it, with a reason.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function report(
  db: Db | Tx,
  outlet: PosOutlet,
  businessDay: string,
  only?: { userId: string; since: Date },
) {
  const companyId = outlet.companyId;
  const [checks, orders, voids] = await Promise.all([
    db.posCheck.findMany({ where: { companyId, outletId: outlet.id, businessDay } }),
    db.posOrder.findMany({
      where: { companyId, outletId: outlet.id, businessDay },
      select: { id: true, status: true, covers: true, type: true },
    }),
    db.posOrderItem.findMany({
      where: {
        companyId,
        status: 'VOID',
        firedAt: { not: null },
        order: { outletId: outlet.id, businessDay },
      },
      select: { qty: true, price: true },
    }),
  ]);
  const good = checks.filter((c) => c.status !== 'CANCELLED');
  const bills = new Map(
    (
      await db.bill.findMany({
        where: { id: { in: good.map((c) => c.billId) } },
        select: { id: true, tax: true, taxable: true, roundOff: true },
      })
    ).map((b) => [b.id, b]),
  );
  const modes = new Map<
    string,
    { modeId: string; mode: string; kind: string; amount: number; count: number }
  >();
  const tips = new Map<string, number>();
  for (const c of good) {
    for (const p of (c.payments as Payment[] | null) ?? []) {
      if (only && (p.byId !== only.userId || new Date(p.at) < only.since)) continue;
      const m = modes.get(p.modeId) ?? { modeId: p.modeId, mode: p.mode, kind: p.kind, amount: 0, count: 0 };
      m.amount += p.amount;
      m.count += 1;
      modes.set(p.modeId, m);
    }
    for (const t of (c.tips as { amount: number; stewardId: string | null }[] | null) ?? [])
      tips.set(t.stewardId ?? '', (tips.get(t.stewardId ?? '') ?? 0) + t.amount);
  }
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: [...tips.keys()].filter(Boolean) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const sum = (f: (c: (typeof good)[number]) => number) => good.reduce((n, c) => n + f(c), 0);
  const byMode = [...modes.values()].sort((a, b) => b.amount - a.amount);
  return {
    businessDay,
    orders: orders.filter((o) => o.status !== 'CANCELLED').length,
    covers: orders.filter((o) => o.status !== 'CANCELLED').reduce((n, o) => n + o.covers, 0),
    open: orders.filter((o) => o.status === 'OPEN' || o.status === 'BILLED').length,
    bills: good.length,
    cancelled: checks.length - good.length,
    sales: sum((c) => Number(c.total)),
    taxable: sum((c) => Number(bills.get(c.billId)?.taxable ?? 0)),
    tax: sum((c) => Number(bills.get(c.billId)?.tax ?? 0)),
    serviceCharge: sum((c) => Number(c.serviceCharge)),
    discounts: sum((c) => (c.discount as { amount?: number } | null)?.amount ?? 0),
    noCharge: good.filter((c) => c.ncReason).length,
    voids: {
      count: voids.length,
      value: voids.reduce((n, v) => n + Math.round(Number(v.qty) * Number(v.price)), 0),
    },
    byMode,
    cash: byMode.filter((m) => m.kind === 'CASH').reduce((n, m) => n + m.amount, 0),
    unpaid: sum((c) => (c.status === 'OPEN' ? Number(c.total) : 0)),
    tips: [...tips.entries()].map(([id, amount]) => ({ steward: names.get(id) ?? '—', amount })),
  };
}

/** The Z report of a business day (today's by default), and whether the day is closed. */
export async function zReport(db: Db, actor: Actor, outletId: string, businessDay?: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await posOutlet(db, actor, outletId);
  const d = businessDay ?? dayAt(outlet);
  const closed = await db.posDay.findUnique({
    where: { outletId_businessDay: { outletId, businessDay: d } },
  });
  const r = await report(db, outlet, d);
  const canClose =
    outlet.rules.dayClose.closerIds.includes(actor.userId) || (await isApprover(db, actor, outlet.rules));
  // A blind count: whoever counts does not see the cash that is expected until the day is closed.
  const blind = outlet.rules.dayClose.blindCash && closed?.status !== 'CLOSED' && !(await isOwner(db, actor));
  return {
    ...r,
    cash: blind ? null : r.cash,
    byMode: blind ? r.byMode.map((m) => (m.kind === 'CASH' ? { ...m, amount: null } : m)) : r.byMode,
    closed:
      closed?.status === 'CLOSED'
        ? {
            at: closed.closedAt,
            cash: closed.cash,
            counted: cashTotal((closed.cash as Record<string, number> | null) ?? {}),
            report: closed.report,
          }
        : null,
    reopened: closed?.status === 'REOPENED' ? { reason: closed.reopenReason } : null,
    denominations: outlet.rules.dayClose.denominations,
    canClose,
  };
}

export const closeSchema = z.object({
  businessDay: day.optional(),
  cash: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100000)),
});
export async function closeDay(db: Db, actor: Actor, outletId: string, input: z.input<typeof closeSchema>) {
  const c = closeSchema.parse(input);
  const outlet = await posOutlet(db, actor, outletId);
  if (!outlet.rules.dayClose.closerIds.includes(actor.userId) && !(await isApprover(db, actor, outlet.rules)))
    throw new AppError(403, 'FORBIDDEN', "You can't close the day");
  const d = c.businessDay ?? dayAt(outlet);
  if (d > dayAt(outlet))
    throw new AppError(400, 'VALIDATION_FAILED', "A day that hasn't begun can't be closed");
  const had = await db.posDay.findUnique({ where: { outletId_businessDay: { outletId, businessDay: d } } });
  if (had?.status === 'CLOSED') throw new AppError(409, 'CONFLICT', 'This day is already closed');
  const r = await report(db, outlet, d);
  if (r.open)
    throw new AppError(409, 'CONFLICT', `${r.open} order(s) are still running: bill and settle them first`);
  if (r.unpaid) throw new AppError(409, 'CONFLICT', 'A bill of this day is still unpaid');
  const counted = cashTotal(c.cash);
  const full = { ...r, counted, difference: counted - r.cash };
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    const data = {
      status: 'CLOSED',
      report: full,
      cash: c.cash,
      closedById: actor.userId,
      closedAt: new Date(),
    };
    await tx.posDay.upsert({
      where: { outletId_businessDay: { outletId, businessDay: d } },
      create: { companyId: actor.companyId, outletId, businessDay: d, ...data },
      update: data,
    });
    await writeAudit(tx, ctx, {
      action: 'pos.day_closed',
      entityType: 'pos_day',
      entityId: `${outletId}:${d}`,
      after: { sales: r.sales, counted, difference: full.difference },
    });
    await emitEvent(tx, ctx, {
      name: 'pos.day_closed',
      entityType: 'pos_day',
      entityId: `${outletId}:${d}`,
      payload: {
        outletId,
        branchId: outlet.branchId,
        outlet: outlet.name,
        businessDay: d,
        sales: r.sales,
        difference: full.difference,
      },
    });
  });
  return full;
}

/** Only the owner reopens a closed day, and says why. */
export async function reopenDay(
  db: Db,
  actor: Actor,
  outletId: string,
  input: { businessDay: string; reason: string },
) {
  const b = z.object({ businessDay: day, reason: z.string().trim().min(3).max(300) }).parse(input);
  await posOutlet(db, actor, outletId);
  if (!(await isOwner(db, actor)))
    throw new AppError(403, 'FORBIDDEN', 'Only the owner reopens a closed day');
  const had = await db.posDay.findUnique({
    where: { outletId_businessDay: { outletId, businessDay: b.businessDay } },
  });
  if (had?.status !== 'CLOSED') throw new AppError(409, 'CONFLICT', 'That day is not closed');
  await db.$transaction(async (tx) => {
    await tx.posDay.update({
      where: { id: had.id },
      data: {
        status: 'REOPENED',
        reopenedById: actor.userId,
        reopenReason: b.reason,
        reopenedAt: new Date(),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.day_reopened',
      entityType: 'pos_day',
      entityId: `${outletId}:${b.businessDay}`,
      before: had.report,
      after: { reason: b.reason },
    });
  });
  return { businessDay: b.businessDay, status: 'REOPENED' };
}

/** A cashier's shift: opened with a float; the X report is what they took since; closing it counts their cash. */
export async function shift(db: Db, actor: Actor, outletId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await posOutlet(db, actor, outletId);
  const open = await db.posShift.findFirst({
    where: { companyId: actor.companyId, outletId, userId: actor.userId, closedAt: null },
  });
  if (!open) return { open: null };
  const x = await report(db, outlet, dayAt(outlet), { userId: actor.userId, since: open.openedAt });
  return {
    open: { id: open.id, openedAt: open.openedAt, float: Number(open.float) },
    x: { byMode: x.byMode, cash: x.cash, expectedInDrawer: x.cash + Number(open.float) },
  };
}
export async function openShift(db: Db, actor: Actor, outletId: string, float: number) {
  need(actor, 'hosp.create', "You can't open a shift");
  await posOutlet(db, actor, outletId);
  if (
    await db.posShift.count({
      where: { companyId: actor.companyId, outletId, userId: actor.userId, closedAt: null },
    })
  )
    throw new AppError(409, 'CONFLICT', 'You already have a shift open here');
  const row = await db.posShift.create({
    data: {
      companyId: actor.companyId,
      outletId,
      userId: actor.userId,
      float: BigInt(Math.max(0, Math.round(float))),
    },
  });
  return { id: row.id };
}
export async function closeShift(db: Db, actor: Actor, outletId: string, cash: Record<string, number>) {
  need(actor, 'hosp.create', "You can't close a shift");
  const s = await shift(db, actor, outletId);
  if (!s.open) throw notFound('Shift');
  const counted = cashTotal(cash);
  const x = { ...s.x, counted, difference: counted - s.x.expectedInDrawer };
  await db.posShift.update({ where: { id: s.open.id }, data: { closedAt: new Date(), report: x, cash } });
  return x;
}

export const deviceSchema = z.object({
  name: z.string().trim().min(1).max(40),
  count: z.number().int().min(1).max(200).default(20),
});
/** A device's block of bill numbers: taken from the entity's series now, used later when the server can't be reached. */
export async function reserveForDevice(
  db: Db,
  actor: Actor,
  outletId: string,
  input: z.input<typeof deviceSchema>,
) {
  need(actor, 'hosp.create', "You can't set up a device");
  const d = deviceSchema.parse(input);
  const outlet = await posOutlet(db, actor, outletId);
  return db.$transaction(async (tx) => {
    const numbers = await reserveNumbers(
      tx,
      actor.companyId,
      outlet.branchId,
      'INVOICE',
      dayAt(outlet),
      d.count,
    );
    const had = await tx.posDevice.findUnique({ where: { outletId_name: { outletId, name: d.name } } });
    const row = had
      ? await tx.posDevice.update({ where: { id: had.id }, data: { numbers: [...had.numbers, ...numbers] } })
      : await tx.posDevice.create({ data: { companyId: actor.companyId, outletId, name: d.name, numbers } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'pos.numbers_reserved',
      entityType: 'pos_device',
      entityId: row.id,
      after: { name: d.name, numbers },
    });
    return { id: row.id, name: row.name, numbers: row.numbers };
  });
}
