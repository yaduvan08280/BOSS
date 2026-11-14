import type { Db } from '@mono/db';
import type { Actor } from '../work/actor';
import { needOwner, num, pct } from './core';

type Line = { itemId: string; received: number; rejected: number; rate: number; poRate: number | null };

/**
 * Vendor scorecard (last 180 days): orders, how many arrived by the expected day, how much was rejected at the
 * gate, how their rates moved, and — per item — whether another vendor's latest rate is lower.
 */
export async function vendors(db: Db, actor: Actor) {
  needOwner(actor);
  const companyId = actor.companyId;
  const since = new Date(Date.now() - 180 * 86_400_000);
  const [orders, receipts, items] = await Promise.all([
    db.purchaseOrder.findMany({
      where: { companyId, createdAt: { gte: since }, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        vendor: true,
        expectedOn: true,
        sentAt: true,
        lines: { select: { itemId: true, qty: true, rate: true } },
      },
    }),
    db.goodsReceipt.findMany({
      where: { companyId, createdAt: { gte: since } },
      select: { vendor: true, poId: true, lines: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.item.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true, name: true, unit: true, leadTimeDays: true },
    }),
  ]);
  const item = new Map(items.map((i) => [i.id, i]));
  const key = (v: string | null | undefined) => (v ?? '').trim() || '—';
  type V = {
    vendor: string;
    orders: number;
    value: number;
    deliveries: number;
    onTime: number;
    timed: number;
    received: number;
    rejected: number;
    rateUps: number;
    rateDowns: number;
  };
  const rows = new Map<string, V>();
  const row = (v: string) =>
    rows.get(v) ??
    rows
      .set(v, {
        vendor: v,
        orders: 0,
        value: 0,
        deliveries: 0,
        onTime: 0,
        timed: 0,
        received: 0,
        rejected: 0,
        rateUps: 0,
        rateDowns: 0,
      })
      .get(v)!;
  const po = new Map(orders.map((o) => [o.id, o]));
  for (const o of orders) {
    const r = row(key(o.vendor));
    r.orders += 1;
    r.value += o.lines.reduce((n, l) => n + num(l.qty) * num(l.rate), 0);
  }
  // The latest rate each vendor charged for each item, and the one before it.
  const rates = new Map<string, Map<string, { last: number; prev: number | null }>>();
  for (const g of receipts) {
    const v = key(g.vendor ?? (g.poId ? po.get(g.poId)?.vendor : null));
    const r = row(v);
    r.deliveries += 1;
    const order = g.poId ? po.get(g.poId) : undefined;
    if (order) {
      // Expected day when the order has one, else the longest lead time of its items from the day it was sent.
      const lead = Math.max(0, ...order.lines.map((l) => item.get(l.itemId)?.leadTimeDays ?? 0));
      const due = order.expectedOn
        ? new Date(`${order.expectedOn}T23:59:59+05:30`)
        : order.sentAt
          ? new Date(order.sentAt.getTime() + (lead + 1) * 86_400_000)
          : null;
      if (due) {
        r.timed += 1;
        if (g.createdAt <= due) r.onTime += 1;
      }
    }
    for (const l of (g.lines as Line[] | null) ?? []) {
      r.received += num(l.received);
      r.rejected += num(l.rejected);
      const mine = rates.get(l.itemId) ?? rates.set(l.itemId, new Map()).get(l.itemId)!;
      const before = mine.get(v);
      if (before && before.last !== l.rate) {
        if (l.rate > before.last) r.rateUps += 1;
        else r.rateDowns += 1;
      }
      mine.set(v, { last: l.rate, prev: before?.last ?? null });
    }
  }
  const cheaper: {
    item: string;
    unit: string;
    vendor: string;
    rate: number;
    other: string;
    otherRate: number;
    savePct: number;
  }[] = [];
  for (const [itemId, byVendor] of rates) {
    if (byVendor.size < 2) continue;
    const sorted = [...byVendor].sort((a, b) => a[1].last - b[1].last);
    const [best, bestRate] = [sorted[0]![0], sorted[0]![1].last];
    for (const [v, r] of sorted.slice(1))
      if (r.last > bestRate && bestRate > 0)
        cheaper.push({
          item: item.get(itemId)?.name ?? '',
          unit: item.get(itemId)?.unit ?? '',
          vendor: v,
          rate: r.last,
          other: best,
          otherRate: bestRate,
          savePct: Math.round(((r.last - bestRate) / r.last) * 1000) / 10,
        });
  }
  return {
    since: since.toISOString().slice(0, 10),
    vendors: [...rows.values()]
      .map((r) => ({
        ...r,
        value: Math.round(r.value),
        onTimePct: pct(r.onTime, r.timed),
        rejectedPct: pct(r.rejected, r.received + r.rejected),
      }))
      .sort((a, b) => b.value - a.value),
    cheaper: cheaper.sort((a, b) => b.savePct - a.savePct).slice(0, 30),
  };
}
