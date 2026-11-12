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
  // Where the branch is: its entity, state and country decide which holidays are its own (phase 12).
  const branch = branchId
    ? await db.branch.findFirst({
        where: { id: branchId, companyId },
        select: { entityId: true, state: true, timezone: true },
      })
    : null;
  const entity = branch?.entityId
    ? await db.legalEntity.findFirst({
        where: { id: branch.entityId, companyId },
        select: { id: true, state: true, country: true },
      })
    : null;
  const state = branch?.state ?? entity?.state ?? null;
  const [company, shift, holidays, offs] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } }),
    db.shift.findFirst({
      where: { companyId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    db.holiday.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [
          // Everyone's holidays …
          { branchId: null, entityId: null, state: null, country: null },
          // … and this branch's own, its entity's, its state's and its country's.
          ...(branchId ? [{ branchId }] : []),
          ...(entity ? [{ entityId: entity.id }, { country: entity.country, state: null }] : []),
          ...(state ? [{ state: { equals: state, mode: 'insensitive' as const } }] : []),
        ],
      },
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
    // The branch's own clock when it has one (phase 12): shifts, due times and days are counted on it.
    tz: branch?.timezone ?? company.timezone,
    holidays: new Set(holidays.filter((h) => !h.halfDay).map((h) => h.date)),
    halfHolidays: new Set(holidays.filter((h) => h.halfDay).map((h) => h.date)),
    workingWeekdays: new Set(
      rows.length ? rows.filter((r) => r.kind !== 'OFF').map((r) => r.weekday) : shiftDays,
    ),
    halfWeekdays: new Set(rows.filter((r) => r.kind === 'HALF').map((r) => r.weekday)),
    shift: shift ? { start: shift.startMin, end: shift.endMin } : { start: 9 * 60, end: 18 * 60 },
  };
}
