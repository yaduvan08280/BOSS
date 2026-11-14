import { formatNumber, nextCounter, type Db } from '@mono/db';
import { addDays } from '@mono/shared';
import type { Actor } from '../work/actor';
import { needOwner, num, spanOf } from './core';

/**
 * The base for "what if": the last 90 days as a typical month — sales by weekday, what the stock sold cost,
 * and the monthly salaries. The screen works the scenarios out from these (price change, extra staff, a day
 * closed) so the owner can move the sliders without waiting.
 */
export async function whatIfBase(db: Db, actor: Actor) {
  needOwner(actor);
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId, undefined, undefined);
  const from = addDays(s.to, -89);
  const span = await spanOf(db, companyId, from, s.to);
  const [checks, orders, used, people] = await Promise.all([
    db.posCheck.findMany({
      where: { companyId, businessDay: { gte: from, lte: s.to }, status: { not: 'CANCELLED' } },
      select: { businessDay: true, total: true },
    }),
    db.salesOrder.findMany({
      where: { companyId, orderDate: { gte: from, lte: s.to }, status: { not: 'CANCELLED' } },
      select: { orderDate: true, amount: true, gp: true },
    }),
    db.stockMove.findMany({
      where: { companyId, at: { gte: span.start, lt: span.end }, status: 'APPLIED', refType: 'pos_order' },
      select: { value: true, qty: true, rate: true },
    }),
    db.user.findMany({ where: { companyId, deletedAt: null, status: 'ACTIVE' }, select: { hr: true } }),
  ]);
  const byWeekday = Array.from({ length: 7 }, () => ({ sales: 0, days: new Set<string>() }));
  const day = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  let sales = 0;
  for (const c of checks) {
    const w = byWeekday[day(c.businessDay)]!;
    w.sales += num(c.total);
    w.days.add(c.businessDay);
    sales += num(c.total);
  }
  let orderCost = 0;
  for (const o of orders) {
    const w = byWeekday[day(o.orderDate)]!;
    w.sales += num(o.amount);
    w.days.add(o.orderDate);
    sales += num(o.amount);
    orderCost += num(o.amount) - num(o.gp);
  }
  const stockCost = used.reduce((n, m) => n + Math.abs(num(m.value) || num(m.qty) * num(m.rate)), 0);
  const cost = stockCost + orderCost;
  const salaries = people.map((p) => num((p.hr as { salary?: number } | null)?.salary)).filter((x) => x > 0);
  const payroll = salaries.reduce((a, b) => a + b, 0) * 100;
  const month = 30 / 90;
  return {
    from,
    to: s.to,
    monthlySales: Math.round(sales * month),
    monthlyCost: Math.round(cost * month),
    costPct: sales ? Math.round((cost / sales) * 1000) / 10 : null,
    monthlyPayroll: payroll,
    people: people.length,
    avgSalary: salaries.length ? Math.round(payroll / salaries.length) : 0,
    // The share of a month's sales each weekday brings (Monday first), and what an average such day sells.
    weekdays: byWeekday.map((w) => ({
      share: sales ? Math.round((w.sales / sales) * 1000) / 10 : 0,
      perDay: w.days.size ? Math.round(w.sales / w.days.size) : 0,
    })),
  };
}

/**
 * Copy the best: the active checklists of one branch are made again for another branch, to be done by that
 * branch's manager until they hand them out. A checklist the other branch already has (by name) is left alone.
 */
export async function copyChecklists(
  db: Db,
  actor: Actor,
  input: { fromBranchId: string; toBranchId: string },
) {
  needOwner(actor);
  const companyId = actor.companyId;
  const [from, to, manager, masters, existing] = await Promise.all([
    db.branch.findFirst({
      where: { id: input.fromBranchId, companyId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.branch.findFirst({
      where: { id: input.toBranchId, companyId, deletedAt: null },
      select: { id: true, name: true },
    }),
    db.branchManager.findFirst({
      where: { companyId, branchId: input.toBranchId, role: 'MANAGER' },
      select: { userId: true },
    }),
    db.checklistMaster.findMany({
      where: { companyId, deletedAt: null, active: true, branchId: input.fromBranchId },
    }),
    db.checklistMaster.findMany({
      where: { companyId, deletedAt: null, branchId: input.toBranchId },
      select: { name: true },
    }),
  ]);
  if (!from || !to || from.id === to.id) return { copied: 0, skipped: 0, reason: 'branch' as const };
  if (!manager) return { copied: 0, skipped: masters.length, reason: 'manager' as const };
  const have = new Set(existing.map((m) => m.name.toLowerCase()));
  let copied = 0;
  for (const m of masters) {
    // "Opening checklist — Rooftop" becomes "Opening checklist — Garden" when it names its branch.
    const name = m.name.includes(from.name) ? m.name.replace(from.name, to.name) : `${m.name} — ${to.name}`;
    if (have.has(name.toLowerCase())) continue;
    await db.$transaction(async (tx) => {
      const code = formatNumber('CHK', await nextCounter(tx, companyId, 'checklist'));
      await tx.checklistMaster.create({
        data: {
          companyId,
          code,
          name,
          departmentId: m.departmentId,
          branchId: to.id,
          items: m.items as object,
          frequency: m.frequency as object,
          dueMin: m.dueMin,
          windowHours: m.windowHours,
          doerIds: [manager.userId],
          verifierId: null,
          skipHolidays: m.skipHolidays,
          startDate: new Date().toISOString().slice(0, 10),
          active: true,
          createdById: actor.userId,
        },
      });
    });
    copied += 1;
  }
  await db.auditLog.create({
    data: {
      companyId,
      actorId: actor.userId,
      action: 'owner.checklists_copied',
      entityType: 'branch',
      entityId: to.id,
      after: { from: from.name, copied },
    },
  });
  return { copied, skipped: masters.length - copied, reason: null };
}
