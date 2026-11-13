import type { Db } from '@mono/db';
import { addDays } from '@mono/shared';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import { outletsOf, serviceTimes } from './sales';

/**
 * Phase 20 — the hospitality lines of the Weekly MIS: what each steward sold and voided, how each kitchen
 * station kept its time, and what each housekeeper cleaned and had passed at inspection — Monday to Sunday.
 */
export const weekQuery = z.object({
  /** Any day of the week wanted (YYYY-MM-DD). */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().max(40).optional(),
});
const monday = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
};

export async function teamWeek(db: Db, actor: Actor, input: z.input<typeof weekQuery>) {
  const q = weekQuery.parse(input);
  const from = monday(q.day);
  const to = addDays(from, 6);
  const span = { from, to, branchId: q.branchId };
  const outlets = await outletsOf(db, actor, span);
  const orders = await db.posOrder.findMany({
    where: {
      companyId: actor.companyId,
      outletId: { in: outlets.map((o) => o.id) },
      businessDay: { gte: from, lte: to },
      status: { not: 'CANCELLED' },
    },
    select: { stewardId: true, covers: true, status: true, items: true },
  });
  const branchIds = [...new Set(outlets.map((o) => o.branchId))];
  const hk = await db.hkTask.findMany({
    where: {
      companyId: actor.companyId,
      branchId: { in: branchIds },
      day: { gte: from, lte: to },
      kind: 'CLEAN',
    },
    select: { doneById: true, assigneeId: true, status: true },
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                [...orders.map((o) => o.stewardId), ...hk.map((t) => t.doneById ?? t.assigneeId)].filter(
                  (x): x is string => Boolean(x),
                ),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const stewards = new Map<
    string,
    { orders: number; covers: number; sales: number; voids: number; voidValue: number }
  >();
  for (const o of orders) {
    const s = stewards.get(o.stewardId ?? '') ?? { orders: 0, covers: 0, sales: 0, voids: 0, voidValue: 0 };
    s.orders++;
    s.covers += o.covers;
    for (const i of o.items) {
      const amount = Math.round(Number(i.qty) * Number(i.price));
      if (i.status === 'VOID') {
        if (!i.firedAt) continue;
        s.voids++;
        s.voidValue += amount;
      } else if (i.status !== 'HELD' && !i.nc && ['BILLED', 'PAID'].includes(o.status)) s.sales += amount;
    }
    stewards.set(o.stewardId ?? '', s);
  }
  const keepers = new Map<string, { given: number; cleaned: number; passed: number }>();
  for (const t of hk) {
    const id = t.doneById ?? t.assigneeId ?? '';
    const k = keepers.get(id) ?? { given: 0, cleaned: 0, passed: 0 };
    k.given++;
    if (t.status !== 'OPEN') k.cleaned++;
    if (t.status === 'INSPECTED') k.passed++;
    keepers.set(id, k);
  }
  return {
    week: { from, to },
    stewards: [...stewards]
      .map(([id, s]) => ({
        id: id || null,
        name: names.get(id) ?? '—',
        ...s,
        perCover: s.covers ? Math.round(s.sales / s.covers) : 0,
      }))
      .sort((a, b) => b.sales - a.sales),
    stations: (await serviceTimes(db, actor, span)).rows,
    housekeeping: [...keepers]
      .map(([id, k]) => ({
        id: id || null,
        name: names.get(id) ?? '—',
        ...k,
        donePct: k.given ? Math.round((k.cleaned / k.given) * 100) : 0,
      }))
      .sort((a, b) => b.cleaned - a.cleaned),
  };
}
