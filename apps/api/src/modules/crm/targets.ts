import type { Db } from '@mono/db';
import { buildPlan, DEFAULT_PLAN, planInputSchema, seatTargets } from '@mono/shared';
import { crmConfigOf, fyCalendar } from './access';

/**
 * This month's targets from the year plan (§11.2): the company's, CRR and NBD sides, each person's, the plan's
 * weeks for the month, and CRR per working day (for Today's Calls). Zero when there is no plan.
 */
export async function monthTargets(db: Db, companyId: string, today: string) {
  const f = await fyCalendar(db, companyId);
  const row = await db.crmPlan.findUnique({ where: { companyId_fy: { companyId, fy: f.fy } } });
  const parsed = planInputSchema.safeParse(row?.data ?? {});
  const input = parsed.success ? parsed.data : DEFAULT_PLAN;
  const view = buildPlan(input, f.cal);
  const config = await crmConfigOf(db, companyId);
  const seats = seatTargets(
    view.months.map((m) => m.turnover),
    config,
    input.roundUnit,
  );
  const m = Math.max(
    0,
    view.months.findIndex((x) => x.month === today.slice(0, 7)),
  );
  const month = view.months[m]!;
  const crrSeats = seats.rows.filter((r) => r.seat !== 'nbdSc' && r.seat !== 'salesRep');
  const crr = crrSeats.reduce((a, r) => a + r.months[m]!, 0);
  const nbd = month.turnover - crr;
  const working = month.weeks.flatMap((w) => w.daily).filter((d) => d.working);
  return {
    planned: Boolean(row),
    status: row?.status ?? 'DRAFT',
    monthIndex: m,
    month: month.month,
    total: month.turnover,
    gp: month.gp,
    crr,
    nbd,
    crrPerDay: working.length ? Math.round(crr / working.length) : 0,
    workingDays: working.length,
    workingLeft: working.filter((d) => d.date >= today).length,
    perPerson: new Map(seats.rows.filter((r) => r.userId).map((r) => [r.userId!, r.months[m]!])),
    weeks: month.weeks,
    view,
  };
}
