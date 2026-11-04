import type { Db, Tx } from '@mono/db';
import type { WorkCalendar } from '@mono/shared';
import { companyCalendar } from '../hr/calendar';

/** The company's working time: its default shift, holidays and weekly offs (the shared HR calendar). */
export async function workCalendar(db: Db | Tx, companyId: string): Promise<WorkCalendar> {
  const cal = await companyCalendar(db, companyId);
  return { tz: cal.tz, shift: { ...cal.shift, weekdays: [...cal.workingWeekdays] }, holidays: cal.holidays };
}
