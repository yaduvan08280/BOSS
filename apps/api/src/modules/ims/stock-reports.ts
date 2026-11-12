import type { Db } from '@mono/db';
import { fifoValue, packUnit, serveUnit, wholeAndOpen, zonedToUtc, type ItemUnit } from '@mono/shared';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import { imsRulesOf, need } from './access';
import type { CountLine } from './closing';
import { clockOf, needPlace, num, r3, reachPlaces } from './v2';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const varianceQuery = z.object({
  locationId: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
});
/** Theoretical against actual: every line of the approved counts in a period, worst first. */
export async function varianceReport(db: Db, actor: Actor, q: z.infer<typeof varianceQuery> = {}) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const counts = await db.stockCount.findMany({
    where: {
      companyId: actor.companyId,
      status: 'APPROVED',
      locationId: q.locationId !== undefined ? q.locationId : { in: [...mine.keys()] },
      ...(q.from || q.to
        ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
        : {}),
    },
    orderBy: { date: 'desc' },
    take: 200,
  });
  const ids = [...new Set(counts.flatMap((c) => (c.lines as CountLine[]).map((l) => l.itemId)))];
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: ids } },
        select: { id: true, code: true, name: true, unit: true, rate: true },
      })
    ).map((i) => [i.id, i]),
  );
  return counts
    .filter((c) => mine.has(c.locationId))
    .flatMap((c) =>
      (c.lines as CountLine[]).map((l) => ({
        count: c.number,
        date: c.date,
        location: mine.get(c.locationId)!.name,
        itemId: l.itemId,
        code: items.get(l.itemId)?.code ?? '',
        name: items.get(l.itemId)?.name ?? '',
        unit: items.get(l.itemId)?.unit ?? '',
        system: l.system ?? 0,
        counted: l.counted ?? 0,
        theoretical: l.theoretical ?? 0,
        /** What was really used: what the recipes took, plus what is missing (or less what was extra). */
        actual: r3((l.theoretical ?? 0) - (l.diff ?? 0)),
        variance: l.diff ?? 0,
        pct: l.pct,
        flagged: l.flagged,
        value: Math.round((l.diff ?? 0) * Number(items.get(l.itemId)?.rate ?? 0)),
      })),
    )
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || a.value - b.value);
}

/**
 * Stock value per location and branch, by the company's rule: weighted average (what each balance holds) or
 * FIFO (the newest receipts into the location cover what is there).
 */
export async function valuation(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const rules = await imsRulesOf(db, actor.companyId);
  const balances = await db.stockBalance.findMany({
    where: { companyId: actor.companyId, locationId: { in: [...mine.keys()] }, qty: { gt: 0 } },
  });
  const held = new Map<string, { itemId: string; locationId: string; qty: number; avg: number }>();
  for (const b of balances) {
    const k = `${b.itemId}|${b.locationId}`;
    const h = held.get(k) ?? { itemId: b.itemId, locationId: b.locationId, qty: 0, avg: 0 };
    h.qty = r3(h.qty + num(b.qty));
    h.avg += Number(b.value);
    held.set(k, h);
  }
  const rates = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: [...new Set(balances.map((b) => b.itemId))] } },
        select: { id: true, rate: true },
      })
    ).map((i) => [i.id, Number(i.rate)]),
  );
  const fifo = new Map<string, number>();
  if (rules.stock.valuation === 'FIFO') {
    for (const h of held.values()) {
      // What came into this location, newest first: receipts, production, and transfers in at their value.
      const ins = await db.stockMove.findMany({
        where: {
          companyId: actor.companyId,
          itemId: h.itemId,
          status: 'APPLIED',
          OR: [
            { locationId: h.locationId, qty: { gt: 0 } },
            { toLocationId: h.locationId, type: 'TRANSFER' },
          ],
        },
        orderBy: { at: 'desc' },
        take: 200,
      });
      fifo.set(
        `${h.itemId}|${h.locationId}`,
        fifoValue(
          ins.map((m) => {
            const qty = num(m.qty) > 0 ? num(m.qty) : num(m.lineQty);
            const value = m.value === null ? qty * Number(m.rate ?? 0n) : Number(m.value);
            return { qty, rate: qty > 0 ? value / qty : 0 };
          }),
          h.qty,
          rates.get(h.itemId) ?? 0,
        ),
      );
    }
  }
  const byLocation = new Map<
    string,
    {
      locationId: string;
      location: string;
      branchId: string | null;
      branch: string | null;
      items: number;
      value: number;
    }
  >();
  for (const [k, h] of held) {
    const p = mine.get(h.locationId)!;
    const row = byLocation.get(h.locationId) ?? {
      locationId: p.id,
      location: p.name,
      branchId: p.branchId,
      branch: p.branch,
      items: 0,
      value: 0,
    };
    row.items += 1;
    row.value += rules.stock.valuation === 'FIFO' ? (fifo.get(k) ?? 0) : Math.round(h.avg);
    byLocation.set(h.locationId, row);
  }
  const byBranch = new Map<string, { branchId: string | null; branch: string; value: number }>();
  for (const l of byLocation.values()) {
    const k = l.branchId ?? '';
    const b = byBranch.get(k) ?? { branchId: l.branchId, branch: l.branch ?? 'Group', value: 0 };
    b.value += l.value;
    byBranch.set(k, b);
  }
  const locations = [...byLocation.values()].sort((a, b) => b.value - a.value);
  return {
    method: rules.stock.valuation,
    total: locations.reduce((n, l) => n + l.value, 0),
    locations,
    branches: [...byBranch.values()],
  };
}

export const registerQuery = z.object({
  locationId: z.string().default(''),
  from: day,
  to: day,
  category: z.string().optional(),
});
/**
 * A location's register for a period, item by item (brand by brand for a bar): opening, received, sold,
 * wasted / broken, sent out, closing — in the stock unit and as bottles + open ml and pegs where the item has them.
 */
export async function stockRegister(db: Db, actor: Actor, input: z.input<typeof registerQuery>) {
  need(actor, 'ims.view', "You can't see stock");
  const q = registerQuery.parse(input);
  const place = await needPlace(db, actor.companyId, q.locationId);
  const { tz } = await clockOf(db, actor.companyId);
  const start = zonedToUtc(q.from, 0, tz);
  const end = zonedToUtc(q.to, 24 * 60, tz);
  const moves = await db.stockMove.findMany({
    where: {
      companyId: actor.companyId,
      status: 'APPLIED',
      at: { gte: start },
      OR: [{ locationId: place.id }, { toLocationId: place.id }],
    },
    select: {
      itemId: true,
      type: true,
      qty: true,
      lineQty: true,
      reason: true,
      refType: true,
      locationId: true,
      toLocationId: true,
      at: true,
    },
  });
  const now = new Map<string, number>();
  for (const b of await db.stockBalance.findMany({
    where: { companyId: actor.companyId, locationId: place.id },
  }))
    now.set(b.itemId, r3((now.get(b.itemId) ?? 0) + num(b.qty)));
  type Row = { received: number; sold: number; wasted: number; out: number; adjusted: number; after: number };
  const rows = new Map<string, Row>();
  const row = (id: string) =>
    rows.get(id) ?? rows.set(id, { received: 0, sold: 0, wasted: 0, out: 0, adjusted: 0, after: 0 }).get(id)!;
  for (const m of moves) {
    // The change at this location: a real transfer leaves one place and arrives at the other.
    const real = m.type === 'TRANSFER' && m.toLocationId !== null;
    const delta = real
      ? m.toLocationId === place.id
        ? num(m.lineQty)
        : -num(m.lineQty)
      : m.locationId === place.id
        ? num(m.qty)
        : 0;
    if (!delta) continue;
    const r = row(m.itemId);
    if (m.at >= end) {
      r.after = r3(r.after + delta);
      continue;
    }
    if (
      m.refType === 'wastage' ||
      m.reason === 'DAMAGED' ||
      m.reason === 'EXPIRED' ||
      m.reason === 'BREAKAGE'
    )
      r.wasted = r3(r.wasted - delta);
    else if (m.reason === 'RECIPE' || m.reason === 'SALE') r.sold = r3(r.sold - delta);
    else if (m.type === 'ADJUST') r.adjusted = r3(r.adjusted + delta);
    else if (delta > 0) r.received = r3(r.received + delta);
    else r.out = r3(r.out - delta);
  }
  const ids = [...new Set([...rows.keys(), ...now.keys()])];
  const items = await db.item.findMany({
    where: { companyId: actor.companyId, id: { in: ids }, ...(q.category ? { category: q.category } : {}) },
    orderBy: [{ brand: 'asc' }, { name: 'asc' }],
  });
  return {
    location: place,
    from: q.from,
    to: q.to,
    rows: items
      .map((i) => {
        const r = rows.get(i.id) ?? { received: 0, sold: 0, wasted: 0, out: 0, adjusted: 0, after: 0 };
        const closing = r3((now.get(i.id) ?? 0) - r.after);
        const opening = r3(closing - r.received + r.sold + r.wasted + r.out - r.adjusted);
        const bottle = packUnit(i.units as ItemUnit[] | null);
        const peg = serveUnit(i.units as ItemUnit[] | null);
        return {
          itemId: i.id,
          code: i.code,
          name: i.name,
          brand: i.brand,
          unit: i.unit,
          opening,
          ...r,
          closing,
          bottles: bottle ? { unit: bottle.unit, ...wholeAndOpen(closing, bottle.factor) } : null,
          pegsSold: peg ? r3(r.sold / peg.factor) : null,
        };
      })
      .filter((r) => r.opening || r.closing || r.received || r.sold || r.wasted || r.out || r.adjusted),
  };
}
