import type { Db } from '@mono/db';
import { addDays, localDate, weekdayOf, zonedToUtc } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { teamOf } from '../work/actor';
import { misFor, type MisPerson } from './service';

/** A few plain lines for Telegram/email: average, best three, and who needs a hand. */
export function misSummary(rows: MisPerson[]): string {
  const scored = rows.filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!);
  if (!scored.length) return 'No work was due last week.';
  const avg = Math.round(scored.reduce((a, r) => a + r.score!, 0) / scored.length);
  const out = [`Average score ${avg}% across ${scored.length} people.`];
  out.push(
    `Top: ${scored
      .slice(0, 3)
      .map((r) => `${r.name} ${r.score}%`)
      .join(', ')}.`,
  );
  const low = scored.filter((r) => r.score! < 60).slice(-3);
  if (low.length) out.push(`Needs a hand: ${low.map((r) => `${r.name} ${r.score}%`).join(', ')}.`);
  const none = rows.length - scored.length;
  if (none) out.push(`${none} with nothing due.`);
  return out.join('\n');
}

/** Monday 09:00 (company time): last week's MIS to each owner (everyone) and each HOD (their team). Once a week. */
export async function sendWeeklyMis(db: Db, now = new Date(), onlyCompanyId?: string): Promise<number> {
  const companies = await db.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : {},
    select: { id: true, timezone: true },
  });
  let sent = 0;
  for (const c of companies) {
    const today = localDate(now, c.timezone);
    if (weekdayOf(today) !== 1 || now < zonedToUtc(today, 9 * 60, c.timezone)) continue;
    const lastMonday = addDays(today, -7);
    if (!(await claimMark(db, c.id, `mis:${lastMonday}`))) continue;
    const at = zonedToUtc(addDays(lastMonday, 3), 12 * 60, c.timezone);
    const people = await db.user.findMany({
      where: { companyId: c.id, deletedAt: null, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        mainDepartment: { select: { name: true } },
        role: { select: { key: true } },
      },
    });
    const hods = new Set(
      (
        await db.department.findMany({
          where: { companyId: c.id, deletedAt: null, hodUserId: { not: null } },
        })
      ).map((d) => d.hodUserId!),
    );
    const report = await misFor(db, c.id, people, at, now);
    const week = `${lastMonday.slice(8)}/${lastMonday.slice(5, 7)}–${addDays(lastMonday, 6).slice(8)}/${addDays(lastMonday, 6).slice(5, 7)}`;
    for (const p of people) {
      const isOwner = p.role.key === 'OWNER';
      if (!isOwner && !hods.has(p.id)) continue;
      const team = isOwner ? null : new Set([...(await teamOf(db, c.id, p.id)), p.id]);
      const rows = team ? report.rows.filter((r) => team.has(r.personId)) : report.rows;
      await db.$transaction((tx) =>
        emitEvent(
          tx,
          { companyId: c.id, actorId: null },
          {
            name: 'mis.weekly',
            entityType: 'mis',
            entityId: lastMonday,
            payload: { userId: p.id, week, summary: misSummary(rows), link: `/mis?at=${at.toISOString()}` },
          },
        ),
      );
      sent++;
    }
  }
  return sent;
}
