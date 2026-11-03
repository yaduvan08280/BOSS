import type { Db } from '@mono/db';
import { addDays, formatLocalDate, hhmmToMinutes, localDate, weekdayOf, zonedToUtc } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { moduleSettings } from '../work/settings';
import { buildBrief, buildWeekPlan } from './brief';
import { boardOwners } from './service';

/** Claims a once-only send; false when another run already did it. */
export async function claimMark(db: Db, companyId: string, key: string): Promise<boolean> {
  const res = await db.$executeRaw`
    INSERT INTO job_marks (id, company_id, key) VALUES (${crypto.randomUUID()}, ${companyId}, ${key})
    ON CONFLICT (company_id, key) DO NOTHING`;
  return res === 1;
}

async function moveStage(db: Db, where: object, stage: string, extra: object = {}) {
  const now = new Date();
  return (await db.eaItem.updateMany({ where, data: { stage, stageChangedAt: now, ...extra } })).count;
}

/**
 * Every 5 minutes, per company (in its time zone):
 * - a scheduled day that passed goes back to Someday (if switched on);
 * - information older than "kept N days" closes; delegated items close as done when their task is done;
 * - the daily brief at its time, and the weekly plan on the plan day, once each.
 */
export async function eaJobs(db: Db, now = new Date(), onlyCompanyId?: string) {
  const companies = await db.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : {},
    select: { id: true, timezone: true },
  });
  let sent = 0;
  for (const c of companies) {
    const s = await moduleSettings(db, c.id, 'ea');
    const today = localDate(now, c.timezone);
    const base = { companyId: c.id, deletedAt: null };
    if (s.missedDayToSomeday)
      await moveStage(db, { ...base, stage: 'SCHEDULED', scheduledDate: { lt: today } }, 'SOMEDAY', {
        scheduledDate: null,
        slotStart: null,
        slotMinutes: null,
      });
    await moveStage(
      db,
      {
        ...base,
        stage: 'INFORMATION',
        stageChangedAt: { lt: new Date(now.getTime() - s.infoKeepDays * 86_400_000) },
      },
      'CLOSED',
    );
    const delegated = await db.eaItem.findMany({
      where: { ...base, stage: 'DELEGATED', taskId: { not: null } },
    });
    const doneTasks = new Set(
      (
        await db.task.findMany({
          where: { id: { in: delegated.map((d) => d.taskId!) }, status: 'DONE' },
          select: { id: true },
        })
      ).map((t) => t.id),
    );
    const finished = delegated.filter((d) => doneTasks.has(d.taskId!)).map((d) => d.id);
    if (finished.length) await moveStage(db, { id: { in: finished } }, 'DONE', { doneAt: now });

    const minutes = Math.round((now.getTime() - zonedToUtc(today, 0, c.timezone).getTime()) / 60_000);
    if (minutes < hhmmToMinutes(s.dailyBriefAt)) continue;
    for (const owner of await boardOwners(db, c.id)) {
      const items = await db.eaItem.findMany({
        where: { ...base, ownerId: owner.id, stage: { notIn: ['DONE', 'CLOSED'] } },
      });
      if (!items.length) continue;
      const tasks = await db.task.findMany({
        where: { id: { in: items.map((i) => i.taskId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, status: true },
      });
      const status = new Map(tasks.map((t) => [t.id, t.status]));
      const withTasks = items.map((i) => ({
        ...i,
        taskStatus: i.taskId ? (status.get(i.taskId) ?? null) : null,
      }));
      const emit = (name: string, payload: Record<string, unknown>) =>
        db.$transaction((tx) =>
          emitEvent(
            tx,
            { companyId: c.id, actorId: null },
            { name, entityType: 'ea_board', entityId: owner.id, payload },
          ),
        );
      if (await claimMark(db, c.id, `ea.brief:${today}:${owner.id}`)) {
        const date = formatLocalDate(today);
        await emit('ea.daily_brief', {
          userId: owner.id,
          date,
          brief: buildBrief(today, withTasks, s, now),
          link: '/ea',
        });
        sent++;
      }
      if (
        weekdayOf(today) === s.weeklyPlanDay &&
        (await claimMark(db, c.id, `ea.week:${today}:${owner.id}`))
      ) {
        const next = addDays(today, 8 - weekdayOf(today));
        await emit('ea.weekly_plan', {
          userId: owner.id,
          plan: buildWeekPlan(next, items),
          link: '/ea?tab=week',
        });
        sent++;
      }
    }
  }
  return sent;
}
