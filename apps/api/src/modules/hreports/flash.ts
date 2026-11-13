import type { Db } from '@mono/db';
import { addDays, cashTotal, formatINR, isLiquor, localDate } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { placeFor } from '../banquet/core';
import { claimMark } from '../ea/jobs';
import { hospOf } from '../hosp/access';
import { dayReport } from '../hosp/day';
import type { PosOutlet } from '../hosp/pos-core';
import type { OutletCharges } from '@mono/shared';
import type { AuditPack } from '../hotel/audit';

/**
 * Phase 20 — the daily flash: yesterday in one look. Each outlet's sales, guests and what a guest spent, its
 * voids, discounts and no-charge bills, and the cash counted against what the system expected; each property's
 * occupancy, ADR and RevPAR from its night audit; and what the food and the drink sold cost to make.
 */
export type Flash = Awaited<ReturnType<typeof flashFor>>;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);

export async function flashFor(db: Db, companyId: string, day: string, branchIds: string[] | null = null) {
  const h = await hospOf(db, companyId);
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const outlets = await db.outlet.findMany({
    where: { companyId, deletedAt: null, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    orderBy: { name: 'asc' },
  });
  const branches = await db.branch.findMany({
    where: { companyId, ...(branchIds ? { id: { in: branchIds } } : {}) },
    select: { id: true, name: true, timezone: true },
  });
  type OutletRow = {
    outletId: string;
    outlet: string;
    branch: string;
    sales: number;
    beforeTax: number;
    bills: number;
    covers: number;
    perCover: number;
    voids: { count: number; value: number };
    discounts: number;
    noCharge: number;
    unpaid: number;
    cashSystem: number;
    cashCounted: number | null;
    cashDiff: number | null;
    closed: boolean;
  };
  const rows: OutletRow[] = [];
  for (const o of outlets) {
    const outlet: PosOutlet = {
      ...o,
      tz: branches.find((b) => b.id === o.branchId)?.timezone ?? company.timezone,
      rules: h.rules,
      charges: o.charges as OutletCharges,
    };
    const r = await dayReport(db, outlet, day);
    const closed = await db.posDay.findUnique({
      where: { outletId_businessDay: { outletId: o.id, businessDay: day } },
    });
    const counted =
      closed?.status === 'CLOSED' ? cashTotal((closed.cash as Record<string, number> | null) ?? {}) : null;
    rows.push({
      outletId: o.id,
      outlet: o.name,
      branch: branches.find((b) => b.id === o.branchId)?.name ?? '',
      sales: r.sales,
      beforeTax: r.taxable,
      bills: r.bills,
      covers: r.covers,
      perCover: r.covers ? Math.round(r.taxable / r.covers) : 0,
      voids: r.voids,
      discounts: r.discounts,
      noCharge: r.noCharge,
      unpaid: r.unpaid,
      cashSystem: r.cash,
      cashCounted: counted,
      // Counted − expected: minus is short, plus is over. Unknown until the day is closed.
      cashDiff: counted == null ? null : counted - r.cash,
      closed: closed?.status === 'CLOSED',
    });
  }
  // Rooms: what each property's night audit of that day kept.
  const audits = await db.nightAudit.findMany({
    where: { companyId, day, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
  });
  const rooms = audits.map((a) => {
    const p = a.pack as unknown as AuditPack;
    return {
      branch: branches.find((b) => b.id === a.branchId)?.name ?? '',
      rooms: p.rooms,
      sold: p.sold,
      occupancyPct: p.occupancyPct,
      adr: p.adr,
      revPar: p.revPar,
      roomRevenue: p.roomRevenue,
    };
  });
  // Cost of what was sold: the stock the day's paid orders took, set against their sales, food and drink apart.
  const orders = await db.posOrder.findMany({
    where: {
      companyId,
      outletId: { in: outlets.map((o) => o.id) },
      businessDay: day,
      status: { in: ['BILLED', 'PAID'] },
    },
    select: { id: true, outletId: true, items: true },
  });
  const moves = await db.stockMove.findMany({
    where: { companyId, refType: 'pos_order', refId: { in: orders.map((o) => o.id) } },
    select: { itemId: true, value: true, refId: true },
  });
  const itemIds = [
    ...new Set([
      ...moves.map((m) => m.itemId),
      ...orders.flatMap((o) => o.items.map((i) => i.stockItemId).filter((x): x is string => Boolean(x))),
    ]),
  ];
  const category = new Map(
    (await db.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, category: true } })).map(
      (i) => [i.id, i.category],
    ),
  );
  const bars = new Map<string, Awaited<ReturnType<typeof placeFor>>['rules']['bar']>();
  for (const b of new Set(outlets.map((o) => o.branchId)))
    bars.set(b, (await placeFor(db, companyId, b)).rules.bar);
  const branchOfOrder = new Map(
    orders.map((o) => [o.id, outlets.find((x) => x.id === o.outletId)!.branchId]),
  );
  const drink = (branchId: string, itemId: string | null | undefined) =>
    Boolean(itemId) && isLiquor(bars.get(branchId)!, category.get(itemId!));
  const cost = { food: { sales: 0, cost: 0 }, beverage: { sales: 0, cost: 0 } };
  for (const o of orders)
    for (const i of o.items) {
      if (i.status === 'VOID' || i.status === 'HELD' || i.nc) continue;
      cost[drink(branchOfOrder.get(o.id)!, i.stockItemId) ? 'beverage' : 'food'].sales += Math.round(
        Number(i.qty) * Number(i.price),
      );
    }
  for (const m of moves)
    cost[drink(branchOfOrder.get(m.refId!)!, m.itemId) ? 'beverage' : 'food'].cost += Math.abs(
      Number(m.value ?? 0),
    );
  const sum = (f: (r: OutletRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const covers = sum((r) => r.covers);
  return {
    day,
    outlets: rows,
    rooms,
    cost: {
      food: { ...cost.food, pct: pct(cost.food.cost, cost.food.sales) },
      beverage: { ...cost.beverage, pct: pct(cost.beverage.cost, cost.beverage.sales) },
    },
    totals: {
      sales: sum((r) => r.sales),
      beforeTax: sum((r) => r.beforeTax),
      covers,
      perCover: covers ? Math.round(sum((r) => r.beforeTax) / covers) : 0,
      voids: sum((r) => r.voids.value),
      discounts: sum((r) => r.discounts),
      noCharge: sum((r) => r.noCharge),
      cashDiff: rows.some((r) => r.cashDiff != null) ? sum((r) => r.cashDiff ?? 0) : null,
      roomRevenue: rooms.reduce((n, r) => n + r.roomRevenue, 0),
    },
  };
}

/**
 * The flash goes to the owner at 08:00 on the company's clock, once a day, for yesterday — only where
 * hospitality is on and there is something to report (an outlet or a night audit).
 */
export async function flashSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const on = await db.hospSettings.findMany({
    where: { enabled: true, ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
    select: { companyId: true },
  });
  let sent = 0;
  for (const { companyId } of on) {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    if (!company) continue;
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: company.timezone, hour: '2-digit', hour12: false })
        .format(now)
        .slice(0, 2),
    );
    if (hour < 8) continue;
    const day = addDays(localDate(now, company.timezone), -1);
    if (!(await claimMark(db, companyId, `flash:${day}`))) continue;
    const f = await flashFor(db, companyId, day);
    if (!f.outlets.length && !f.rooms.length) continue;
    const room = f.rooms[0];
    const show = (n: number | null) => (n == null ? '—' : `${n}%`);
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId, actorId: null },
        {
          name: 'hosp.flash',
          entityType: 'company',
          entityId: companyId,
          payload: {
            day: day.split('-').reverse().join('/'),
            sales: formatINR(f.totals.sales),
            covers: f.totals.covers,
            perCover: formatINR(f.totals.perCover),
            occupancy: room ? `${room.occupancyPct}%` : '—',
            adr: room ? formatINR(room.adr) : '—',
            revPar: room ? formatINR(room.revPar) : '—',
            foodCost: show(f.cost.food.pct),
            beverageCost: show(f.cost.beverage.pct),
            cash:
              f.totals.cashDiff == null
                ? 'not counted'
                : f.totals.cashDiff === 0
                  ? 'matches'
                  : formatINR(f.totals.cashDiff),
            voids: formatINR(f.totals.voids),
            discounts: formatINR(f.totals.discounts),
            noCharge: f.totals.noCharge,
            link: `/hosp/reports?day=${day}`,
          },
        },
      ),
    );
    sent++;
  }
  return sent;
}
