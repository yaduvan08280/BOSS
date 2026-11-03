import type { Db, Tx } from '@mono/db';
import type { WorkCalendar } from '@mono/shared';

/** The company's working time: its default shift and holidays (weekly offs = days off that shift). */
export async function workCalendar(db: Db | Tx, companyId: string): Promise<WorkCalendar> {
  const [company, shift, holidays] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }),
    db.shift.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    db.holiday.findMany({ where: { companyId, deletedAt: null, halfDay: false }, select: { date: true } }),
  ]);
  return {
    tz: company.timezone,
    shift: shift
      ? { start: shift.startMin, end: shift.endMin, weekdays: shift.weekdays }
      : { start: 9 * 60, end: 18 * 60, weekdays: [1, 2, 3, 4, 5, 6] },
    holidays: new Set(holidays.map((h) => h.date)),
  };
}
