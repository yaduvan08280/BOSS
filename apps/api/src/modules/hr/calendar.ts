import type { Db, Tx } from '@mono/db';

export type CompanyCalendar = {
  tz: string;
  /** Full-day holidays (YYYY-MM-DD) */
  holidays: Set<string>;
  halfHolidays: Set<string>;
  /** Weekdays 1–7 that are worked (half days included) */
  workingWeekdays: Set<number>;
  halfWeekdays: Set<number>;
  shift: { start: number; end: number };
};

/**
 * One calendar for the whole app (CLAUDE.md §9.2): holidays and weekly offs drive FMS due times,
 * checklist runs, leave days and attendance alike. Weekly offs set for a branch win over the company's;
 * with none set, the default shift's working days are used.
 */
export async function companyCalendar(
  db: Db | Tx,
  companyId: string,
  branchId: string | null = null,
): Promise<CompanyCalendar> {
  const [company, shift, holidays, offs] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }),
    db.shift.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    db.holiday.findMany({
      where: { companyId, deletedAt: null, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
      select: { date: true, halfDay: true },
    }),
    db.weeklyOff.findMany({
      where: { companyId, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] },
    }),
  ]);
  const own = offs.filter((o) => o.branchId === branchId);
  const rows = own.length ? own : offs.filter((o) => o.branchId === null);
  const shiftDays = shift?.weekdays.length ? shift.weekdays : [1, 2, 3, 4, 5, 6];
  return {
    tz: company.timezone,
    holidays: new Set(holidays.filter((h) => !h.halfDay).map((h) => h.date)),
    halfHolidays: new Set(holidays.filter((h) => h.halfDay).map((h) => h.date)),
    workingWeekdays: new Set(
      rows.length ? rows.filter((r) => r.kind !== 'OFF').map((r) => r.weekday) : shiftDays,
    ),
    halfWeekdays: new Set(rows.filter((r) => r.kind === 'HALF').map((r) => r.weekday)),
    shift: shift ? { start: shift.startMin, end: shift.endMin } : { start: 9 * 60, end: 18 * 60 },
  };
}
