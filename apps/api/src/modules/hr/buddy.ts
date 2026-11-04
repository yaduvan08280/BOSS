import type { BuddyRequest, Db } from '@mono/db';
import { buddyMachine, transition } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { period } from './balance';
import { runCovers, scheduleCovers } from './cover';
import { askBuddy, maybeAutoApprove, uncovered, type Stored } from './leave';
import { canDecideFor, hrPerson, hrRulesOf } from './people';
import { suggestionsFor } from './work';

/** The Buddy says yes or no (web or Telegram). A no asks the next one when the autopilot picks Buddies. */
export async function answerBuddy(db: Db, actor: Actor, id: string, accept: boolean, note?: string | null) {
  const br = await db.buddyRequest.findFirst({ where: { id, companyId: actor.companyId } });
  if (!br) throw notFound('Buddy request');
  const roles: 'buddy'[] = br.buddyId === actor.userId ? ['buddy'] : [];
  const to = transition(buddyMachine, {
    from: br.status as 'ASKED',
    action: accept ? 'accept' : 'decline',
    roles,
    ctx: {},
  }).to;
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.buddyRequest.update({
      where: { id },
      data: { status: to, answeredAt: new Date(), note: note ?? null },
    });
    const leave = br.leaveRequestId
      ? await tx.leaveRequest.findUnique({ where: { id: br.leaveRequestId } })
      : null;
    if (accept && (!leave || leave.status === 'APPROVED')) await scheduleCovers(tx, row);
    await emitEvent(
      tx,
      { companyId: br.companyId, actorId: actor.userId },
      {
        name: 'hr.buddy_answered',
        entityType: 'buddy_request',
        entityId: id,
        payload: {
          userId: br.userId,
          buddyId: br.buddyId,
          answer: accept ? 'Yes, I will cover' : `No${note ? `: ${note}` : ''}`,
          link: '/hr/leave?tab=mine',
        },
      },
    );
    return row;
  });
  if (!accept) await askNext(db, br);
  if (br.leaveRequestId) await maybeAutoApprove(db, br.leaveRequestId);
  await runCovers(db);
  return updated;
}

/** After a no (or no answer in time): the next suggestion, if the autopilot picks Buddies. */
async function askNext(db: Db, br: BuddyRequest) {
  const rules = await hrRulesOf(db, br.companyId);
  if (!rules.autopilot.autoPick || !br.leaveRequestId) return;
  const leave = await db.leaveRequest.findUniqueOrThrow({ where: { id: br.leaveRequestId } });
  if (!['PENDING', 'APPROVED'].includes(leave.status)) return;
  const p = await hrPerson(db, br.companyId, br.userId);
  const tried = new Set(
    (await db.buddyRequest.findMany({ where: { leaveRequestId: leave.id }, select: { buddyId: true } })).map(
      (b) => b.buddyId,
    ),
  );
  const items = (br.items as Stored[]).map((s) => ({ ...s, due: null, backups: [] as string[] }));
  const withSuggestions = await suggestionsFor(db, p, rules, items, {
    from: leave.from,
    to: leave.to,
    fromAt: br.from,
    toAt: br.to,
  });
  const next = withSuggestions[0]?.suggestions.find((s) => !tried.has(s.id));
  if (!next) return;
  await db.$transaction((tx) =>
    askBuddy(tx, rules, leave, p, next.id, br.items as Stored[], { fromAt: br.from, toAt: br.to }, null),
  );
}

/** The person (or HR) asks someone else for work that has no Buddy yet. */
export async function askAnotherBuddy(
  db: Db,
  actor: Actor,
  leaveId: string,
  keys: string[],
  buddyId: string,
) {
  const leave = await db.leaveRequest.findFirst({ where: { id: leaveId, companyId: actor.companyId } });
  if (!leave) throw notFound('Leave request');
  if (leave.userId !== actor.userId && !(await canDecideFor(db, actor, leave.userId)))
    throw new AppError(403, 'FORBIDDEN', 'Only the person, their HOD or HR can ask a Buddy');
  if (!['PENDING', 'APPROVED'].includes(leave.status))
    throw new AppError(409, 'CONFLICT', 'This leave is closed');
  if (buddyId === leave.userId) throw new AppError(400, 'VALIDATION_FAILED', 'Nobody can be their own Buddy');
  const open = (await uncovered(db, leave)).filter((w) => keys.includes(w.key));
  if (!open.length) throw new AppError(400, 'VALIDATION_FAILED', 'That work is already covered');
  const p = await hrPerson(db, actor.companyId, leave.userId);
  const rules = await hrRulesOf(db, actor.companyId);
  const tz = (
    await db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } })
  ).timezone;
  return db.$transaction((tx) =>
    askBuddy(
      tx,
      rules,
      leave,
      p,
      buddyId,
      open,
      period(leave.from, leave.to, leave.half, p, tz),
      actor.userId,
    ),
  );
}

/** Every 5 minutes: Buddy requests past their answer time expire (and the next one is asked, if autopilot). */
export async function expireBuddyRequests(db: Db, now = new Date()) {
  const late = await db.buddyRequest.findMany({ where: { status: 'ASKED', dueAt: { lt: now } } });
  for (const br of late) {
    await db.$transaction(async (tx) => {
      await tx.buddyRequest.update({ where: { id: br.id }, data: { status: 'EXPIRED', answeredAt: now } });
      await emitEvent(
        tx,
        { companyId: br.companyId, actorId: null },
        {
          name: 'hr.buddy_answered',
          entityType: 'buddy_request',
          entityId: br.id,
          payload: {
            userId: br.userId,
            buddyId: br.buddyId,
            answer: 'No answer in time',
            link: '/hr/leave?tab=mine',
          },
        },
      );
    });
    await askNext(db, br);
  }
  return late.length;
}
