import type { Db } from '@mono/db';
import { addDays, bottlesAndMl, isLiquor, type ItemUnit } from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { stockRegister } from '../ims/stock-reports';
import type { Actor } from '../work/actor';
import { dmy, placeOf, seer } from './core';

/**
 * Phase 18 — the bar's excise register: for each liquor brand at a branch's stock locations, a day's opening,
 * receipts, sales, breakage and closing, in bottles and ml, with the licence it is kept under; and a file in the
 * state's layout.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const exciseQuery = z.object({ branchId: z.string().min(1), from: day, to: day.optional() });

type Qty = { bottles: number; ml: number };
export type ExciseRow = {
  day: string;
  location: string;
  itemId: string;
  brand: string;
  name: string;
  sizeMl: number;
  opening: Qty;
  received: Qty;
  sold: Qty;
  breakage: Qty;
  other: Qty;
  closing: Qty;
  /** The same in the stock unit (ml), for checking. */
  ml: { opening: number; received: number; sold: number; breakage: number; other: number; closing: number };
};

/** The bottle a brand is kept in: its container unit's size in stock units (ml). */
const bottleOf = (units: unknown) =>
  ((units as ItemUnit[] | null) ?? []).filter((u) => !u.serve).sort((a, b) => a.factor - b.factor)[0]
    ?.factor ?? 0;

export async function exciseRegister(db: Db, actor: Actor, q: z.infer<typeof exciseQuery>) {
  seer(actor);
  const place = await placeOf(db, actor, q.branchId);
  const to = q.to ?? q.from;
  if (to < q.from) throw new AppError(400, 'VALIDATION_FAILED', 'The last day is before the first');
  const days: string[] = [];
  for (let d = q.from; d <= to && days.length < 62; d = addDays(d, 1)) days.push(d);
  const bar = place.rules.bar;
  const locations = await db.location.findMany({
    where: { companyId: actor.companyId, branchId: q.branchId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  // The register reads stock as a stock keeper would, whatever the reader's own stock rights.
  const reader = { ...actor, permissions: [...actor.permissions, 'ims.view'] } as Actor;
  const rows: ExciseRow[] = [];
  const sizes = new Map<string, number>();
  for (const d of days)
    for (const loc of locations) {
      const reg = await stockRegister(db, reader, { locationId: loc.id, from: d, to: d });
      const ids = reg.rows.map((r) => r.itemId);
      const items = await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: ids } },
        select: { id: true, category: true, units: true },
      });
      for (const r of reg.rows) {
        const item = items.find((i) => i.id === r.itemId);
        if (!item || !isLiquor(bar, item.category)) continue;
        const size = sizes.get(r.itemId) ?? bottleOf(item.units);
        sizes.set(r.itemId, size);
        const q2 = (n: number) => bottlesAndMl(n, size);
        const other = r.adjusted - r.out;
        rows.push({
          day: d,
          location: loc.name,
          itemId: r.itemId,
          brand: r.brand ?? r.name,
          name: r.name,
          sizeMl: size,
          opening: q2(r.opening),
          received: q2(r.received),
          sold: q2(r.sold),
          breakage: q2(r.wasted),
          other: q2(Math.abs(other)),
          closing: q2(r.closing),
          ml: {
            opening: r.opening,
            received: r.received,
            sold: r.sold,
            breakage: r.wasted,
            other,
            closing: r.closing,
          },
        });
      }
    }
  return {
    branch: place.name,
    licenceNo: bar.licenceNo ?? null,
    permitNo: bar.permitNo ?? null,
    licensee: bar.licensee ?? null,
    format: bar.format,
    from: q.from,
    to,
    dryDays: bar.dryDays.filter((x) => x.date >= q.from && x.date <= to),
    rows,
  };
}

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
const bm = (x: Qty) => [x.bottles, x.ml];
/**
 * The register as a file. RAJASTHAN: a brand-wise daily stock register with bottles and ml side by side and the
 * licence in the heading. (The layout follows the usual retail-off / hotel-bar register; it must be checked
 * against the form the department gives the licensee before it is filed.)
 */
export async function exciseExport(db: Db, actor: Actor, q: z.infer<typeof exciseQuery>) {
  const r = await exciseRegister(db, actor, q);
  const head =
    r.format === 'RAJASTHAN'
      ? [
          ['Daily stock register of liquor (brand-wise)'],
          ['Licensee', r.licensee ?? '', 'Licence no.', r.licenceNo ?? '', 'Permit no.', r.permitNo ?? ''],
          ['Premises', r.branch, 'From', dmy(r.from), 'To', dmy(r.to)],
          [],
        ]
      : [[`Liquor register — ${r.branch}`, dmy(r.from), dmy(r.to)], []];
  return csv([
    ...head,
    [
      'Date',
      'Counter / store',
      'Brand',
      'Size (ml)',
      'Opening (bottles)',
      'Opening (ml)',
      'Received (bottles)',
      'Received (ml)',
      'Sold (bottles)',
      'Sold (ml)',
      'Breakage (bottles)',
      'Breakage (ml)',
      'Closing (bottles)',
      'Closing (ml)',
      'Remarks',
    ],
    ...r.rows.map((x) => [
      dmy(x.day),
      x.location,
      x.brand,
      x.sizeMl,
      ...bm(x.opening),
      ...bm(x.received),
      ...bm(x.sold),
      ...bm(x.breakage),
      ...bm(x.closing),
      r.dryDays.find((d) => d.date === x.day)?.reason ?? '',
    ]),
  ]);
}
