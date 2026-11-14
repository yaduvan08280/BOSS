import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, num, places, spanOf } from './core';

type Who = {
  userId: string;
  name: string;
  branch: string;
  voids: number;
  voidCount: number;
  discounts: number;
  noCharge: number;
  cancelled: number;
  cashShort: number;
  wastage: number;
  total: number;
};

/**
 * Where money may be leaking, by person: fired items voided, discounts given, no-charge bills, bills cancelled
 * after printing, cash short on the days they closed, and stock they wrote off. Every figure is in paise; the
 * total ranks people by rupees nobody has explained. It points at where to look — it accuses nobody.
 */
export async function leaks(db: Db, actor: Actor, from?: string, to?: string) {
  needOwner(actor);
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId, from, to);
  const pl = await places(db, companyId);
  const days = { gte: s.from, lte: s.to };
  const [voids, checks, posDays, waste, sold] = await Promise.all([
    db.posOrderItem.findMany({
      where: { companyId, status: 'VOID', voidReason: { not: null }, order: { businessDay: days } },
      select: { price: true, qty: true, voidById: true, createdById: true, voidReason: true, cooked: true },
    }),
    db.posCheck.findMany({
      where: { companyId, businessDay: days },
      select: {
        status: true,
        total: true,
        discount: true,
        ncReason: true,
        createdById: true,
        cancelledById: true,
      },
    }),
    db.posDay.findMany({
      where: { companyId, businessDay: days },
      select: { outletId: true, closedById: true, report: true, businessDay: true },
    }),
    db.stockMove.findMany({
      where: {
        companyId,
        refType: 'wastage',
        at: { gte: s.start, lt: s.end },
        status: { in: ['APPLIED', 'DONE', 'APPROVED'] },
      },
      select: { createdById: true, value: true, qty: true, rate: true, reason: true, locationId: true },
    }),
    db.posCheck.aggregate({
      where: { companyId, businessDay: days, status: { not: 'CANCELLED' } },
      _sum: { total: true },
    }),
  ]);
  const rows = new Map<string, Who>();
  const row = (userId: string | null | undefined) => {
    const id = userId ?? 'unknown';
    if (!rows.has(id)) {
      const person = pl.people.find((p) => p.id === id);
      rows.set(id, {
        userId: id,
        name: person?.name ?? '—',
        branch: pl.branches.find((b) => b.id === person?.branchId)?.name ?? '',
        voids: 0,
        voidCount: 0,
        discounts: 0,
        noCharge: 0,
        cancelled: 0,
        cashShort: 0,
        wastage: 0,
        total: 0,
      });
    }
    return rows.get(id)!;
  };
  const reasons = new Map<string, number>();
  for (const v of voids) {
    const value = num(v.price) * num(v.qty);
    const r = row(v.voidById ?? v.createdById);
    r.voids += value;
    r.voidCount += 1;
    const why = (v.voidReason ?? '').trim() || '—';
    reasons.set(why, (reasons.get(why) ?? 0) + value);
  }
  for (const c of checks) {
    if (c.status === 'CANCELLED') row(c.cancelledById ?? c.createdById).cancelled += num(c.total);
    else {
      const d = num((c.discount as { amount?: number } | null)?.amount);
      if (d) row(c.createdById).discounts += d;
      if (c.ncReason) row(c.createdById).noCharge += 1;
    }
  }
  for (const d of posDays) {
    const diff = num((d.report as { difference?: number } | null)?.difference);
    if (diff < 0) row(d.closedById).cashShort += -diff;
  }
  const byPlace = new Map<string, number>();
  for (const w of waste) {
    const value = Math.abs(num(w.value) || num(w.qty) * num(w.rate));
    row(w.createdById).wastage += value;
    const place = pl.locationName.get(w.locationId) ?? 'Main store';
    byPlace.set(place, (byPlace.get(place) ?? 0) + value);
  }
  const people = [...rows.values()]
    .map((r) => ({ ...r, total: r.voids + r.discounts + r.cancelled + r.cashShort + r.wastage }))
    .filter((r) => r.total > 0 || r.noCharge > 0)
    .sort((a, b) => b.total - a.total);
  const sum = (k: keyof Who) => people.reduce((n, r) => n + (r[k] as number), 0);
  return {
    from: s.from,
    to: s.to,
    sales: num(sold._sum.total),
    totals: {
      voids: sum('voids'),
      discounts: sum('discounts'),
      cancelled: sum('cancelled'),
      cashShort: sum('cashShort'),
      wastage: sum('wastage'),
      all: sum('total'),
    },
    people: people.slice(0, 50),
    voidReasons: [...reasons]
      .map(([reason, value]) => ({ reason, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    wastageByPlace: [...byPlace]
      .map(([place, value]) => ({ place, value }))
      .sort((a, b) => b.value - a.value),
  };
}
