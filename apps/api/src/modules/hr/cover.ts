import type { BuddyRequest, Cover, Db, Tx } from '@mono/db';
import { coverMachine, transition, type HrRules } from '@mono/shared';
import { emitEvent } from '../../lib/events';
import { hrRulesOf } from './people';
import type { WorkItem } from './work';

type Item = Pick<WorkItem, 'entityType' | 'entityId' | 'title'>;
const LIVE_TASK = ['OPEN', 'AWAITING_ACCEPTANCE'];

/** One cover per piece of work of an accepted Buddy request, for the period it covers. */
export async function scheduleCovers(tx: Tx, br: BuddyRequest) {
  const items = br.items as Item[];
  for (const it of items) {
    const exists = await tx.cover.findFirst({
      where: {
        companyId: br.companyId,
        entityType: it.entityType,
        entityId: it.entityId,
        originalUserId: br.userId,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        from: { lt: br.to },
        to: { gt: br.from },
      },
    });
    if (exists) continue;
    await tx.cover.create({
      data: {
        companyId: br.companyId,
        entityType: it.entityType,
        entityId: it.entityId,
        title: it.title,
        originalUserId: br.userId,
        buddyUserId: br.buddyId,
        from: br.from,
        to: br.to,
        leaveRequestId: br.leaveRequestId,
        buddyRequestId: br.id,
      },
    });
  }
}

const note = (name: string) => `Buddy cover while ${name} is away`;

/** Hand the work to the Buddy: they become its doer and it shows "Covered by …". */
async function handOver(tx: Tx, c: Cover, now: Date) {
  const away = await tx.user.findUniqueOrThrow({ where: { id: c.originalUserId }, select: { name: true } });
  if (c.entityType === 'task') {
    const t = await tx.task.findFirst({ where: { id: c.entityId, deletedAt: null } });
    if (!t || t.doerId !== c.originalUserId || !LIVE_TASK.includes(t.status)) return;
    await tx.task.update({
      where: { id: t.id },
      data: { doerId: c.buddyUserId, coveredById: c.buddyUserId },
    });
    await tx.taskEvent.create({
      data: {
        companyId: t.companyId,
        taskId: t.id,
        type: 'reassigned',
        fromUserId: c.originalUserId,
        toUserId: c.buddyUserId,
        note: note(away.name),
      },
    });
    await emitEvent(
      tx,
      { companyId: t.companyId, actorId: null },
      {
        name: 'delegation.assigned',
        entityType: 'task',
        entityId: t.id,
        payload: {
          doerId: c.buddyUserId,
          creatorId: t.creatorId,
          number: t.number,
          title: t.description.slice(0, 80),
          due: t.plannedAt.toISOString(),
          link: `/delegation?task=${t.id}`,
          telegramActions: t.status === 'AWAITING_ACCEPTANCE' ? ['accept'] : ['done', 'move'],
        },
      },
    );
  } else if (c.entityType === 'fms_step') {
    const s = await tx.fmsRecordStep.findFirst({
      where: { id: c.entityId, status: 'OPEN', doerId: c.originalUserId },
    });
    if (!s) return;
    await tx.fmsRecordStep.update({
      where: { id: s.id },
      data: {
        doerId: c.buddyUserId,
        coveredById: c.buddyUserId,
        originalDoerId: s.originalDoerId ?? s.doerId,
      },
    });
  } else {
    await tx.checklistRun.updateMany({
      where: {
        masterId: c.entityId,
        doerId: c.originalUserId,
        status: 'OPEN',
        plannedAt: { gte: c.from, lt: c.to },
      },
      data: { doerId: c.buddyUserId, coveredById: c.buddyUserId },
    });
  }
  void now;
}

/** Give the work back (all, or what the Buddy hasn't started), per "when the person is back". */
async function giveBack(tx: Tx, c: Cover, onReturn: HrRules['buddyAnswer']['onReturn']) {
  if (onReturn === 'keep') return;
  const all = onReturn === 'all';
  if (c.entityType === 'task') {
    const t = await tx.task.findFirst({ where: { id: c.entityId, deletedAt: null } });
    if (!t || t.doerId !== c.buddyUserId || !LIVE_TASK.includes(t.status)) return;
    const touched = await tx.taskEvent.count({
      // Anything the Buddy did on it once the cover was arranged counts as started.
      where: { taskId: t.id, actorId: c.buddyUserId, createdAt: { gte: c.createdAt } },
    });
    if (!all && touched) return;
    await tx.task.update({ where: { id: t.id }, data: { doerId: c.originalUserId, coveredById: null } });
    await tx.taskEvent.create({
      data: {
        companyId: t.companyId,
        taskId: t.id,
        type: 'reassigned',
        fromUserId: c.buddyUserId,
        toUserId: c.originalUserId,
        note: 'Back after the leave',
      },
    });
  } else if (c.entityType === 'fms_step') {
    const s = await tx.fmsRecordStep.findFirst({
      where: { id: c.entityId, status: 'OPEN', doerId: c.buddyUserId },
    });
    if (!s) return;
    const started = Boolean(s.note) || Object.keys((s.data as object | null) ?? {}).length > 0;
    if (!all && started) return;
    await tx.fmsRecordStep.update({
      where: { id: s.id },
      data: { doerId: c.originalUserId, coveredById: null },
    });
  } else {
    await tx.checklistRun.updateMany({
      where: {
        masterId: c.entityId,
        doerId: c.buddyUserId,
        coveredById: c.buddyUserId,
        status: 'OPEN',
        ...(all ? {} : { itemsDone: 0 }),
      },
      data: { doerId: c.originalUserId, coveredById: null },
    });
  }
}

export async function startCover(tx: Tx, c: Cover, now = new Date()) {
  const to = transition(coverMachine, {
    from: c.status as 'SCHEDULED',
    action: 'start',
    roles: ['system'],
    ctx: {},
  }).to;
  await handOver(tx, c, now);
  await tx.cover.update({ where: { id: c.id }, data: { status: to, startedAt: now } });
}

export async function endCover(
  tx: Tx,
  c: Cover,
  onReturn: HrRules['buddyAnswer']['onReturn'],
  now = new Date(),
) {
  const action = onReturn === 'keep' ? 'keep' : 'return';
  const to = transition(coverMachine, { from: c.status as 'ACTIVE', action, roles: ['system'], ctx: {} }).to;
  await giveBack(tx, c, onReturn);
  await tx.cover.update({ where: { id: c.id }, data: { status: to, endedAt: now } });
}

/** Leave called off: scheduled covers drop; active ones give everything back now. */
export async function cancelCovers(
  tx: Tx,
  where: { leaveRequestId?: string; buddyRequestId?: string },
  now = new Date(),
) {
  const covers = await tx.cover.findMany({ where: { ...where, status: { in: ['SCHEDULED', 'ACTIVE'] } } });
  for (const c of covers) {
    if (c.status === 'ACTIVE') await giveBack(tx, c, 'all');
    await tx.cover.update({ where: { id: c.id }, data: { status: 'CANCELLED', endedAt: now } });
  }
}

/** Every 5 minutes: start covers whose leave has begun, end those whose leave is over. */
export async function runCovers(db: Db, now = new Date()) {
  let started = 0;
  let ended = 0;
  const due = await db.cover.findMany({
    where: { status: 'SCHEDULED', from: { lte: now }, to: { gt: now } },
  });
  for (const c of due) {
    await db.$transaction((tx) => startCover(tx, c, now));
    started++;
  }
  const over = await db.cover.findMany({
    where: { status: { in: ['SCHEDULED', 'ACTIVE'] }, to: { lte: now } },
  });
  const rules = new Map<string, HrRules>();
  for (const c of over) {
    if (!rules.has(c.companyId)) rules.set(c.companyId, await hrRulesOf(db, c.companyId));
    await db.$transaction(async (tx) => {
      // A cover that never started (the leave was too short to catch) just closes.
      if (c.status === 'SCHEDULED')
        await tx.cover.update({ where: { id: c.id }, data: { status: 'CANCELLED', endedAt: now } });
      else await endCover(tx, c, rules.get(c.companyId)!.buddyAnswer.onReturn, now);
    });
    ended++;
  }
  return { started, ended };
}

/** Checklist sweep: who does a run that falls inside a cover (the Buddy), else its own doer. */
export async function checklistCovers(db: Db, companyId: string) {
  const rows = await db.cover.findMany({
    where: { companyId, entityType: 'checklist', status: { in: ['SCHEDULED', 'ACTIVE'] } },
    select: { entityId: true, originalUserId: true, buddyUserId: true, from: true, to: true },
  });
  return (masterId: string, doerId: string, at: Date) =>
    rows.find((r) => r.entityId === masterId && r.originalUserId === doerId && r.from <= at && at < r.to)
      ?.buddyUserId ?? null;
}
