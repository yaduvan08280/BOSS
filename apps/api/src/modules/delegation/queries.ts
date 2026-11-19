import type { Db, Prisma, Tx } from '@mono/db';
import {
  availableActions,
  delegationMachine,
  rygReport,
  scorecard,
  weekOf,
  weekTiles,
  type DelegationSettings,
  type TaskStatus,
} from '@mono/shared';
import { notFound } from '../../lib/errors';
import { can, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { effectiveVerifier, rolesFor } from './service';

export type Scope = 'mine' | 'team' | 'all';

/**
 * Which tasks someone may see: their own (doer/creator/verifier, or one they did a part of and passed on),
 * their team's if HOD, everything if admin.
 */
export async function visibleWhere(db: Db | Tx, actor: Actor, scope: Scope): Promise<Prisma.TaskWhereInput> {
  const base: Prisma.TaskWhereInput = { companyId: actor.companyId, deletedAt: null };
  const s = await moduleSettings(db, actor.companyId, 'delegation');
  const mine: Prisma.TaskWhereInput[] = [
    { doerId: actor.userId },
    { creatorId: actor.userId },
    { verifierId: actor.userId },
    { events: { some: { type: 'passed_on', fromUserId: actor.userId } } },
  ];
  if (s.eaVerifies && s.eaUserId === actor.userId) mine.push({ verifierId: null });
  if (scope === 'all' && can(actor, 'delegation.admin')) return base;
  if (scope !== 'mine') {
    const team = await teamOf(db, actor.companyId, actor.userId);
    if (team.length) mine.push({ doerId: { in: team } });
  }
  return { ...base, OR: mine };
}

/**
 * `effectiveVerifier(task) === userId` as a database condition, so "what waits for my check" is counted by
 * the database instead of reading every waiting task of the company on each screen.
 */
export function verifierWhere(userId: string, s: DelegationSettings): Prisma.TaskWhereInput {
  const fallback: Prisma.TaskWhereInput[] = !s.eaVerifies
    ? []
    : s.eaUserId
      ? s.eaUserId === userId
        ? [{ verifierId: null }]
        : []
      : [{ verifierId: null, creatorId: userId }];
  return { doerId: { not: userId }, OR: [{ verifierId: userId }, ...fallback] };
}

export async function defaultScope(db: Db | Tx, actor: Actor): Promise<Scope> {
  if (can(actor, 'delegation.admin')) return 'all';
  return (await teamOf(db, actor.companyId, actor.userId)).length ? 'team' : 'mine';
}

export type TaskListQuery = {
  scope?: Scope;
  tab?: 'pending' | 'verification' | 'done' | 'all';
  q?: string;
  from?: string;
  to?: string;
  doerId?: string;
  take?: number;
};

const TAB_STATUS: Record<string, TaskStatus[]> = {
  pending: ['AWAITING_ACCEPTANCE', 'OPEN', 'RETURNED_TO_CREATOR'],
  verification: ['PENDING_VERIFY'],
  done: ['DONE'],
};

/** A tab of the delegation sheet shows at most this many tasks; the tab's count says how many there are. */
export const TASKS_SHOWN = 500;
/** How many a list sends unless asked for more (`take`). */
export const TASKS_STEP = 100;
const COUNT_UP_TO = 10_000;

export async function listTasks(db: Db, actor: Actor, query: TaskListQuery) {
  const scope = query.scope ?? (await defaultScope(db, actor));
  const where: Prisma.TaskWhereInput = { AND: [await visibleWhere(db, actor, scope)] };
  const and = where.AND as Prisma.TaskWhereInput[];
  if (query.doerId) and.push({ doerId: query.doerId });
  if (query.from) and.push({ plannedAt: { gte: new Date(query.from) } });
  if (query.to) and.push({ plannedAt: { lt: new Date(query.to) } });
  if (query.q) {
    const contains = { contains: query.q, mode: 'insensitive' as const };
    const people = await db.user.findMany({
      where: { companyId: actor.companyId, name: contains },
      select: { id: true },
    });
    const ids = people.map((p) => p.id);
    const n = Number(query.q.replace('#', ''));
    and.push({
      OR: [
        { description: contains },
        { doerId: { in: ids } },
        { verifierId: { in: ids } },
        ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      ],
    });
  }
  const s = await moduleSettings(db, actor.companyId, 'delegation');
  // Counted and filtered by the database: reading "the first thousand" and choosing the tab afterwards lost
  // every open task once a person could see more than a thousand old ones.
  const tab = query.tab ?? 'pending';
  // A hundred at a time: five hundred full tasks are 400 KB to make, send and read, and the screen draws a
  // hundred first in any case.
  const take = Math.min(Math.max(query.take ?? TASKS_STEP, 1), TASKS_SHOWN);
  const tabWhere: Prisma.TaskWhereInput =
    tab === 'all' ? { status: { not: 'CANCELLED' } } : { status: { in: TAB_STATUS[tab]! } };
  // Pending and waiting work: the oldest due first. Finished work: the latest first. "All": the latest 500
  // by planned date, shown oldest first as before.
  const order: Prisma.TaskOrderByWithRelationInput[] =
    tab === 'done' ? [{ doneAt: 'desc' }] : [{ plannedAt: tab === 'all' ? 'desc' : 'asc' }, { id: 'asc' }];
  // Each tab's count stops at COUNT_UP_TO: nobody needs the exact number of tasks finished over the years,
  // and counting half a million rows on every visit took a second.
  const countOf = (status: TaskStatus[]) =>
    db.task.count({ where: { AND: [where, { status: { in: status } }] }, take: COUNT_UP_TO });
  const [pending, verification, done, found] = await Promise.all([
    countOf(TAB_STATUS.pending!),
    countOf(TAB_STATUS.verification!),
    countOf(TAB_STATUS.done!),
    db.task.findMany({ where: { AND: [where, tabWhere] }, orderBy: order, take }),
  ]);
  // How many the tab can show in all (the screen asks for a hundred more at a time, up to TASKS_SHOWN).
  const inTab =
    tab === 'all'
      ? await db.task.count({ where: { AND: [where, tabWhere] }, take: TASKS_SHOWN })
      : { pending, verification, done }[tab];
  const total = Math.min(inTab, TASKS_SHOWN);
  const counts = { pending, verification, done };
  const rows = tab === 'all' ? found.reverse() : found;
  const attachments = await db.attachment.groupBy({
    by: ['entityId'],
    where: {
      companyId: actor.companyId,
      entityType: 'task',
      entityId: { in: rows.map((r) => r.id) },
      deletedAt: null,
    },
    _count: true,
  });
  const files = new Map(attachments.map((a) => [a.entityId, a._count]));
  const noteRows = await db.taskEvent.groupBy({
    by: ['taskId'],
    where: { companyId: actor.companyId, type: 'note', taskId: { in: rows.map((r) => r.id) } },
    _count: true,
  });
  const notes = new Map(noteRows.map((n) => [n.taskId, n._count]));
  return {
    scope,
    counts,
    total,
    tasks: rows.map((t) => {
      const ctx = {
        doerMustAccept: s.doerMustAccept,
        allowReopen: s.allowReopen,
        needsVerify: Boolean(effectiveVerifier(t, s)),
      };
      return {
        ...t,
        verifierId: effectiveVerifier(t, s),
        ownVerifierId: t.verifierId,
        files: files.get(t.id) ?? 0,
        notes: notes.get(t.id) ?? 0,
        actions: availableActions(delegationMachine, t.status as TaskStatus, rolesFor(actor, t, s), ctx),
      };
    }),
  };
}

export async function taskDetail(db: Db, actor: Actor, id: string) {
  const scope: Scope = can(actor, 'delegation.admin') ? 'all' : 'team';
  const fallback = await db.task.findFirst({
    where: { AND: [await visibleWhere(db, actor, scope), { id }] },
  });
  if (!fallback) throw notFound('Task');
  const s = await moduleSettings(db, actor.companyId, 'delegation');
  const [events, files] = await Promise.all([
    db.taskEvent.findMany({
      where: { taskId: fallback.id, companyId: actor.companyId },
      orderBy: { createdAt: 'asc' },
    }),
    db.attachment.findMany({
      where: { companyId: actor.companyId, entityType: 'task', entityId: fallback.id, deletedAt: null },
      select: { id: true, mime: true, originalName: true, size: true, uploadedById: true, createdAt: true },
    }),
  ]);
  const ctx = {
    doerMustAccept: s.doerMustAccept,
    allowReopen: s.allowReopen,
    needsVerify: Boolean(effectiveVerifier(fallback, s)),
  };
  return {
    ...fallback,
    verifierId: effectiveVerifier(fallback, s),
    ownVerifierId: fallback.verifierId,
    events,
    files: files.map((f) => ({ ...f, url: `/api/files/${f.id}` })),
    actions: availableActions(
      delegationMachine,
      fallback.status as TaskStatus,
      rolesFor(actor, fallback, s),
      ctx,
    ),
  };
}

/** KPI tiles for the signed-in person (CLAUDE.md §5.1). */
export async function myTiles(db: Db, actor: Actor) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const s = await moduleSettings(db, actor.companyId, 'delegation');
  const now = new Date();
  const week = weekOf(now, company.timezone);
  const mine = await db.task.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      doerId: actor.userId,
      OR: [
        { plannedAt: { gte: new Date(week.from.getTime() - 7 * 86_400_000) } },
        { status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] } },
      ],
    },
  });
  const live = mine.filter((t) => t.status === 'OPEN' || t.status === 'AWAITING_ACCEPTANCE');
  const mineToCheck = {
    companyId: actor.companyId,
    deletedAt: null,
    status: 'PENDING_VERIFY',
    ...verifierWhere(actor.userId, s),
  } satisfies Prisma.TaskWhereInput;
  const [toVerify, verifyLate] = await Promise.all([
    db.task.count({ where: mineToCheck }),
    db.task.count({
      where: { ...mineToCheck, doneAt: { lt: new Date(now.getTime() - s.verifyWithinMinutes * 60_000) } },
    }),
  ]);
  const tiles = weekTiles(actor.userId, mine, week, now);
  return {
    pending: live.length,
    overdue: live.filter((t) => t.plannedAt < now).length,
    toVerify,
    verifyLate,
    verifySlaMinutes: s.verifyWithinMinutes,
    doneThisWeek: tiles.doneThisWeek,
    doneOnTime: tiles.doneOnTime,
    score: tiles.score,
  };
}

/** Scorecard rows for everyone visible to the actor, for the week containing `at`. */
export async function scorecardReport(db: Db, actor: Actor, at: Date) {
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const s = await moduleSettings(db, actor.companyId, 'delegation');
  const week = weekOf(at, company.timezone);
  const from = new Date(week.from.getTime() - 7 * 86_400_000);
  const where = {
    AND: [
      await visibleWhere(db, actor, await defaultScope(db, actor)),
      { OR: [{ plannedAt: { gte: from, lt: week.to } }, { doneAt: { gte: from, lt: week.to } }] },
    ],
  };
  const tasks = (await db.task.findMany({ where })).map((t) => ({
    ...t,
    verifierId: effectiveVerifier(t, s),
  }));
  const people = [
    ...new Set(tasks.flatMap((t) => [t.doerId, t.verifierId].filter((x): x is string => Boolean(x)))),
  ];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const now = new Date();
  return {
    week: { start: week.start, end: week.end },
    rows: people
      .map((id) => ({
        personId: id,
        name: names.get(id) ?? '?',
        lines: scorecard(id, tasks, week, now, { verifySlaMinutes: s.verifyWithinMinutes }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function rygData(db: Db, actor: Actor, from: Date, to: Date) {
  const where = {
    AND: [await visibleWhere(db, actor, await defaultScope(db, actor)), { plannedAt: { gte: from, lt: to } }],
  };
  const tasks = await db.task.findMany({ where });
  const rows = rygReport(tasks, new Date());
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: rows.map((r) => r.personId) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return rows
    .map((r) => ({ ...r, name: names.get(r.personId) ?? '?' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
