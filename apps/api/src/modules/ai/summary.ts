import type { Db } from '@mono/db';
import { addDays, formatLocalDate, localDate, zonedToUtc } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { runAi } from './llm';
import * as SUMMARY from './prompts/daily-summary.v1';
import { companyContext } from './prompts/context';

const SEND_AT_MINUTES = 8 * 60 + 45;
const days = (ms: number) => Math.max(1, Math.ceil(ms / 86_400_000));

/** Yesterday, what is late now, and what is due today — the numbers the summary is written from. */
export async function dailyFacts(db: Db, companyId: string, tz: string, now = new Date()): Promise<string> {
  const today = localDate(now, tz);
  const [y0, t0, t1] = [addDays(today, -1), today, addDays(today, 1)].map((d) => zonedToUtc(d, 0, tz)) as [
    Date,
    Date,
    Date,
  ];
  const base = { companyId, deletedAt: null };
  const [
    doneTasks,
    checklistDone,
    checklistMissed,
    stepsDone,
    lateTasks,
    lateSteps,
    escalated,
    dueTasks,
    dueRuns,
    dueSteps,
  ] = await Promise.all([
    db.task.findMany({
      where: { ...base, doneAt: { gte: y0, lt: t0 } },
      select: { doneAt: true, plannedAt: true },
    }),
    db.checklistRun.count({ where: { companyId, status: 'DONE', submittedAt: { gte: y0, lt: t0 } } }),
    db.checklistRun.count({ where: { companyId, status: 'MISSED', windowEndsAt: { gte: y0, lt: t0 } } }),
    db.fmsRecordStep.findMany({
      where: { companyId, doneAt: { gte: y0, lt: t0 } },
      select: { doneAt: true, plannedAt: true },
    }),
    db.task.findMany({
      where: { ...base, status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] }, plannedAt: { lt: now } },
      orderBy: { plannedAt: 'asc' },
      take: 5,
      select: { number: true, description: true, plannedAt: true, doerId: true },
    }),
    db.fmsRecordStep.findMany({
      where: {
        companyId,
        status: 'OPEN',
        plannedAt: { lt: now },
        record: { deletedAt: null, status: 'RUNNING' },
      },
      orderBy: { plannedAt: 'asc' },
      take: 5,
      select: {
        stepName: true,
        plannedAt: true,
        doerId: true,
        record: { select: { title: true, flow: { select: { name: true } } } },
      },
    }),
    db.ticket.count({
      where: { ...base, status: { in: ['OPEN', 'IN_PROGRESS'] }, escalationLevel: { gt: 0 } },
    }),
    db.task.count({
      where: { ...base, status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] }, plannedAt: { gte: t0, lt: t1 } },
    }),
    db.checklistRun.count({ where: { companyId, status: 'OPEN', plannedAt: { gte: t0, lt: t1 } } }),
    db.fmsRecordStep.count({ where: { companyId, status: 'OPEN', plannedAt: { gte: t0, lt: t1 } } }),
  ]);
  const [lateTaskCount, lateStepCount] = await Promise.all([
    db.task.count({
      where: { ...base, status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] }, plannedAt: { lt: now } },
    }),
    db.fmsRecordStep.count({
      where: {
        companyId,
        status: 'OPEN',
        plannedAt: { lt: now },
        record: { deletedAt: null, status: 'RUNNING' },
      },
    }),
  ]);
  const ids = [...lateTasks.map((t) => t.doerId), ...lateSteps.flatMap((s) => (s.doerId ? [s.doerId] : []))];
  const people = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const who = (id: string | null) => (id ? (people.get(id) ?? '?') : 'nobody');
  const onTime = (r: { doneAt: Date | null; plannedAt: Date }[]) =>
    r.filter((x) => x.doneAt && x.doneAt <= x.plannedAt).length;
  return [
    `Yesterday (${formatLocalDate(addDays(today, -1))}):`,
    `- Tasks done: ${doneTasks.length} (${onTime(doneTasks)} on time)`,
    `- Checklists done: ${checklistDone}; missed: ${checklistMissed}`,
    `- Process steps done: ${stepsDone.length} (${onTime(stepsDone)} on time)`,
    `Late right now:`,
    `- Tasks: ${lateTaskCount}`,
    ...lateTasks.map(
      (t) =>
        `  #${t.number} ${t.description.slice(0, 60)} — ${who(t.doerId)}, ${days(now.getTime() - t.plannedAt.getTime())} day(s) late`,
    ),
    `- Process steps: ${lateStepCount}`,
    ...lateSteps.map(
      (s) =>
        `  ${s.record.flow.name} · ${s.record.title.slice(0, 40)} · ${s.stepName} — ${who(s.doerId)}, ${days(now.getTime() - s.plannedAt.getTime())} day(s) late`,
    ),
    `- Help tickets escalated and still open: ${escalated}`,
    `Due today (${formatLocalDate(today)}): ${dueTasks} tasks, ${dueRuns} checklists, ${dueSteps} process steps`,
  ].join('\n');
}

/**
 * Every minute from the worker: at 08:45 (company time), once a day, the AI writes the owner a short
 * summary and it goes out through the notification rules (Telegram by default). Needs AI connected.
 */
export async function sendDailySummaries(
  db: Db,
  appSecret: string,
  now = new Date(),
  onlyCompanyId?: string,
) {
  const configs = await db.aiConfig.findMany({
    where: { dailySummary: true, ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}) },
    select: { companyId: true },
  });
  let sent = 0;
  for (const { companyId } of configs) {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { timezone: true, deletedAt: true },
    });
    if (!company || company.deletedAt) continue;
    const today = localDate(now, company.timezone);
    const minutes = Math.round((now.getTime() - zonedToUtc(today, 0, company.timezone).getTime()) / 60_000);
    if (minutes < SEND_AT_MINUTES) continue;
    if (!(await claimMark(db, companyId, `ai.daily:${today}`))) continue;
    const facts = await dailyFacts(db, companyId, company.timezone, now);
    let summary: string;
    try {
      const ctx = await companyContext(db, companyId);
      const r = await runAi(db, { companyId, userId: null, appSecret }, 'daily_summary', SUMMARY.id, (llm) =>
        llm.complete({
          system: SUMMARY.system(ctx.company, ctx.now),
          messages: [{ role: 'user', content: SUMMARY.user(facts) }],
          effort: 'low',
          maxTokens: 3_000,
        }),
      );
      summary = r.text;
    } catch {
      // The numbers still go out when the AI can't be reached.
      summary = facts;
    }
    const owners = await db.user.findMany({
      where: { companyId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' } },
      select: { id: true },
    });
    for (const o of owners) {
      await db.$transaction((tx) =>
        emitEvent(
          tx,
          { companyId, actorId: null },
          {
            name: 'ai.daily_summary',
            entityType: 'user',
            entityId: o.id,
            payload: { userId: o.id, date: formatLocalDate(today), summary, link: '/' },
          },
        ),
      );
      sent++;
    }
  }
  return sent;
}
