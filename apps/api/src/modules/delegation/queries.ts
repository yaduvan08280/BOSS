import type { Db, Prisma, Tx } from '@mono/db';
import {
  availableActions,
  delegationMachine,
  rygReport,
  scorecard,
  weekOf,
  weekTiles,
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
};

const TAB_STATUS: Record<string, TaskStatus[]> = {
  pending: ['AWAITING_ACCEPTANCE', 'OPEN', 'RETURNED_TO_CREATOR'],
  verification: ['PENDING_VERIFY'],
  done: ['DONE'],
};

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
  const all = await db.task.findMany({ where, orderBy: [{ plannedAt: 'asc' }], take: 1000 });
  const counts = { pending: 0, verification: 0, done: 0 };
  for (const t of all) {
    if (TAB_STATUS.pending!.includes(t.status as TaskStatus)) counts.pending++;
    else if (t.status === 'PENDING_VERIFY') counts.verification++;
    else if (t.status === 'DONE') counts.done++;
  }
  const tab = query.tab ?? 'pending';
  const rows =
    tab === 'all'
      ? all.filter((t) => t.status !== 'CANCELLED')
      : all.filter((t) => TAB_STATUS[tab]!.includes(t.status as TaskStatus));
  if (tab === 'done') rows.sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0));
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
    tasks: rows.slice(0, 500).map((t) => {
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
  // Small companies: read the waiting verifications and keep the ones this person must check.
  const waiting = await db.task.findMany({
    where: { companyId: actor.companyId, deletedAt: null, status: 'PENDING_VERIFY' },
    select: { verifierId: true, creatorId: true, doerId: true, doneAt: true },
  });
  const toVerify = waiting.filter((t) => effectiveVerifier(t, s) === actor.userId);
  const tiles = weekTiles(actor.userId, mine, week, now);
  return {
    pending: live.length,
    overdue: live.filter((t) => t.plannedAt < now).length,
    toVerify: toVerify.length,
    verifyLate: toVerify.filter(
      (t) => t.doneAt && now.getTime() - t.doneAt.getTime() > s.verifyWithinMinutes * 60_000,
    ).length,
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
