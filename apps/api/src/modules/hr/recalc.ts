import type { Db } from '@mono/db';
import { writeAudit } from '../../lib/audit';
import { AppError, forbidden } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { settleDay } from './attendance';
import { hrPerson, isHr } from './people';

/**
 * Work a month's settled days out again with the rules as they stand now (after HR changes a rule, or after
 * MONO's own rule is corrected). Only days that already have a record are touched; a month whose pay is closed
 * is refused — reopen the pay run first. HR only.
 */
export async function recalcMonth(db: Db, actor: Actor, month: string) {
  if (!(await isHr(db, actor))) throw forbidden('Only HR recalculates attendance');
  if (await db.payRun.count({ where: { companyId: actor.companyId, month } }))
    throw new AppError(409, 'CONFLICT', 'The pay for this month is closed. Reopen it in Payroll first.');
  const rows = await db.attendanceDay.findMany({
    where: { companyId: actor.companyId, date: { gte: `${month}-01`, lte: `${month}-31` } },
    select: { userId: true, date: true, status: true },
    orderBy: [{ userId: 'asc' }, { date: 'asc' }],
  });
  const people = new Map<string, Awaited<ReturnType<typeof hrPerson>>>();
  let changed = 0;
  for (const row of rows) {
    if (!people.has(row.userId)) {
      const exists = await db.user.count({
        where: { id: row.userId, companyId: actor.companyId, deletedAt: null },
      });
      if (!exists) continue;
      people.set(row.userId, await hrPerson(db, actor.companyId, row.userId));
    }
    const p = people.get(row.userId);
    if (!p) continue;
    const r = await settleDay(db, actor.companyId, p, row.date);
    if (r.saved && r.result.status !== row.status) changed += 1;
  }
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      action: 'attendance.recalculated',
      entityType: 'attendance',
      entityId: month,
      after: { days: rows.length, changed },
    },
  );
  return { days: rows.length, changed };
}
