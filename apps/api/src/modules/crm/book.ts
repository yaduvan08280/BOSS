import { Prisma, type Db, type Tx } from '@mono/db';
import {
  addDays,
  ageBucket,
  autoTags,
  scotOf,
  type AutoTag,
  type CustomerStats,
  type ScotRow,
} from '@mono/shared';
import { crmConfigOf, fyCalendar, seatPeople } from './access';

export type BookRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  mobile: string | null;
  email: string | null;
  segment: string | null;
  handledById: string | null;
  creditDays: number;
  ownerCustomer: boolean;
  lostAt: Date | null;
  lostReason: string | null;
  fields: unknown;
  createdAt: Date;
  sales12: number;
  gp12: number;
  orders12: number;
  ordersAll: number;
  firstOrder: string | null;
  lastOrder: string | null;
  /** Billed − paid, and what of it is past due, by age. */
  receivable: number;
  overdue: number;
  ageing: Record<'0_30' | '31_60' | '61_90' | '90_plus', number>;
  dueToday: number;
  autoTags: AutoTag[];
  tags: string[];
  scot: ScotRow;
};

/**
 * Every customer with their numbers (§11.2): 12 months' sales and GP, order counts, receivables by age (payments
 * set against the oldest orders first), the automatic tags and the SCOT rhythm.
 */
export async function customerBook(db: Db | Tx, companyId: string, opts: { ids?: string[] } = {}) {
  const config = await crmConfigOf(db, companyId);
  const f = await fyCalendar(db, companyId);
  const today = f.today;
  const since = addDays(today, -365);
  // Years of orders and payments are added up by the database (a customer's counts, what is still unpaid, how
  // late they pay); only the last 12 months of orders come into memory, for the rhythm and what they buy.
  const only = opts.ids?.length ? Prisma.sql`AND customer_id IN (${Prisma.join(opts.ids)})` : Prisma.empty;
  if (opts.ids && !opts.ids.length) return { rows: [] as BookRow[], today, config, f };
  const [customers, recentOrders, totals, unpaid, delays, ownerSeat] = await Promise.all([
    db.customer.findMany({
      where: { companyId, deletedAt: null, ...(opts.ids ? { id: { in: opts.ids } } : {}) },
      include: { tags: { select: { tag: true } } },
      orderBy: { name: 'asc' },
    }),
    db.salesOrder.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        orderDate: { gte: since },
        ...(opts.ids ? { customerId: { in: opts.ids } } : {}),
      },
      select: { customerId: true, orderDate: true, amount: true, gp: true, items: true },
      orderBy: { orderDate: 'asc' },
    }),
    db.$queryRaw<{ customer_id: string; orders: number; first: string; last: string }[]>`
      SELECT customer_id, count(*)::int AS orders, min(order_date) AS first, max(order_date) AS last
      FROM sales_orders
      WHERE company_id = ${companyId} AND status <> 'CANCELLED' ${only}
      GROUP BY customer_id`,
    // Payments are set against the oldest orders first: an order is unpaid by what its running total
    // (oldest first) exceeds everything the customer ever paid — never more than the order itself.
    db.$queryRaw<{ customer_id: string; due_on: string; owed: string }[]>`
      WITH paid AS (
        SELECT customer_id, sum(amount) AS total FROM payments
        WHERE company_id = ${companyId} ${only} GROUP BY customer_id
      ), o AS (
        SELECT customer_id, due_on, amount,
               sum(amount) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS cum
        FROM sales_orders
        WHERE company_id = ${companyId} AND status <> 'CANCELLED' ${only}
      )
      SELECT o.customer_id, o.due_on, least(o.amount, o.cum - coalesce(paid.total, 0))::text AS owed
      FROM o LEFT JOIN paid USING (customer_id)
      WHERE o.cum > coalesce(paid.total, 0)`,
    // "Pays late": for every order paid off in full, the day the payments reached its running total, against
    // its due date. Orders and payments are laid on one line by their running totals; walking it from the
    // top, the earliest payment at or above an order's total is the one that paid it off.
    db.$queryRaw<{ customer_id: string; delay: number | null }[]>`
      WITH line AS (
        SELECT customer_id, due_on, NULL::text AS paid_on, 1 AS kind, amount,
               sum(amount) OVER (PARTITION BY customer_id ORDER BY order_date, id) AS cum
        FROM sales_orders
        WHERE company_id = ${companyId} AND status <> 'CANCELLED' ${only}
        UNION ALL
        SELECT customer_id, NULL, date, 0, amount,
               sum(amount) OVER (PARTITION BY customer_id ORDER BY date, id)
        FROM payments
        WHERE company_id = ${companyId} ${only}
      ), walked AS (
        SELECT customer_id, kind, due_on, amount,
               min(paid_on) OVER (PARTITION BY customer_id ORDER BY cum DESC, kind
                                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS paid_on
        FROM line
      )
      SELECT customer_id, avg(greatest(0, paid_on::date - due_on::date))::float8 AS delay
      FROM walked
      WHERE kind = 1 AND amount > 0 AND paid_on IS NOT NULL
      GROUP BY customer_id`,
    seatPeople(db, companyId, 'owner', config),
  ]);
  // (Appending to each customer's own list: copying the list for every row made this quadratic.)
  const byCustomer = <T, K extends keyof T>(xs: T[], key: K) => {
    const m = new Map<T[K], T[]>();
    for (const x of xs) {
      const list = m.get(x[key]);
      if (list) list.push(x);
      else m.set(x[key], [x]);
    }
    return m;
  };
  const ord = byCustomer(recentOrders, 'customerId');
  const owing = byCustomer(unpaid, 'customer_id');
  const totalOf = new Map(totals.map((t) => [t.customer_id, t]));
  const delayOf = new Map(delays.map((d) => [d.customer_id, d.delay]));
  const stats: CustomerStats[] = [];
  const partial = customers.map((c) => {
    const recent = ord.get(c.id) ?? [];
    const ageing = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
    let overdue = 0;
    let dueToday = 0;
    for (const o of owing.get(c.id) ?? []) {
      const owed = Number(o.owed);
      if (owed <= 0) continue;
      ageing[ageBucket(o.due_on, today)] += owed;
      if (o.due_on < today) overdue += owed;
      if (o.due_on === today) dueToday += owed;
    }
    const all = totalOf.get(c.id);
    const s: CustomerStats = {
      id: c.id,
      sales12: recent.reduce((a, o) => a + Number(o.amount), 0),
      gp12: recent.reduce((a, o) => a + Number(o.gp), 0),
      orders: all?.orders ?? 0,
      firstOrder: all?.first ?? null,
      lastOrder: all?.last ?? null,
      createdOn: c.createdAt.toISOString().slice(0, 10),
      payDelayDays: delayOf.get(c.id) ?? null,
      creditDays: c.creditDays,
      lostAt: c.lostAt ? c.lostAt.toISOString().slice(0, 10) : null,
      owners: c.ownerCustomer || (c.handledById !== null && ownerSeat.includes(c.handledById)),
    };
    stats.push(s);
    const scot = scotOf(
      recent.map((o) => ({
        date: o.orderDate,
        amount: Number(o.amount),
        items: (Array.isArray(o.items) ? (o.items as { item?: string }[]) : [])
          .map((i) => String(i.item ?? ''))
          .filter(Boolean),
      })),
      today,
      {
        callBeforeDays: config.scot.callBeforeDays,
        isWorking: config.scot.moveOffHolidays ? f.isWorking : undefined,
      },
    );
    return {
      c,
      s,
      scot,
      ageing,
      overdue,
      dueToday,
      receivable: Object.values(ageing).reduce((a, b) => a + b, 0),
    };
  });
  const tags = autoTags(stats, today, config.customers);
  const rows: BookRow[] = partial.map(({ c, s, scot, ageing, overdue, dueToday, receivable }) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    city: c.city,
    mobile: c.mobile,
    email: c.email,
    segment: c.segment,
    handledById: c.handledById,
    creditDays: c.creditDays,
    ownerCustomer: c.ownerCustomer,
    lostAt: c.lostAt,
    lostReason: c.lostReason,
    fields: c.fields,
    createdAt: c.createdAt,
    sales12: s.sales12,
    gp12: s.gp12,
    orders12: scot.orders,
    ordersAll: s.orders,
    firstOrder: s.firstOrder,
    lastOrder: s.lastOrder,
    receivable,
    overdue,
    ageing,
    dueToday,
    autoTags: tags.get(c.id) ?? [],
    tags: c.tags.map((t) => t.tag),
    // Lost customers (and sleeping ones, unless SCOT includes them) go to win-back calls instead.
    scot:
      (tags.get(c.id) ?? []).includes('lost') ||
      ((tags.get(c.id) ?? []).includes('sleeping') && !config.scot.includeSleeping)
        ? { ...scot, onScot: false }
        : scot,
  }));
  return { rows, today, config, f };
}
