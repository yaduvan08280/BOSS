import { addDays, daysBetween, daysInMonth } from '../work/calendar';

/** CLAUDE.md §11.2 — SCOT (Sales Coordinator Order Taking): each regular customer's rhythm from their orders. */
export type OrderLite = { date: string; amount: number; gp?: number; items?: string[] };
export type Rhythm = 'weekly' | 'fortnightly' | 'monthly' | 'everyN';
export type ScotRow = {
  onScot: boolean;
  orders: number;
  averageOrder: number;
  everyDays: number | null;
  usualDay: number | null;
  rhythm: Rhythm | null;
  lastOrder: string | null;
  nextDue: string | null;
  callOn: string | null;
  callsPerMonth: number | null;
  topItems: string[];
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const dayOf = (d: string) => Number(d.slice(8, 10));
/** The date in `month` (YYYY-MM) on `day`, or the month's last day. */
const onDay = (month: string, day: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(Math.min(day, daysInMonth(y, m))).padStart(2, '0')}`;
};
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * The rhythm from the last 12 months of orders (2 or more on different days): average order, the usual gap
 * (median), a usual date of the month when most orders fall within 2 days of one, the next order due, and the
 * day to call (N days before, moved back off holidays and weekly offs when `isWorking` is given).
 */
export function scotOf(
  orders: OrderLite[],
  today: string,
  opts: { callBeforeDays: number; isWorking?: (d: string) => boolean },
): ScotRow {
  const since = addDays(today, -365);
  const recent = orders
    .filter((o) => o.date >= since && o.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(recent.map((o) => o.date))];
  const average = recent.length ? Math.round(recent.reduce((a, o) => a + o.amount, 0) / recent.length) : 0;
  const counts = new Map<string, number>();
  for (const o of recent) for (const it of o.items ?? []) counts.set(it, (counts.get(it) ?? 0) + 1);
  const topItems = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([k]) => k);
  const base: ScotRow = {
    onScot: false,
    orders: recent.length,
    averageOrder: average,
    everyDays: null,
    usualDay: null,
    rhythm: null,
    lastOrder: dates[dates.length - 1] ?? null,
    nextDue: null,
    callOn: null,
    callsPerMonth: null,
    topItems,
  };
  if (dates.length < 2) return base;
  const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i]!, d));
  const every = Math.max(1, Math.round(median(gaps)));
  // A usual date: with a monthly-or-slower rhythm and 3+ orders, most fall within 2 days of one day of the month.
  let usual: number | null = null;
  if (every >= 20 && dates.length >= 3) {
    // Most orders within 2 days of it; among equals, the day closest to all of them.
    let best = 0;
    let bestDist = Infinity;
    for (let d = 1; d <= 31; d++) {
      const near = dates.filter((x) => Math.abs(dayOf(x) - d) <= 2).length;
      const dist = dates.reduce((a, x) => a + Math.abs(dayOf(x) - d), 0);
      if (near > best || (near === best && dist < bestDist)) {
        best = near;
        bestDist = dist;
        usual = d;
      }
    }
    if (best * 2 < dates.length) usual = null;
  }
  const last = dates[dates.length - 1]!;
  let due = addDays(last, every);
  if (usual) {
    // The usual date in the month the gap lands in, or the next month's if that one is too soon.
    let m = due.slice(0, 7);
    let d = onDay(m, usual);
    if (daysBetween(last, d) < every / 2) {
      m = nextMonth(m);
      d = onDay(m, usual);
    }
    due = d;
  }
  let call = addDays(due, -opts.callBeforeDays);
  if (opts.isWorking) for (let k = 0; k < 14 && !opts.isWorking(call); k++) call = addDays(call, -1);
  if (call <= last) call = addDays(last, 1);
  return {
    ...base,
    onScot: true,
    everyDays: every,
    usualDay: usual,
    rhythm: every <= 10 ? 'weekly' : every <= 20 ? 'fortnightly' : every <= 40 ? 'monthly' : 'everyN',
    nextDue: due,
    callOn: call,
    callsPerMonth: Math.round((30 / every) * 10) / 10,
  };
}

export const AUTO_TAGS = [
  'top20',
  'middle',
  'bottom20',
  'new',
  'sleeping',
  'lost',
  'vampire',
  'owners',
] as const;
export type AutoTag = (typeof AUTO_TAGS)[number];

export type CustomerStats = {
  id: string;
  sales12: number;
  gp12: number;
  orders: number;
  firstOrder: string | null;
  lastOrder: string | null;
  createdOn: string;
  /** Average days paid after the due date (null = nothing paid yet). */
  payDelayDays: number | null;
  creditDays: number;
  lostAt: string | null;
  owners: boolean;
};

/**
 * Automatic tags (§11.2 Fields & tags): top / bottom 20% by GP in 12 months (with the rest "middle"), new,
 * sleeping / lost by days since the last order (or marked lost), vampire (top-40% sales, pays late, GP margin
 * below the middle) and the owner's own customers.
 */
export function autoTags(
  all: CustomerStats[],
  today: string,
  rules: {
    newOrders: number;
    newDays: number;
    newRule: 'first' | 'both';
    sleepingDays: number;
    lostDays: number;
    vampire: boolean;
  },
): Map<string, AutoTag[]> {
  const out = new Map<string, AutoTag[]>(all.map((c) => [c.id, []]));
  const selling = all.filter((c) => c.sales12 > 0);
  const byGp = [...selling].sort((a, b) => b.gp12 - a.gp12 || b.sales12 - a.sales12);
  const n = Math.ceil(byGp.length * 0.2);
  const top = new Set(byGp.slice(0, n).map((c) => c.id));
  const bottom = new Set(
    byGp.length > 1
      ? byGp
          .slice(-n)
          .filter((c) => !top.has(c.id))
          .map((c) => c.id)
      : [],
  );
  const bySales = [...selling].sort((a, b) => b.sales12 - a.sales12);
  const top40 = new Set(bySales.slice(0, Math.ceil(bySales.length * 0.4)).map((c) => c.id));
  const margins = selling.map((c) => c.gp12 / c.sales12).sort((a, b) => a - b);
  const midMargin = margins.length ? margins[Math.floor(margins.length / 2)]! : 0;
  for (const c of all) {
    const t = out.get(c.id)!;
    if (top.has(c.id)) t.push('top20');
    else if (bottom.has(c.id)) t.push('bottom20');
    else if (c.sales12 > 0) t.push('middle');
    const age = daysBetween(c.firstOrder ?? c.createdOn, today);
    const fewOrders = c.orders < rules.newOrders;
    const young = age < rules.newDays;
    if (rules.newRule === 'first' ? fewOrders && young : fewOrders || young) t.push('new');
    const quiet = c.lastOrder ? daysBetween(c.lastOrder, today) : null;
    if (c.lostAt || (quiet !== null && quiet > rules.lostDays)) t.push('lost');
    else if (quiet !== null && quiet > rules.sleepingDays) t.push('sleeping');
    if (rules.vampire && top40.has(c.id) && (c.payDelayDays ?? 0) > 0 && c.gp12 / c.sales12 < midMargin)
      t.push('vampire');
    if (c.owners) t.push('owners');
  }
  return out;
}

/** Receivable ageing buckets by days past the due date (not yet due counts as "0–30"). */
export function ageBucket(dueOn: string, today: string): '0_30' | '31_60' | '61_90' | '90_plus' {
  const late = daysBetween(dueOn, today);
  return late <= 30 ? '0_30' : late <= 60 ? '31_60' : late <= 90 ? '61_90' : '90_plus';
}
