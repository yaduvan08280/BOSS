import { Prisma, type Db } from '@mono/db';
import {
  localDate,
  reportDefinitionSchema,
  reportScheduleSchema,
  weekdayOf,
  zonedToUtc,
  type ReportSchedule,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { actorFor } from '../work/actor';
import { runReport, type ReportResult } from './engine';

const inr = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Is this schedule due on this company-local day, at or after its time? */
export function dueOn(s: ReportSchedule, today: string, minutes: number): boolean {
  if (minutes < s.at) return false;
  if (s.every === 'week') return weekdayOf(today) === (s.on ?? 1);
  if (s.every === 'month') return Number(today.slice(8)) === (s.on ?? 1);
  return true;
}

/** A report in two lines for a message: how many records, the totals, and the first few groups. */
export function reportSummary(res: ReportResult): string {
  const totals = res.totals
    ? res.measures.map((m, i) => `${m}: ${res.totals![i] === null ? '—' : inr(res.totals![i]!)}`).join(' · ')
    : `${res.total} record(s)`;
  if (!res.grouped) return totals;
  const top = res.rows
    .slice(0, 5)
    .map(
      (r) =>
        `${r[0] ?? '—'}: ${r
          .slice(1)
          .map((v) => (typeof v === 'number' ? inr(v) : (v ?? '—')))
          .join(' / ')}`,
    )
    .join('; ');
  return top ? `${totals}. ${top}${res.rows.length > 5 ? ' …' : ''}` : totals;
}

/**
 * The worker's job (every minute): a saved report with a schedule is sent once per slot — every day, a weekday
 * each week, or a day each month, at its time in the company's time zone (`JobMark`). It is run as its maker, so
 * it says what they may see; each person chosen gets a message with the numbers and a link to the report,
 * through the company's own notification rule for "report.scheduled" (Telegram, email, in-app). A report that
 * can't run any more (its source is gone, its maker lost access) is told to its maker once, and not tried again
 * until the next slot.
 */
export async function sendScheduledReports(db: Db, now = new Date()): Promise<number> {
  const rows = await db.report.findMany({
    where: { deletedAt: null, schedule: { not: Prisma.DbNull } },
    select: { id: true, companyId: true, name: true, ownerId: true, definition: true, schedule: true },
  });
  let sent = 0;
  const zones = new Map<string, string | null>();
  for (const r of rows) {
    const parsed = reportScheduleSchema.safeParse(r.schedule);
    if (!parsed.success) continue;
    if (!zones.has(r.companyId)) {
      const c = await db.company.findUnique({
        where: { id: r.companyId },
        select: { timezone: true, deletedAt: true },
      });
      zones.set(r.companyId, c && !c.deletedAt ? c.timezone : null);
    }
    const tz = zones.get(r.companyId);
    if (!tz) continue;
    const today = localDate(now, tz);
    const minutes = Math.round((now.getTime() - zonedToUtc(today, 0, tz).getTime()) / 60_000);
    if (!dueOn(parsed.data, today, minutes)) continue;
    if (!(await claimMark(db, r.companyId, `report:${r.id}:${today}`))) continue;

    const link = `/reports/${r.id}`;
    const tell = (userId: string, summary: string) =>
      db.$transaction((tx) =>
        emitEvent(
          tx,
          { companyId: r.companyId, actorId: null },
          {
            name: 'report.scheduled',
            entityType: 'report',
            entityId: r.id,
            payload: { userId, report: r.name, summary, link },
          },
        ),
      );
    const owner = await actorFor(db, r.companyId, r.ownerId);
    let summary: string;
    try {
      if (!owner) throw new AppError(403, 'FORBIDDEN', 'the person who made it is no longer active');
      summary = reportSummary(await runReport(db, owner, reportDefinitionSchema.parse(r.definition), 50));
    } catch (e) {
      const why = e instanceof AppError ? e.message : 'it could not be worked out';
      await tell(r.ownerId, `This report could not be sent: ${why}. Open it and save it again.`);
      continue;
    }
    for (const userId of new Set(parsed.data.userIds)) {
      await tell(userId, summary);
      sent++;
    }
  }
  return sent;
}
