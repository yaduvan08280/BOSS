import type { Db } from '@mono/db';
import { CRR_SEATS, NBD_SEATS, zonedToUtc, type Seat } from '@mono/shared';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import { crmRole, money, need, seatPeople } from './access';
import { monthTargets } from './targets';

type Grade = 'green' | 'yellow' | 'red' | 'none';
/** Green at the target, yellow from 80% of it, red below. */
const grade = (done: number, planned: number): Grade =>
  planned <= 0 ? 'none' : done >= planned ? 'green' : done >= planned * 0.8 ? 'yellow' : 'red';

export const mecaQuery = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

/**
 * MeCA / MCAP (§11.2): a weekly scorecard per sales seat for a month (W1–W5 = the plan's weeks) — new leads,
 * conversion, average sale, calls made against planned, orders against the week's target, each graded R/Y/G.
 */
export async function meca(db: Db, actor: Actor, q: z.infer<typeof mecaQuery>) {
  need(actor, 'crm.view', "You can't see the scorecard");
  const role = await crmRole(db, actor);
  const tz = (
    await db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } })
  ).timezone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const month = q.month ?? today.slice(0, 7);
  const t = await monthTargets(db, actor.companyId, `${month}-15`);
  const seats: Seat[] = [...CRR_SEATS, ...NBD_SEATS];
  const holders = await Promise.all(
    seats.map(async (s) => ({ seat: s, ids: await seatPeople(db, actor.companyId, s, role.config) })),
  );
  const people = holders
    .flatMap((h) => h.ids.map((id) => ({ seat: h.seat, id })))
    .filter((p) => role.all || p.id === actor.userId);
  const ids = [...new Set(people.map((p) => p.id))];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const weeks = t.weeks;
  const from = weeks[0]?.start ?? `${month}-01`;
  const to = weeks[weeks.length - 1]?.end ?? `${month}-28`;
  const [orders, calls, leads] = await Promise.all([
    db.salesOrder.findMany({
      where: {
        companyId: actor.companyId,
        status: { not: 'CANCELLED' },
        takenById: { in: ids },
        orderDate: { gte: from, lte: to },
      },
      select: { takenById: true, orderDate: true, amount: true },
    }),
    db.call.findMany({
      where: { companyId: actor.companyId, scId: { in: ids }, dueOn: { gte: from, lte: to } },
      select: { scId: true, dueOn: true, status: true, resultAt: true },
    }),
    db.lead.findMany({
      where: {
        companyId: actor.companyId,
        ownerId: { in: ids },
        OR: [
          { createdAt: { gte: zonedToUtc(from, 0, tz), lt: zonedToUtc(to, 24 * 60, tz) } },
          { closedAt: { gte: zonedToUtc(from, 0, tz), lt: zonedToUtc(to, 24 * 60, tz) } },
        ],
      },
      select: { ownerId: true, createdAt: true, closedAt: true, status: true },
    }),
  ]);
  const local = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const rows = people.map((p) => {
    const personTarget = t.perPerson.get(p.id) ?? 0;
    const cells = weeks.map((w, i) => {
      const inWeek = (d: string) => d >= w.start && d <= w.end;
      const os = orders.filter((o) => o.takenById === p.id && inWeek(o.orderDate));
      const cs = calls.filter((c) => c.scId === p.id && inWeek(c.dueOn));
      const ls = leads.filter((l) => l.ownerId === p.id && inWeek(local(l.createdAt)));
      const closed = leads.filter((l) => l.ownerId === p.id && l.closedAt && inWeek(local(l.closedAt)));
      const won = closed.filter((l) => l.status === 'WON').length;
      const sales = os.reduce((a, o) => a + Number(o.amount), 0);
      const weekTarget = t.total ? Math.round((personTarget * w.turnover) / t.total) : 0;
      const callsDone = cs.filter((c) => c.status === 'DONE').length;
      return {
        week: `W${i + 1}`,
        start: w.start,
        end: w.end,
        leads: ls.length,
        conversionPct: closed.length ? Math.round((won / closed.length) * 100) : null,
        averageSale: money(os.length ? Math.round(sales / os.length) : 0),
        calls: { done: callsDone, planned: cs.length, grade: grade(callsDone, cs.length) },
        orders: { value: money(sales), target: money(weekTarget), grade: grade(sales, weekTarget) },
        future: w.start > today,
      };
    });
    return {
      seat: p.seat,
      userId: p.id,
      name: names.get(p.id) ?? '?',
      monthTarget: money(personTarget),
      weeks: cells,
    };
  });
  return { month, weeks: weeks.map((w, i) => ({ week: `W${i + 1}`, start: w.start, end: w.end })), rows };
}
