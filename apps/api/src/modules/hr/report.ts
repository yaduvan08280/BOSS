import type { Db } from '@mono/db';
import { addDays, formatLocalDate, hhmmToMinutes, localDate, zonedToUtc } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { coverState } from './absence';
import { period } from './balance';
import { hrPerson, hrRulesOf } from './people';
import { openWork } from './work';

/** 08:30 (§9.1 step 6): who is away today and which of their work has no Buddy — to their HOD, HR and the owner. */
export async function morningCoverReport(db: Db, now = new Date(), onlyCompanyId?: string) {
  let sent = 0;
  for (const c of await db.company.findMany({
    where: { deletedAt: null, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
    select: { id: true, timezone: true },
  })) {
    const rules = await hrRulesOf(db, c.id);
    if (!rules.autopilot.morningReport) continue;
    const today = localDate(now, c.timezone);
    const minutes = Math.round((now.getTime() - zonedToUtc(today, 0, c.timezone).getTime()) / 60_000);
    if (minutes < hhmmToMinutes(rules.autopilot.morningReportAt)) continue;
    const leaves = await db.leaveRequest.findMany({
      where: { companyId: c.id, status: 'APPROVED', from: { lte: today }, to: { gte: today } },
    });
    if (!leaves.length || !(await claimMark(db, c.id, `hr.morning:${today}`))) continue;
    const lines: { hod: string | null; branchId: string | null; text: string }[] = [];
    for (const l of leaves) {
      const p = await hrPerson(db, c.id, l.userId);
      const win = period(l.from, l.to, l.half, p, c.timezone);
      const items = await openWork(
        db,
        p,
        zonedToUtc(today, 0, c.timezone),
        zonedToUtc(addDays(today, 1), 0, c.timezone),
      );
      const open = (await coverState(db, p, items, win.fromAt, win.toAt)).filter(
        (s) => s.state !== 'covered',
      ).length;
      lines.push({
        hod: p.hodId,
        branchId: p.branchId,
        text: `• ${p.name} (till ${formatLocalDate(l.to)}): ${items.length} piece(s) of work${open ? `, ${open} with no Buddy` : ', all covered'}`,
      });
    }
    const owners = await db.user.findMany({
      where: { companyId: c.id, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' } },
      select: { id: true },
    });
    const everyone = new Set([
      ...owners.map((o) => o.id),
      ...(rules.leave.hrUserId ? [rules.leave.hrUserId] : []),
    ]);
    const to = new Map<string, string[]>();
    for (const id of everyone)
      to.set(
        id,
        lines.map((l) => l.text),
      );
    const give = (userId: string, text: string) => {
      if (everyone.has(userId) || to.get(userId)?.includes(text)) return;
      to.set(userId, [...(to.get(userId) ?? []), text]);
    };
    // Each branch's managers and HR person get their own branch's lines (phase 12).
    const runs = await db.branchManager.findMany({
      where: { companyId: c.id, role: { in: ['MANAGER', 'HR'] }, branchId: { not: null } },
      select: { userId: true, branchId: true },
    });
    for (const l of lines) {
      if (l.hod) give(l.hod, l.text);
      for (const r of runs) if (r.branchId === l.branchId) give(r.userId, l.text);
    }
    for (const [userId, list] of to) {
      await db.$transaction((tx) =>
        emitEvent(
          tx,
          { companyId: c.id, actorId: null },
          {
            name: 'hr.morning_cover_report',
            entityType: 'user',
            entityId: userId,
            payload: { userId, date: formatLocalDate(today), report: list.join('\n'), link: '/hr/cover' },
          },
        ),
      );
      sent++;
    }
  }
  return sent;
}
