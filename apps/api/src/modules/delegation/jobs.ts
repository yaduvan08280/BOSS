import type { Db, Task } from '@mono/db';
import { localDate, zonedToUtc } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { afterId, paged } from '../../lib/paged';
import { moduleSettings } from '../work/settings';
import { effectiveVerifier } from './service';

/** How many tasks that are still late are told again in one pass, per company (the rest follow in later passes). */
export const RETELL_PER_PASS = 2000;

/**
 * Overdue detection (every 5 minutes): open tasks past their planned time raise `delegation.overdue`.
 * Then again once a day while they stay overdue, so people aren't flooded. A task that has just become late
 * is always told at once; the daily "still late" round is spread over the passes after midnight, so a company
 * with tens of thousands of late tasks does not hand the worker all of them in one minute (it did: 58,000
 * events at 00:03, and everything else on the server slowed while they were worked through).
 */
export async function flagOverdueTasks(db: Db, now = new Date(), retell = RETELL_PER_PASS): Promise<number> {
  let flagged = 0;
  // Company by company, and only the tasks not yet told today: a task stays late for weeks, and reading every
  // late task every five minutes to find that each was already told this morning is work for nothing.
  for (const c of await db.company.findMany({
    where: { deletedAt: null },
    select: { id: true, timezone: true },
  }))
    flagged += await flagOverdueOf(db, c.id, c.timezone, now, retell);
  return flagged;
}

async function flagOverdueOf(db: Db, companyId: string, tz: string, now: Date, retell: number) {
  const today = zonedToUtc(localDate(now, tz), 0, tz);
  const lateWhere = {
    companyId,
    deletedAt: null,
    status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] },
    plannedAt: { lt: now },
  };
  const pages = (told: object) =>
    paged((after, take) =>
      db.task.findMany({ where: { ...lateWhere, ...told, ...afterId(after) }, orderBy: { id: 'asc' }, take }),
    );
  let flagged = 0;
  let set: Awaited<ReturnType<typeof moduleSettings<'delegation'>>> | undefined;
  const tell = async (t: Task) => {
    set ??= await moduleSettings(db, companyId, 'delegation');
    flagged += await tellOverdue(db, t, set, now);
  };
  for await (const t of pages({ lastOverdueNotifiedAt: null })) await tell(t);
  let again = 0;
  for await (const t of pages({ lastOverdueNotifiedAt: { lt: today } })) {
    if (again++ >= retell) break;
    await tell(t);
  }
  return flagged;
}

type Settings = Awaited<ReturnType<typeof moduleSettings<'delegation'>>>;

async function tellOverdue(db: Db, t: Task, settings: Settings, now: Date): Promise<number> {
  let told = 0;
  await db.$transaction(async (tx) => {
    const res = await tx.task.updateMany({
      where: { id: t.id, lastOverdueNotifiedAt: t.lastOverdueNotifiedAt },
      data: { lastOverdueNotifiedAt: now },
    });
    if (!res.count) return;
    told = 1;
    await emitEvent(
      tx,
      { companyId: t.companyId, actorId: null },
      {
        name: 'delegation.overdue',
        entityType: 'task',
        entityId: t.id,
        payload: {
          doerId: t.doerId,
          creatorId: t.creatorId,
          verifierId: effectiveVerifier(t, settings),
          number: t.number,
          title: t.description.slice(0, 80),
          due: t.plannedAt.toISOString(),
          link: `/delegation?task=${t.id}`,
          telegramActions: t.status === 'OPEN' ? ['done', 'move'] : ['accept'],
        },
      },
    );
  });
  return told;
}

/**
 * "Accept within N minutes": a task still waiting for its doer to accept after that time
 * reminds the doer and tells the creator, once per assignment.
 */
export async function remindUnaccepted(db: Db, now = new Date()): Promise<number> {
  let sent = 0;
  const companies = await db.task.groupBy({
    by: ['companyId'],
    where: { deletedAt: null, status: 'AWAITING_ACCEPTANCE' },
  });
  for (const { companyId } of companies) {
    const s = await moduleSettings(db, companyId, 'delegation');
    const before = new Date(now.getTime() - s.acceptWithinMinutes * 60_000);
    // One question to the database: the waiting tasks given long enough ago that were not reminded since
    // (asking each waiting task in turn cost three queries a task, every five minutes, for good).
    const due = await db.$queryRaw<{ id: string }[]>`
      SELECT t.id FROM tasks t
      LEFT JOIN LATERAL (
        SELECT max(e.created_at) AS at FROM task_events e
        WHERE e.task_id = t.id AND e.to_status = 'AWAITING_ACCEPTANCE'
      ) given ON true
      WHERE t.company_id = ${companyId} AND t.deleted_at IS NULL AND t.status = 'AWAITING_ACCEPTANCE'
        AND coalesce(given.at, t.created_at) <= ${before}
        AND NOT EXISTS (
          SELECT 1 FROM task_events r
          WHERE r.task_id = t.id AND r.type = 'accept_reminder'
            AND r.created_at >= coalesce(given.at, t.created_at)
        )
      ORDER BY t.id`;
    for (let i = 0; i < due.length; i += 500)
      for (const t of await db.task.findMany({
        where: { id: { in: due.slice(i, i + 500).map((d) => d.id) }, status: 'AWAITING_ACCEPTANCE' },
        orderBy: { id: 'asc' },
      }))
        sent += await remindOne(db, t, s.acceptWithinMinutes);
  }
  return sent;
}

async function remindOne(db: Db, t: Task, minutes: number): Promise<number> {
  await db.$transaction(async (tx) => {
    await tx.taskEvent.create({
      data: { companyId: t.companyId, taskId: t.id, type: 'accept_reminder', actorId: null },
    });
    await emitEvent(
      tx,
      { companyId: t.companyId, actorId: null },
      {
        name: 'delegation.accept_late',
        entityType: 'task',
        entityId: t.id,
        payload: {
          doerId: t.doerId,
          creatorId: t.creatorId,
          number: t.number,
          title: t.description.slice(0, 80),
          minutes,
          link: `/delegation?task=${t.id}`,
          telegramActions: ['accept'],
        },
      },
    );
  });
  return 1;
}
