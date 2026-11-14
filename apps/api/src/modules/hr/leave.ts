import type { Db, LeaveRequest, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  leaveDays,
  leaveMachine,
  leaveYearOf,
  needsBuddy,
  transition,
  zonedToUtc,
  type HrRules,
  type LeaveRequestInput,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { ownerOf, type Actor } from '../work/actor';
import { settleDay } from './attendance';
import { companyCalendar } from './calendar';
import { balancesOf, ensureLeaveTypes, period } from './balance';
import { cancelCovers, runCovers, scheduleCovers } from './cover';
import { chainFor, hasRoute } from '../branches/approvals';
import { canDecideFor, hrPerson, hrRulesOf, isHr, type HrPerson } from './people';
import { openWork, suggestionsFor, type WorkItem } from './work';

export type Stored = Pick<WorkItem, 'key' | 'entityType' | 'entityId' | 'title'>;

/** Before applying: the days it takes, whether a Buddy is needed, the open work and who could cover each piece. */
export async function previewLeave(
  db: Db,
  actor: Actor,
  q: { from: string; to: string; half?: string | null },
) {
  await ensureLeaveTypes(db, actor.companyId);
  const p = await hrPerson(db, actor.companyId, actor.userId);
  const rules = await hrRulesOf(db, actor.companyId);
  const cal = await companyCalendar(db, actor.companyId, p.branchId);
  const days = leaveDays(q.from, q.to, Boolean(q.half), cal);
  const { fromAt, toAt } = period(q.from, q.to, q.half, p, cal.tz);
  const needs = needsBuddy(rules.buddy, { days, half: Boolean(q.half) });
  const items = needs ? await openWork(db, p, fromAt, toAt) : [];
  return {
    days,
    needsBuddy: needs,
    rule: rules.buddy.noBuddy,
    items: await suggestionsFor(db, p, rules, items, { from: q.from, to: q.to, fromAt, toAt }),
  };
}

export async function askBuddy(
  tx: Tx,
  rules: HrRules,
  leave: LeaveRequest,
  p: HrPerson,
  buddyId: string,
  items: Stored[],
  period: { fromAt: Date; toAt: Date },
  actorId: string | null,
) {
  const br = await tx.buddyRequest.create({
    data: {
      companyId: leave.companyId,
      leaveRequestId: leave.id,
      userId: p.id,
      buddyId,
      items: items as object[],
      from: period.fromAt,
      to: period.toAt,
      dueAt: new Date(Date.now() + rules.buddyAnswer.answerHours * 3600_000),
      createdById: actorId,
    },
  });
  await emitEvent(
    tx,
    { companyId: leave.companyId, actorId },
    {
      name: 'hr.buddy_requested',
      entityType: 'buddy_request',
      entityId: br.id,
      payload: {
        buddyId,
        personId: p.id,
        from: leave.from,
        to: leave.to,
        count: items.length,
        work: items.map((i) => i.title).join('\n'),
        link: `/hr/leave?tab=buddy&request=${br.id}`,
        telegramActions: ['buddyyes', 'buddyno'],
        telegramActionsFor: buddyId,
      },
    },
  );
  return br;
}

/** Apply for leave (§9.2): balance and overlap checks, then a Buddy request per chosen Buddy, then the HOD is told. */
export async function applyLeave(db: Db, actor: Actor, input: LeaveRequestInput) {
  const p = await hrPerson(db, actor.companyId, actor.userId);
  const rules = await hrRulesOf(db, actor.companyId);
  await ensureLeaveTypes(db, actor.companyId);
  const type = await db.leaveType.findFirst({
    where: { id: input.leaveTypeId, companyId: actor.companyId, deletedAt: null, active: true },
  });
  if (!type) throw new AppError(400, 'VALIDATION_FAILED', 'Pick the kind of leave');
  const cal = await companyCalendar(db, actor.companyId, p.branchId);
  const days = leaveDays(input.from, input.to, Boolean(input.half), cal);
  if (!days) throw new AppError(400, 'VALIDATION_FAILED', 'Those are all holidays or weekly offs');
  const clash = await db.leaveRequest.findFirst({
    where: {
      userId: p.id,
      status: { in: ['PENDING', 'APPROVED'] },
      from: { lte: input.to },
      to: { gte: input.from },
    },
  });
  if (clash)
    throw new AppError(409, 'CONFLICT', `You already asked for leave from ${clash.from} to ${clash.to}`);
  if (type.paid) {
    const bal = (await balancesOf(db, actor.companyId, p.id, input.from)).balances.find(
      (b) => b.leaveTypeId === type.id,
    );
    if (bal && days > bal.available)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `Only ${Math.max(0, bal.available)} day(s) of ${type.name} left`,
      );
  }
  const span = period(input.from, input.to, input.half, p, cal.tz);
  const needs = needsBuddy(rules.buddy, { days, half: Boolean(input.half) });
  const items = needs
    ? await suggestionsFor(db, p, rules, await openWork(db, p, span.fromAt, span.toAt), {
        from: input.from,
        to: input.to,
        ...span,
      })
    : [];
  // The chosen Buddy for each piece, else (autopilot) the first suggestion.
  const chosen = new Map<string, Stored[]>();
  for (const it of items) {
    const buddy = input.buddies[it.key] || (rules.autopilot.autoPick ? it.suggestions[0]?.id : undefined);
    if (!buddy) continue;
    if (buddy === p.id) throw new AppError(400, 'VALIDATION_FAILED', "You can't be your own Buddy");
    chosen.set(buddy, [
      ...(chosen.get(buddy) ?? []),
      { key: it.key, entityType: it.entityType, entityId: it.entityId, title: it.title },
    ]);
  }
  const buddies = await db.user.findMany({
    where: { companyId: actor.companyId, id: { in: [...chosen.keys()] }, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });
  if (buddies.length !== chosen.size)
    throw new AppError(400, 'VALIDATION_FAILED', 'A chosen Buddy is not an active person');
  // The owner's approval route, when there is one: its first person is asked (else the HOD).
  const route = await chainFor(db, actor.companyId, 'hr.leave', { requesterId: p.id });
  const askId = route ? (route.first[0] ?? (await ownerOf(db, actor.companyId))) : p.hodId;
  const leave = await db.$transaction(async (tx) => {
    const row = await tx.leaveRequest.create({
      data: {
        companyId: actor.companyId,
        number: await nextCounter(tx, actor.companyId, 'leave'),
        userId: p.id,
        leaveTypeId: type.id,
        from: input.from,
        to: input.to,
        half: input.half ?? null,
        days,
        reason: input.reason,
        approverId: askId,
        work: items.map(({ key, entityType, entityId, title }) => ({ key, entityType, entityId, title })),
      },
    });
    for (const [buddyId, list] of chosen)
      await askBuddy(tx, rules, row, p, buddyId, list, span, actor.userId);
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'hr.leave_requested',
        entityType: 'leave_request',
        entityId: row.id,
        payload: {
          userId: p.id,
          personId: p.id,
          days,
          type: type.name,
          from: input.from,
          to: input.to,
          buddy: chosen.size ? `${chosen.size} asked` : items.length ? 'none yet' : 'not needed',
          link: `/hr/leave?tab=approve&leave=${row.id}`,
          telegramActions: ['leaveok', 'leaveno'],
          telegramActionsFor: askId,
          ...(route ? { approverIds: route.first.length ? route.first : [askId] } : {}),
        },
      },
    );
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'leave.requested', entityType: 'leave_request', entityId: row.id, after: row },
    );
    return row;
  });
  await maybeAutoApprove(db, leave.id);
  return leave;
}

/** Work in the leave that no accepted Buddy covers yet. */
export async function uncovered(db: Db | Tx, leave: LeaveRequest) {
  const accepted = await db.buddyRequest.findMany({
    where: { leaveRequestId: leave.id, status: 'ACCEPTED' },
    select: { items: true },
  });
  const covered = new Set(accepted.flatMap((a) => (a.items as Stored[]).map((i) => i.key)));
  return (leave.work as Stored[]).filter((w) => !covered.has(w.key));
}

async function approve(
  tx: Tx,
  leave: LeaveRequest,
  by: Actor | null,
  note: string | null,
  withoutCover: boolean,
) {
  const type = await tx.leaveType.findUniqueOrThrow({ where: { id: leave.leaveTypeId } });
  const rules = await hrRulesOf(tx, leave.companyId);
  const year = leaveYearOf(leave.from, rules.leave.yearStartMonth);
  const updated = await tx.leaveRequest.update({
    where: { id: leave.id },
    data: {
      status: 'APPROVED',
      decidedById: by?.userId ?? null,
      decidedAt: new Date(),
      decisionNote: note,
      approvedWithoutCover: withoutCover,
    },
  });
  if (type.paid)
    await tx.leaveBalance.updateMany({
      where: { userId: leave.userId, leaveTypeId: type.id, year },
      data: { used: { increment: leave.days } },
    });
  for (const br of await tx.buddyRequest.findMany({
    where: { leaveRequestId: leave.id, status: 'ACCEPTED' },
  }))
    await scheduleCovers(tx, br);
  await emitEvent(
    tx,
    { companyId: leave.companyId, actorId: by?.userId ?? null },
    {
      name: 'hr.leave_decided',
      entityType: 'leave_request',
      entityId: leave.id,
      payload: {
        userId: leave.userId,
        decision: 'approved',
        type: type.name,
        from: leave.from,
        to: leave.to,
        link: '/hr/leave?tab=mine',
      },
    },
  );
  return updated;
}

/** "Approve short leave by itself" (autopilot): a day or less, every piece of work covered. */
export async function maybeAutoApprove(db: Db, leaveId: string) {
  const leave = await db.leaveRequest.findUniqueOrThrow({ where: { id: leaveId } });
  const rules = await hrRulesOf(db, leave.companyId);
  if (leave.status !== 'PENDING' || !rules.autopilot.autoApproveShort || Number(leave.days) > 1) return;
  if ((await uncovered(db, leave)).length) return;
  await db.$transaction((tx) => approve(tx, leave, null, 'Approved by autopilot (short leave)', false));
  await runCovers(db);
}

export async function decideLeave(db: Db, actor: Actor, id: string, ok: boolean, note?: string | null) {
  const leave = await db.leaveRequest.findFirst({ where: { id, companyId: actor.companyId } });
  if (!leave) throw notFound('Leave request');
  const roles: ('approver' | 'hr')[] = [];
  const routed = await hasRoute(db, actor.companyId, 'hr.leave');
  if (await canDecideFor(db, actor, leave.userId, { kind: 'hr.leave', askedAt: leave.createdAt }))
    roles.push('approver');
  // Without a route HR may decide any leave; with one, the route (and the owner) decides.
  if (!routed && leave.userId !== actor.userId && (await isHr(db, actor))) roles.push('hr');
  transition(leaveMachine, {
    from: leave.status as 'PENDING',
    action: ok ? 'approve' : 'reject',
    roles,
    ctx: { started: false },
  });
  const rules = await hrRulesOf(db, actor.companyId);
  let withoutCover = false;
  if (ok) {
    const open = await uncovered(db, leave);
    if (open.length && rules.buddy.noBuddy === 'block')
      throw new AppError(409, 'CONFLICT', `${open.length} piece(s) of work still have no Buddy`);
    withoutCover = open.length > 0 && rules.buddy.noBuddy === 'warn';
  }
  const out = await db.$transaction(async (tx) => {
    if (ok) return approve(tx, leave, actor, note ?? null, withoutCover);
    await tx.buddyRequest.updateMany({
      where: { leaveRequestId: leave.id, status: { in: ['ASKED', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });
    const type = await tx.leaveType.findUniqueOrThrow({ where: { id: leave.leaveTypeId } });
    await emitEvent(
      tx,
      { companyId: leave.companyId, actorId: actor.userId },
      {
        name: 'hr.leave_decided',
        entityType: 'leave_request',
        entityId: leave.id,
        payload: {
          userId: leave.userId,
          decision: 'not approved',
          type: type.name,
          from: leave.from,
          to: leave.to,
          link: '/hr/leave?tab=mine',
        },
      },
    );
    return tx.leaveRequest.update({
      where: { id: leave.id },
      data: {
        status: 'REJECTED',
        decidedById: actor.userId,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      },
    });
  });
  if (ok) {
    await runCovers(db);
    await resettleDays(db, leave);
  }
  return { ...out, withoutCover };
}

/**
 * A leave decided after its days were settled (off sick on Monday, asked for on Tuesday): settle those days
 * again, so the muster and pay read "on leave" instead of "absent" — and the other way round when it is cancelled.
 */
async function resettleDays(db: Db, leave: LeaveRequest) {
  const days = await db.attendanceDay.findMany({
    where: { userId: leave.userId, date: { gte: leave.from, lte: leave.to } },
    select: { date: true },
  });
  if (!days.length) return;
  const p = await hrPerson(db, leave.companyId, leave.userId);
  for (const d of days) await settleDay(db, leave.companyId, p, d.date);
}

export async function cancelLeave(db: Db, actor: Actor, id: string) {
  const leave = await db.leaveRequest.findFirst({ where: { id, companyId: actor.companyId } });
  if (!leave) throw notFound('Leave request');
  const roles: ('person' | 'hr')[] = [];
  if (leave.userId === actor.userId) roles.push('person');
  if (await isHr(db, actor)) roles.push('hr');
  const tz = (
    await db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } })
  ).timezone;
  const started = Date.now() >= zonedToUtc(leave.from, 0, tz).getTime();
  transition(leaveMachine, { from: leave.status as 'PENDING', action: 'cancel', roles, ctx: { started } });
  const out = await db.$transaction(async (tx) => {
    if (leave.status === 'APPROVED') {
      const rules = await hrRulesOf(tx, leave.companyId);
      await tx.leaveBalance.updateMany({
        where: {
          userId: leave.userId,
          leaveTypeId: leave.leaveTypeId,
          year: leaveYearOf(leave.from, rules.leave.yearStartMonth),
        },
        data: { used: { decrement: leave.days } },
      });
    }
    await tx.buddyRequest.updateMany({
      where: { leaveRequestId: leave.id, status: { in: ['ASKED', 'ACCEPTED'] } },
      data: { status: 'CANCELLED' },
    });
    await cancelCovers(tx, { leaveRequestId: leave.id });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'leave.cancelled', entityType: 'leave_request', entityId: leave.id, before: leave },
    );
    return tx.leaveRequest.update({ where: { id: leave.id }, data: { status: 'CANCELLED' } });
  });
  if (leave.status === 'APPROVED') await resettleDays(db, leave);
  return out;
}
