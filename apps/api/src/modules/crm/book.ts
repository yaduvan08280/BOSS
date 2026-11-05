import type { Db, Tx } from '@mono/db';
import {
  addDays,
  ageBucket,
  autoTags,
  daysBetween,
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
 * set against the oldest orders first), the automatic tags and the SCOT rhythm. One pass over orders and payments.
 */
export async function customerBook(db: Db | Tx, companyId: string, opts: { ids?: string[] } = {}) {
  const config = await crmConfigOf(db, companyId);
  const f = await fyCalendar(db, companyId);
  const today = f.today;
  const since = addDays(today, -365);
  const [customers, orders, payments, ownerSeat] = await Promise.all([
    db.customer.findMany({
      where: { companyId, deletedAt: null, ...(opts.ids ? { id: { in: opts.ids } } : {}) },
      include: { tags: { select: { tag: true } } },
      orderBy: { name: 'asc' },
    }),
    db.salesOrder.findMany({
      where: {
        companyId,
        status: { not: 'CANCELLED' },
        ...(opts.ids ? { customerId: { in: opts.ids } } : {}),
      },
      select: { customerId: true, orderDate: true, dueOn: true, amount: true, gp: true, items: true },
      orderBy: { orderDate: 'asc' },
    }),
    db.payment.findMany({
      where: { companyId, ...(opts.ids ? { customerId: { in: opts.ids } } : {}) },
      select: { customerId: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    }),
    seatPeople(db, companyId, 'owner', config),
  ]);
  const byCustomer = <T extends { customerId: string }>(xs: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of xs) m.set(x.customerId, [...(m.get(x.customerId) ?? []), x]);
    return m;
  };
  const ord = byCustomer(orders);
  const pay = byCustomer(payments);
  const stats: CustomerStats[] = [];
  const partial = customers.map((c) => {
    const os = ord.get(c.id) ?? [];
    const ps = pay.get(c.id) ?? [];
    const recent = os.filter((o) => o.orderDate >= since);
    // Payments against the oldest orders first: what is left on each order is still owed.
    let paid = ps.reduce((a, p) => a + Number(p.amount), 0);
    const ageing = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
    let overdue = 0;
    let dueToday = 0;
    let delaySum = 0;
    let delayN = 0;
    let payIdx = 0;
    let payLeft = ps[0] ? Number(ps[0].amount) : 0;
    for (const o of os) {
      const amt = Number(o.amount);
      const settle = Math.min(amt, paid);
      paid -= settle;
      // When the order was finally paid off (for "pays late").
      let need = settle;
      let paidOn: string | null = null;
      while (need > 0 && payIdx < ps.length) {
        const take = Math.min(need, payLeft);
        need -= take;
        payLeft -= take;
        paidOn = ps[payIdx]!.date;
        if (payLeft <= 0) {
          payIdx++;
          payLeft = ps[payIdx] ? Number(ps[payIdx]!.amount) : 0;
        }
      }
      if (settle === amt && paidOn) {
        delaySum += Math.max(0, daysBetween(o.dueOn, paidOn));
        delayN++;
      }
      const owed = amt - settle;
      if (owed <= 0) continue;
      ageing[ageBucket(o.dueOn, today)] += owed;
      if (o.dueOn < today) overdue += owed;
      if (o.dueOn === today) dueToday += owed;
    }
    const s: CustomerStats = {
      id: c.id,
      sales12: recent.reduce((a, o) => a + Number(o.amount), 0),
      gp12: recent.reduce((a, o) => a + Number(o.gp), 0),
      orders: os.length,
      firstOrder: os[0]?.orderDate ?? null,
      lastOrder: os[os.length - 1]?.orderDate ?? null,
      createdOn: c.createdAt.toISOString().slice(0, 10),
      payDelayDays: delayN ? delaySum / delayN : null,
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
