import type { Db } from '@mono/db';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { branchWhere, need } from '../hosp/access';
import type { Actor } from '../work/actor';

/**
 * Phase 20 — what the restaurants sold and how the kitchen kept up, for a span of business days: sales by item,
 * category, steward or hour; kitchen tickets' time to ready by station; and the audit of voids, discounts and
 * no-charge bills. Everything is read from the POS's own rows — nothing is stored for a report.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const spanQuery = z.object({
  from: day,
  to: day,
  outletId: z.string().max(40).optional(),
  branchId: z.string().max(40).optional(),
});
export type Span = z.infer<typeof spanQuery>;

/** The outlets a person may read, narrowed to the one or the branch asked for. */
export async function outletsOf(db: Db, actor: Actor, q: Span) {
  need(actor, 'hosp.view', "You can't see hospitality");
  if (q.to < q.from) throw new AppError(400, 'VALIDATION_FAILED', 'The last day is on or after the first');
  const rows = await db.outlet.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...branchWhere(),
      ...(q.outletId ? { id: q.outletId } : {}),
      ...(q.branchId ? { AND: [{ branchId: q.branchId }] } : {}),
    },
    orderBy: { name: 'asc' },
  });
  return rows;
}

export const salesQuery = spanQuery.extend({
  by: z.enum(['item', 'category', 'steward', 'hour', 'outlet']).default('item'),
});
/**
 * Sales before tax (price × quantity of every line that was not voided or no-charge, on bills that stand),
 * grouped. "Hour" is the hour the line was punched, on the outlet's clock.
 */
export async function salesBy(db: Db, actor: Actor, input: z.input<typeof salesQuery>) {
  const q = salesQuery.parse(input);
  const outlets = await outletsOf(db, actor, q);
  const orders = await db.posOrder.findMany({
    where: {
      companyId: actor.companyId,
      outletId: { in: outlets.map((o) => o.id) },
      businessDay: { gte: q.from, lte: q.to },
      status: { in: ['BILLED', 'PAID'] },
    },
    select: { id: true, outletId: true, stewardId: true, covers: true, items: true },
  });
  const [stewards, branches, company] = await Promise.all([
    db.user.findMany({
      where: {
        id: { in: [...new Set(orders.map((o) => o.stewardId).filter((x): x is string => Boolean(x)))] },
      },
      select: { id: true, name: true },
    }),
    db.branch.findMany({
      where: { id: { in: outlets.map((o) => o.branchId) } },
      select: { id: true, timezone: true },
    }),
    db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } }),
  ]);
  const tzOf = new Map(
    outlets.map((o) => [o.id, branches.find((b) => b.id === o.branchId)?.timezone ?? company.timezone]),
  );
  const hourOf = (at: Date, tz: string) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(at).slice(0, 2);
  const groups = new Map<
    string,
    { key: string; label: string; qty: number; sales: number; orders: Set<string> }
  >();
  let total = 0;
  for (const o of orders)
    for (const i of o.items) {
      if (i.status === 'VOID' || i.status === 'HELD' || i.nc) continue;
      const amount = Math.round(Number(i.qty) * Number(i.price));
      const [key, label] =
        q.by === 'item'
          ? [`${i.menuItemId}:${i.variantKey}`, i.variantName ? `${i.name} (${i.variantName})` : i.name]
          : q.by === 'category'
            ? [i.category || '—', i.category || '—']
            : q.by === 'steward'
              ? [o.stewardId ?? '', stewards.find((s) => s.id === o.stewardId)?.name ?? '—']
              : q.by === 'outlet'
                ? [o.outletId, outlets.find((x) => x.id === o.outletId)?.name ?? '—']
                : (() => {
                    const h = hourOf(i.createdAt, tzOf.get(o.outletId)!);
                    return [h, `${h}:00`];
                  })();
      const g = groups.get(key) ?? { key, label, qty: 0, sales: 0, orders: new Set<string>() };
      g.qty += Number(i.qty);
      g.sales += amount;
      g.orders.add(o.id);
      groups.set(key, g);
      total += amount;
    }
  const rows = [...groups.values()]
    .map((g) => ({
      key: g.key,
      label: g.label,
      qty: Math.round(g.qty * 1000) / 1000,
      sales: g.sales,
      orders: g.orders.size,
      share: total ? Math.round((g.sales / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) =>
      q.by === 'hour' ? a.key.localeCompare(b.key) : b.sales - a.sales || a.label.localeCompare(b.label),
    );
  return {
    by: q.by,
    from: q.from,
    to: q.to,
    total,
    covers: orders.reduce((n, o) => n + o.covers, 0),
    orders: orders.length,
    rows,
  };
}

/** Kitchen tickets by station: how many, the average and slowest minutes from fired to ready, and how many took over the limit. */
export async function serviceTimes(db: Db, actor: Actor, input: z.input<typeof spanQuery>, limitMin = 20) {
  const q = spanQuery.parse(input);
  const outlets = await outletsOf(db, actor, q);
  const kots = await db.kot.findMany({
    where: {
      companyId: actor.companyId,
      outletId: { in: outlets.map((o) => o.id) },
      businessDay: { gte: q.from, lte: q.to },
      status: { not: 'CANCELLED' },
    },
    select: { stationId: true, firedAt: true, readyAt: true },
  });
  const stations = await db.station.findMany({
    where: { id: { in: [...new Set(kots.map((k) => k.stationId).filter((x): x is string => Boolean(x)))] } },
    select: { id: true, name: true },
  });
  const by = new Map<
    string,
    { tickets: number; ready: number; minutes: number; slowest: number; late: number }
  >();
  for (const k of kots) {
    const g = by.get(k.stationId ?? '') ?? { tickets: 0, ready: 0, minutes: 0, slowest: 0, late: 0 };
    g.tickets++;
    if (k.readyAt) {
      const min = Math.max(0, (k.readyAt.getTime() - k.firedAt.getTime()) / 60_000);
      g.ready++;
      g.minutes += min;
      g.slowest = Math.max(g.slowest, min);
      if (min > limitMin) g.late++;
    }
    by.set(k.stationId ?? '', g);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    limitMin,
    rows: [...by].map(([id, g]) => ({
      stationId: id || null,
      station: stations.find((s) => s.id === id)?.name ?? '—',
      tickets: g.tickets,
      // Tickets never marked ready (bumped straight away, or still open) are counted, not timed.
      timed: g.ready,
      avgMin: g.ready ? round(g.minutes / g.ready) : null,
      slowestMin: g.ready ? round(g.slowest) : null,
      late: g.late,
      onTimePct: g.ready ? Math.round(((g.ready - g.late) / g.ready) * 100) : null,
    })),
  };
}

/** Every void of a fired item, every discount and every no-charge bill of the span, with who and why. */
export async function auditTrail(db: Db, actor: Actor, input: z.input<typeof spanQuery>) {
  const q = spanQuery.parse(input);
  const outlets = await outletsOf(db, actor, q);
  const ids = outlets.map((o) => o.id);
  const span = { gte: q.from, lte: q.to };
  const [voids, checks] = await Promise.all([
    db.posOrderItem.findMany({
      where: {
        companyId: actor.companyId,
        status: 'VOID',
        firedAt: { not: null },
        order: { outletId: { in: ids }, businessDay: span },
      },
      include: { order: { select: { number: true, businessDay: true, outletId: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.posCheck.findMany({
      where: {
        companyId: actor.companyId,
        outletId: { in: ids },
        businessDay: span,
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const marked = checks.filter((c) => c.ncReason || (c.discount as { amount?: number } | null)?.amount);
  const people = new Map(
    (
      await db.user.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                [
                  ...voids.map((v) => v.voidById),
                  ...marked.map((c) => (c.discount as { byId?: string } | null)?.byId ?? c.createdById),
                ].filter((x): x is string => Boolean(x)),
              ),
            ],
          },
        },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const outlet = (id: string) => outlets.find((o) => o.id === id)?.name ?? '—';
  const voidRows = voids.map((v) => ({
    day: v.order.businessDay,
    outlet: outlet(v.order.outletId),
    order: v.order.number,
    item: v.name,
    qty: Number(v.qty),
    value: Math.round(Number(v.qty) * Number(v.price)),
    reason: v.voidReason,
    cooked: v.cooked,
    by: people.get(v.voidById ?? '') ?? '—',
  }));
  const discountRows = marked.map((c) => {
    const d = (c.discount ?? {}) as { amount?: number; type?: string; reason?: string; byId?: string };
    return {
      day: c.businessDay,
      outlet: outlet(c.outletId),
      bill: c.number,
      kind: c.ncReason ? ('NO_CHARGE' as const) : ('DISCOUNT' as const),
      amount: d.amount ?? 0,
      reason: c.ncReason ?? d.reason ?? d.type ?? null,
      by: people.get(d.byId ?? c.createdById ?? '') ?? '—',
    };
  });
  return {
    voids: voidRows,
    discounts: discountRows,
    totals: {
      voids: voidRows.reduce((n, v) => n + v.value, 0),
      discounts: discountRows.filter((d) => d.kind === 'DISCOUNT').reduce((n, d) => n + d.amount, 0),
      noCharge: discountRows.filter((d) => d.kind === 'NO_CHARGE').length,
    },
  };
}
