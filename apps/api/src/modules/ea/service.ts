import type { Db, EaItem, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  availableActions,
  EA_STAGES,
  eaMachine,
  transition,
  type EaActionInput,
  type EaContext,
  type EaRole,
  type EaSettings,
  type EaStage,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { createTask } from '../delegation/service';
import { can, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** People whose board this is: the company's owners. */
export async function boardOwners(db: Db | Tx, companyId: string) {
  return db.user.findMany({
    where: { companyId, deletedAt: null, status: 'ACTIVE', role: { key: 'OWNER' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
}

/** The EA is the person set in the flow designer; anyone with "EA edit" rights can stand in. */
export function eaRoles(actor: Actor, ownerId: string, s: EaSettings): EaRole[] {
  const roles: EaRole[] = [];
  if (ownerId === actor.userId) roles.push('owner');
  if (s.eaUserId === actor.userId || can(actor, 'ea.edit')) roles.push('ea');
  if (can(actor, 'ea.admin')) roles.push('admin');
  return roles;
}

export async function eaContext(
  db: Db | Tx,
  item: Pick<EaItem, 'companyId' | 'ownerId' | 'stage'>,
  s: EaSettings,
) {
  const waiting = await db.eaItem.count({
    where: { companyId: item.companyId, ownerId: item.ownerId, stage: 'WAITING', deletedAt: null },
  });
  return {
    informationStage: s.informationStage,
    waitingStage: s.waitingStage,
    waitingRoom: item.stage === 'WAITING' || waiting < s.waitingCap,
    missedDayToSomeday: s.missedDayToSomeday,
  } satisfies EaContext;
}

/** Which board a person works on: their own if they have one, else the first owner's (the EA's default). */
async function resolveOwner(db: Db | Tx, actor: Actor, wanted?: string) {
  const owners = await boardOwners(db, actor.companyId);
  const ownerId = wanted ?? (owners.some((o) => o.id === actor.userId) ? actor.userId : owners[0]?.id);
  if (!ownerId || !owners.some((o) => o.id === ownerId))
    throw new AppError(400, 'VALIDATION_FAILED', 'No such board');
  return { ownerId, owners };
}

/** Quick capture: one line, no category (web, or Telegram /capture). */
export async function captureEa(
  db: Db,
  actor: Actor,
  input: { text: string; ownerId?: string; source?: string },
) {
  return db.$transaction(async (tx) => {
    const s = await moduleSettings(tx, actor.companyId, 'ea');
    const { ownerId } = await resolveOwner(tx, actor, input.ownerId);
    if (!eaRoles(actor, ownerId, s).length)
      throw new AppError(403, 'FORBIDDEN', "You can't add to this board");
    const item = await tx.eaItem.create({
      data: {
        companyId: actor.companyId,
        number: await nextCounter(tx, actor.companyId, 'ea'),
        ownerId,
        createdById: actor.userId,
        text: input.text.trim(),
        stage: 'CAPTURED',
        source: input.source ?? 'web',
      },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'ea.captured', entityType: 'ea_item', entityId: item.id, after: item },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'ea.captured',
        entityType: 'ea_item',
        entityId: item.id,
        payload: {
          ownerId,
          eaId: s.eaUserId,
          number: item.number,
          text: item.text,
          link: `/ea?item=${item.id}`,
        },
      },
    );
    return item;
  });
}

/** Move an item through the board; every move goes through the state machine. */
export async function actOnEa(db: Db, actor: Actor, id: string, input: EaActionInput) {
  return db.$transaction(async (tx) => {
    const item = await tx.eaItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
    if (!item) throw notFound('Item');
    const s = await moduleSettings(tx, actor.companyId, 'ea');
    const roles = eaRoles(actor, item.ownerId, s);
    if (!roles.length) throw notFound('Item');
    const step = transition(eaMachine, {
      from: item.stage as EaStage,
      action: input.action,
      roles,
      ctx: await eaContext(tx, item, s),
    });
    const now = new Date();
    const data: Record<string, unknown> = { stage: step.to, stageChangedAt: now };
    // Leaving the calendar clears the slot; leaving "waiting" clears who it waits on.
    if (step.to !== 'SCHEDULED')
      Object.assign(data, { scheduledDate: null, slotStart: null, slotMinutes: null });
    if (step.to !== 'WAITING') data.waitingOn = null;

    switch (input.action) {
      case 'schedule': {
        const start = toMinutes(input.start);
        if (start < toMinutes(s.dayStart) || start + input.minutes > toMinutes(s.dayEnd))
          throw new AppError(400, 'VALIDATION_FAILED', `Pick a time between ${s.dayStart} and ${s.dayEnd}`);
        Object.assign(data, {
          scheduledDate: input.date,
          slotStart: start,
          slotMinutes: input.minutes,
          kind: input.kind,
        });
        break;
      }
      case 'toWaiting':
        data.waitingOn = input.waitingOn ?? null;
        break;
      case 'delegate': {
        const task = await createTask(tx, actor, {
          doerId: input.doerId,
          plannedAt: input.plannedAt,
          description: input.description ?? item.text,
          verifierId: null,
          requireProof: false,
          source: 'ea',
          sourceId: item.id,
        });
        data.taskId = task.id;
        break;
      }
      case 'done':
        data.doneAt = now;
        break;
      case 'reopen':
        data.doneAt = null;
        break;
    }
    const updated = await tx.eaItem.update({ where: { id: item.id }, data });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: `ea.${input.action}`,
        entityType: 'ea_item',
        entityId: item.id,
        before: item,
        after: updated,
      },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { name: 'ea.changed', entityType: 'ea_item', entityId: item.id, payload: { stage: step.to } },
    );
    return updated;
  });
}

export async function editEa(
  db: Db,
  actor: Actor,
  id: string,
  input: { text?: string; note?: string | null },
) {
  return db.$transaction(async (tx) => {
    const item = await tx.eaItem.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
    const s = await moduleSettings(tx, actor.companyId, 'ea');
    if (!item || !eaRoles(actor, item.ownerId, s).length) throw notFound('Item');
    const updated = await tx.eaItem.update({ where: { id }, data: input });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'ea.edited', entityType: 'ea_item', entityId: id, before: item, after: updated },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      { name: 'ea.changed', entityType: 'ea_item', entityId: id },
    );
    return updated;
  });
}

/** The board: live items, plus done/closed ones from the last week, with what each card may do now. */
export async function eaBoard(db: Db, actor: Actor, wantedOwner?: string) {
  const s = await moduleSettings(db, actor.companyId, 'ea');
  const { ownerId, owners } = await resolveOwner(db, actor, wantedOwner);
  const roles = eaRoles(actor, ownerId, s);
  if (!roles.length) throw new AppError(403, 'FORBIDDEN', 'This board is not yours');
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const items = await db.eaItem.findMany({
    where: {
      companyId: actor.companyId,
      ownerId,
      deletedAt: null,
      OR: [{ stage: { notIn: ['DONE', 'CLOSED'] } }, { stageChangedAt: { gte: weekAgo } }],
    },
    orderBy: [{ scheduledDate: 'asc' }, { slotStart: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const waiting = items.filter((i) => i.stage === 'WAITING').length;
  const taskIds = items.map((i) => i.taskId).filter((x): x is string => Boolean(x));
  const tasks = taskIds.length
    ? await db.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, number: true, status: true },
      })
    : [];
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  return {
    ownerId,
    owners,
    settings: s,
    counts: Object.fromEntries(EA_STAGES.map((st) => [st, items.filter((i) => i.stage === st).length])),
    items: items.map((i) => ({
      ...i,
      task: i.taskId ? (byTask.get(i.taskId) ?? null) : null,
      actions: availableActions(eaMachine, i.stage as EaStage, roles, {
        informationStage: s.informationStage,
        waitingStage: s.waitingStage,
        waitingRoom: i.stage === 'WAITING' || waiting < s.waitingCap,
        missedDayToSomeday: s.missedDayToSomeday,
      }),
    })),
  };
}
