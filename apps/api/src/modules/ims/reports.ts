import type { Db } from '@mono/db';
import { addDays, bottomByTurns, localDate, turnsOf, zonedToUtc } from '@mono/shared';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import { imsRulesOf, need } from './access';
import { tzOf } from './moves';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const periodSchema = z
  .object({ from: date, to: date })
  .refine((p) => p.from <= p.to, 'From must be before To');

/** Stock value by category (§10.3). */
export async function stockValue(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const items = await db.item.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    select: { category: true, stock: true, rate: true },
  });
  const by = new Map<string, { items: number; valuePaise: number }>();
  for (const i of items) {
    const k = i.category?.trim() || '—';
    const v = by.get(k) ?? { items: 0, valuePaise: 0 };
    v.items++;
    v.valuePaise += Math.round(Number(i.stock) * Number(i.rate));
    by.set(k, v);
  }
  const rows = [...by.entries()]
    .map(([category, v]) => ({ category, items: v.items, valuePaise: String(v.valuePaise) }))
    .sort((a, b) => Number(b.valuePaise) - Number(a.valuePaise));
  return { rows, totalPaise: String(rows.reduce((s, r) => s + Number(r.valuePaise), 0)) };
}

/** What came in, went out and was adjusted in a period, per item. */
export async function movement(db: Db, actor: Actor, p: z.infer<typeof periodSchema>) {
  need(actor, 'ims.view', "You can't see stock");
  const tz = await tzOf(db, actor.companyId);
  const moves = await db.stockMove.findMany({
    where: {
      companyId: actor.companyId,
      status: 'APPLIED',
      at: { gte: zonedToUtc(p.from, 0, tz), lt: zonedToUtc(p.to, 24 * 60, tz) },
    },
    select: {
      itemId: true,
      type: true,
      qty: true,
      rate: true,
      item: { select: { code: true, name: true, unit: true, rate: true } },
    },
  });
  const by = new Map<
    string,
    {
      code: string;
      name: string;
      unit: string;
      in: number;
      out: number;
      adjust: number;
      inValue: number;
      outValue: number;
    }
  >();
  for (const m of moves) {
    const r = by.get(m.itemId) ?? {
      code: m.item.code,
      name: m.item.name,
      unit: m.item.unit,
      in: 0,
      out: 0,
      adjust: 0,
      inValue: 0,
      outValue: 0,
    };
    const q = Number(m.qty);
    const rate = Number(m.rate ?? m.item.rate);
    if (m.type === 'IN') {
      r.in += q;
      r.inValue += q * rate;
    } else if (m.type === 'OUT') {
      r.out -= q;
      r.outValue -= q * rate;
    } else if (m.type === 'ADJUST') r.adjust += q;
    by.set(m.itemId, r);
  }
  const rows = [...by.entries()]
    .map(([id, r]) => ({
      id,
      ...r,
      inValuePaise: String(Math.round(r.inValue)),
      outValuePaise: String(Math.round(r.outValue)),
    }))
    .sort((a, b) => b.outValue - a.outValue);
  return {
    rows: rows.map(({ inValue: _i, outValue: _o, ...r }) => r),
    inPaise: String(Math.round(rows.reduce((s, r) => s + r.inValue, 0))),
    outPaise: String(Math.round(rows.reduce((s, r) => s + r.outValue, 0))),
  };
}

/**
 * Turns & NOS (§10.1): turns a year per item (a year's use ÷ average stock value), NOS = under N turns,
 * NOS share of stock value against the target, company turns for the last 90 days against the 90 before
 * (+ the growth target), and the slowest items offered for stopping.
 */
export async function turnsReport(db: Db, actor: Actor, now = new Date()) {
  need(actor, 'ims.view', "You can't see stock");
  const companyId = actor.companyId;
  const rules = (await imsRulesOf(db, companyId)).turns;
  const today = localDate(now, await tzOf(db, companyId));
  const yearAgo = addDays(today, -365);
  const items = await db.item.findMany({
    where: { companyId, deletedAt: null, active: true },
    select: { id: true, code: true, name: true, unit: true, stock: true, rate: true, createdAt: true },
  });
  const outs = await db.stockMove.findMany({
    where: {
      companyId,
      type: 'OUT',
      status: 'APPLIED',
      at: { gte: new Date(now.getTime() - 365 * 86_400_000) },
    },
    select: { itemId: true, qty: true, rate: true, at: true },
  });
  const avgOf = async (from: string, to: string) =>
    new Map(
      (
        await db.stockSnapshot.groupBy({
          by: ['itemId'],
          where: { companyId, date: { gte: from, lte: to } },
          _avg: { qty: true },
        })
      ).map((g) => [g.itemId, Number(g._avg.qty ?? 0)]),
    );
  const [avgYear, avgLast, avgPrev] = await Promise.all([
    avgOf(yearAgo, today),
    avgOf(addDays(today, -89), today),
    avgOf(addDays(today, -179), addDays(today, -90)),
  ]);
  const rateOf = new Map(items.map((i) => [i.id, Number(i.rate)]));
  const usedYear = new Map<string, number>();
  let usedLast = 0;
  let usedPrev = 0;
  const cut90 = now.getTime() - 90 * 86_400_000;
  const cut180 = now.getTime() - 180 * 86_400_000;
  for (const o of outs) {
    const v = -Number(o.qty) * Number(o.rate ?? rateOf.get(o.itemId) ?? 0);
    usedYear.set(o.itemId, (usedYear.get(o.itemId) ?? 0) + v);
    if (o.at.getTime() >= cut90) usedLast += v;
    else if (o.at.getTime() >= cut180) usedPrev += v;
  }
  const rows = items.map((i) => {
    const rate = Number(i.rate);
    const value = Number(i.stock) * rate;
    const avgValue = (avgYear.get(i.id) ?? Number(i.stock)) * rate;
    // An item tracked for less than a year: its use so far, scaled to a year.
    const tracked = Math.min(365, Math.max(30, (now.getTime() - i.createdAt.getTime()) / 86_400_000));
    const turns = turnsOf(((usedYear.get(i.id) ?? 0) * 365) / tracked, avgValue);
    return {
      id: i.id,
      code: i.code,
      name: i.name,
      unit: i.unit,
      turns,
      nos: turns !== null && turns < rules.nosTurnsBelow,
      value,
      valuePaise: String(Math.round(value)),
    };
  });
  const total = rows.reduce((s, r) => s + r.value, 0);
  const nosValue = rows.filter((r) => r.nos).reduce((s, r) => s + r.value, 0);
  const stockValueOf = (avg: Map<string, number>) =>
    items.reduce((s, i) => s + (avg.get(i.id) ?? 0) * Number(i.rate), 0);
  const annual = (used: number, avgValue: number) =>
    avgValue > 0 ? Math.round(((used * 365) / 90 / avgValue) * 10) / 10 : null;
  const last = annual(usedLast, stockValueOf(avgLast));
  const prev = annual(usedPrev, stockValueOf(avgPrev));
  return {
    rules,
    items: rows.sort((a, b) => (a.turns ?? 0) - (b.turns ?? 0)).map(({ value: _v, ...r }) => r),
    nosSharePct: total > 0 ? Math.round((nosValue / total) * 100) : 0,
    nosValuePaise: String(Math.round(nosValue)),
    turnsLast90: last,
    turnsPrev90: prev,
    turnsTarget: prev === null ? null : Math.round(prev * (1 + rules.turnsGrowthPct / 100) * 10) / 10,
    offerToStop: bottomByTurns(rows, rules.stopBottomPct).map((r) => r.id),
  };
}

/** Purchase in a period: orders by status and by vendor. */
export async function purchaseReport(db: Db, actor: Actor, p: z.infer<typeof periodSchema>) {
  need(actor, 'ims.view', "You can't see purchase orders");
  const tz = await tzOf(db, actor.companyId);
  const pos = await db.purchaseOrder.findMany({
    where: {
      companyId: actor.companyId,
      createdAt: { gte: zonedToUtc(p.from, 0, tz), lt: zonedToUtc(p.to, 24 * 60, tz) },
    },
    include: { lines: true },
  });
  const byVendor = new Map<string, { orders: number; ordered: number; received: number }>();
  const byStatus: Record<string, number> = {};
  for (const po of pos) {
    byStatus[po.status] = (byStatus[po.status] ?? 0) + 1;
    if (po.status === 'CANCELLED') continue;
    const v = byVendor.get(po.vendor) ?? { orders: 0, ordered: 0, received: 0 };
    v.orders++;
    for (const l of po.lines) {
      v.ordered += Number(l.qty) * Number(l.rate);
      v.received += Number(l.receivedQty) * Number(l.rate);
    }
    byVendor.set(po.vendor, v);
  }
  const vendors = [...byVendor.entries()]
    .map(([vendor, v]) => ({
      vendor,
      orders: v.orders,
      orderedPaise: String(Math.round(v.ordered)),
      receivedPaise: String(Math.round(v.received)),
    }))
    .sort((a, b) => Number(b.orderedPaise) - Number(a.orderedPaise));
  return {
    byStatus,
    vendors,
    orderedPaise: String(vendors.reduce((s, v) => s + Number(v.orderedPaise), 0)),
    receivedPaise: String(vendors.reduce((s, v) => s + Number(v.receivedPaise), 0)),
  };
}
