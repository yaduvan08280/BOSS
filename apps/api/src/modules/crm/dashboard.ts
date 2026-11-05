import type { Db } from '@mono/db';
import { addDays, CRR_SEATS, daysBetween, NBD_SEATS, type Seat } from '@mono/shared';
import type { Actor } from '../work/actor';
import { crmRole, money, need, seatPeople } from './access';
import { customerBook } from './book';
import { monthTargets } from './targets';

/**
 * Sales dashboard (§11.2): this month's target, what is achieved so far and the pace, the gap and days left; the
 * KPI tiles with a 30-day sparkline and the change on last month; revenue against target by month; how much of
 * the year is done. "Viewing as" a seat or a person narrows the numbers to their orders and target.
 */
export async function dashboard(db: Db, actor: Actor, view: { seat?: Seat; userId?: string } = {}) {
  need(actor, 'crm.view', "You can't see the sales dashboard");
  const role = await crmRole(db, actor);
  const { rows, today, config, f } = await customerBook(db, actor.companyId);
  const t = await monthTargets(db, actor.companyId, today);
  // Whose numbers: everyone, a seat's people, one person (people without "all" see their own).
  const people = !role.all
    ? [actor.userId]
    : view.userId
      ? [view.userId]
      : view.seat
        ? await seatPeople(db, actor.companyId, view.seat, config)
        : null;
  const target = people ? people.reduce((a, id) => a + (t.perPerson.get(id) ?? 0), 0) : t.total;
  const first = `${today.slice(0, 7)}-01`;
  const prevFirst = `${addDays(first, -1).slice(0, 7)}-01`;
  const orders = await db.salesOrder.findMany({
    where: {
      companyId: actor.companyId,
      status: { not: 'CANCELLED' },
      orderDate: { gte: f.fyStart < addDays(today, -60) ? f.fyStart : addDays(today, -60) },
      ...(people ? { takenById: { in: people } } : {}),
    },
    select: { orderDate: true, amount: true, gp: true },
  });
  const sumIn = (from: string, to: string, k: 'amount' | 'gp' = 'amount') =>
    orders.filter((o) => o.orderDate >= from && o.orderDate <= to).reduce((a, o) => a + Number(o[k]), 0);
  const mtd = sumIn(first, today);
  const gpMtd = sumIn(first, today, 'gp');
  const dayOfMonth = daysBetween(first, today);
  const lastMonthSame = sumIn(prevFirst, addDays(prevFirst, dayOfMonth));
  const working = t.weeks.flatMap((w) => w.daily).filter((d) => d.working);
  const passed = working.filter((d) => d.date <= today).length;
  const dueByNow = working.length ? Math.round((target * passed) / working.length) : 0;
  const spark = (k: 'amount' | 'gp') =>
    Array.from({ length: 30 }, (_, i) => sumIn(addDays(today, i - 29), addDays(today, i - 29), k));
  const calls = await db.call.groupBy({
    by: ['status'],
    where: {
      companyId: actor.companyId,
      ...(people ? { scId: { in: people } } : {}),
      OR: [
        { status: 'OPEN', dueOn: { lte: today } },
        { status: 'DONE', dueOn: { gte: first } },
      ],
    },
    _count: true,
  });
  const leads = await db.lead.findMany({
    where: {
      companyId: actor.companyId,
      status: { in: ['ENQUIRY', 'OPEN'] },
      ...(people ? { ownerId: { in: people } } : {}),
    },
    select: { createdAt: true, value: true },
  });
  const byMonth = t.view.months.map((m, i) => {
    const [from, to] = [`${m.month}-01`, `${m.month}-31`];
    const all = orders.filter((o) => o.orderDate >= from && o.orderDate <= to);
    const share = people ? (t.total ? target / t.total : 0) : 1;
    return {
      month: m.month,
      target: Math.round(m.turnover * share),
      achieved: all.reduce((a, o) => a + Number(o.amount), 0),
      gp: all.reduce((a, o) => a + Number(o.gp), 0),
      past: m.month < today.slice(0, 7),
      index: i,
    };
  });
  const yearDays = daysBetween(f.fyStart, addDays(`${f.fy + 1}${f.fyStart.slice(4)}`, -1)) + 1;
  const ytd = sumIn(f.fyStart, today);
  return {
    today,
    fy: f.fy,
    planStatus: t.status,
    planned: t.planned,
    viewing: { seat: view.seat ?? null, userId: view.userId ?? null, own: !role.all },
    month: {
      target: money(target),
      achieved: money(mtd),
      pacePct: dueByNow ? Math.round((mtd / dueByNow) * 100) : null,
      gap: money(Math.max(0, target - mtd)),
      daysLeft: t.workingLeft,
    },
    tiles: {
      revenue: {
        value: money(mtd),
        spark: spark('amount').map(money),
        deltaPct: lastMonthSame ? Math.round(((mtd - lastMonthSame) / lastMonthSame) * 100) : null,
      },
      gp: {
        value: money(gpMtd),
        marginPct: mtd ? Math.round((gpMtd / mtd) * 1000) / 10 : null,
        spark: spark('gp').map(money),
      },
      orders: orders.filter((o) => o.orderDate >= first).length,
      collectionDue: money(rows.reduce((a, r) => a + r.overdue, 0)),
      calls: {
        done: calls.find((c) => c.status === 'DONE')?._count ?? 0,
        overdue: calls.find((c) => c.status === 'OPEN')?._count ?? 0,
      },
      leads: {
        open: leads.length,
        thisWeek: leads.filter((l) => l.createdAt.getTime() >= Date.now() - 7 * 86_400_000).length,
        value: money(leads.reduce((a, l) => a + Number(l.value), 0)),
      },
    },
    byMonth: byMonth.map((m) => ({
      ...m,
      target: money(m.target),
      achieved: money(m.achieved),
      gp: money(m.gp),
    })),
    year: {
      donePct: Math.round((Math.min(yearDays, daysBetween(f.fyStart, today) + 1) / yearDays) * 100),
      achievedPct: t.view.year.turnover
        ? Math.round(
            (ytd /
              (people ? (t.total ? (target / t.total) * t.view.year.turnover : 0) : t.view.year.turnover)) *
              100,
          )
        : null,
      achieved: money(ytd),
      target: money(t.view.year.turnover),
    },
    seats: { crr: CRR_SEATS, nbd: NBD_SEATS },
  };
}
