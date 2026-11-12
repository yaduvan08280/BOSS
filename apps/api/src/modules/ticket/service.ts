import type { Db, Ticket, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  availableActions,
  TICKET_KEEP,
  ticketMachine,
  transition,
  type TicketActionInput,
  type TicketCreateInput,
  type TicketRole,
  type TicketSettings,
  type TicketStatus,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { proofOf } from '../delegation/service';
import { attachUploads, can, checkPerson, teamOf, type Actor } from '../work/actor';
import { moduleSettings } from '../work/settings';
import { homeBranchOf } from '../branches/reach';

const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);
export const ticketLink = (t: { id: string }) => `/help-tickets?ticket=${t.id}`;
export const ticketCtx = (s: TicketSettings) => ({ autoClose: s.closeBy === 'auto24h' });

export function ticketRoles(actor: Actor, t: Ticket): TicketRole[] {
  const roles: TicketRole[] = [];
  if (t.raiserId === actor.userId) roles.push('raiser');
  if (t.solverId === actor.userId) roles.push('solver');
  if (t.coordinatorId === actor.userId) roles.push('coordinator');
  if (can(actor, 'ticket.admin')) roles.push('admin');
  return roles;
}

export const ticketPayload = (t: Ticket) => ({
  raiserId: t.raiserId,
  solverId: t.solverId,
  coordinatorId: t.coordinatorId,
  number: t.number,
  title: short(t.title),
  due: t.plannedFixAt.toISOString(),
  link: ticketLink(t),
});

export async function logTicket(
  tx: Tx,
  t: Ticket,
  actorId: string | null,
  type: string,
  extra: {
    note?: string | null;
    fromStatus?: string;
    toStatus?: string;
    fromDate?: Date;
    toDate?: Date;
  } = {},
) {
  await tx.ticketEvent.create({ data: { companyId: t.companyId, ticketId: t.id, actorId, type, ...extra } });
}

export async function createTicket(db: Db, actor: Actor, input: TicketCreateInput) {
  if (!can(actor, 'ticket.create')) throw new AppError(403, 'FORBIDDEN', "You can't raise tickets");
  if (input.solverId === actor.userId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Pick someone else to fix it');
  return db.$transaction(async (tx) => {
    await checkPerson(tx, actor.companyId, input.solverId, 'The problem solver');
    const s = await moduleSettings(tx, actor.companyId, 'ticket');
    const plannedFixAt = input.plannedFixAt
      ? new Date(input.plannedFixAt)
      : new Date(Date.now() + s.fixHours * 3600_000);
    if (plannedFixAt.getTime() < Date.now() - 60_000)
      throw new AppError(400, 'VALIDATION_FAILED', 'The fix time is in the past');
    const t = await tx.ticket.create({
      data: {
        companyId: actor.companyId,
        branchId: await homeBranchOf(tx, actor.companyId, actor.userId),
        number: await nextCounter(tx, actor.companyId, 'ticket'),
        title: input.title,
        description: input.description,
        raiserId: actor.userId,
        solverId: input.solverId,
        coordinatorId: s.coordinatorUserId,
        departmentId: input.departmentId ?? null,
        status: 'OPEN',
        plannedFixAt,
      },
    });
    await attachUploads(tx, actor.companyId, actor.userId, input.attachmentIds, 'ticket', t.id);
    await logTicket(tx, t, actor.userId, 'created', { toStatus: 'OPEN' });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'ticket.created', entityType: 'ticket', entityId: t.id, after: t },
    );
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'ticket.raised',
        entityType: 'ticket',
        entityId: t.id,
        payload: { ...ticketPayload(t), files: await proofOf(tx, t.companyId, 'ticket', t.id, actor.userId) },
      },
    );
    return t;
  });
}

async function visible(db: Db | Tx, actor: Actor, t: Ticket) {
  if (ticketRoles(actor, t).length) return true;
  return (await teamOf(db, actor.companyId, actor.userId)).some(
    (id) => id === t.raiserId || id === t.solverId,
  );
}

/** Every change of a ticket goes through the state machine, with history, audit and an event. */
export async function actOnTicket(db: Db, actor: Actor, ticketId: string, input: TicketActionInput) {
  return db.$transaction(async (tx) => {
    const t = await tx.ticket.findFirst({
      where: { id: ticketId, companyId: actor.companyId, deletedAt: null },
    });
    if (!t || !(await visible(tx, actor, t))) throw notFound('Ticket');
    const s = await moduleSettings(tx, actor.companyId, 'ticket');
    const step = transition(ticketMachine, {
      from: t.status as TicketStatus,
      action: input.action,
      roles: ticketRoles(actor, t),
      ctx: ticketCtx(s),
    });
    const to = TICKET_KEEP.includes(input.action) ? (t.status as TicketStatus) : step.to;
    const now = new Date();
    const data: Record<string, unknown> = { status: to };
    const payload: Record<string, unknown> = ticketPayload(t);
    const files = 'attachmentIds' in input ? input.attachmentIds : [];
    let event: string | null = null;

    switch (input.action) {
      case 'reply':
        data.firstReplyAt = t.firstReplyAt ?? now;
        await logTicket(tx, t, actor.userId, 'reply', { note: input.text });
        payload.reply = short(input.text);
        event = 'ticket.replied';
        break;
      case 'resolve': {
        const linked = await attachUploads(tx, actor.companyId, actor.userId, files, 'ticket', t.id);
        if (s.proofToResolve && !linked)
          throw new AppError(400, 'VALIDATION_FAILED', 'Attach a photo or file that shows it is fixed');
        Object.assign(data, { resolvedAt: now, firstReplyAt: t.firstReplyAt ?? now });
        await logTicket(tx, t, actor.userId, 'reply', { note: input.note });
        payload.proof = await proofOf(tx, t.companyId, 'ticket', t.id, t.solverId);
        event = 'ticket.resolved';
        break;
      }
      case 'confirm':
        Object.assign(data, { closedAt: now, closedBy: 'raiser' });
        event = 'ticket.closed';
        break;
      case 'reopen':
        Object.assign(data, { resolvedAt: null, reopenCount: t.reopenCount + 1 });
        await logTicket(tx, t, actor.userId, 'comment', { note: input.comment });
        payload.comment = input.comment;
        event = 'ticket.reopened';
        break;
      case 'comment':
        await logTicket(tx, t, actor.userId, 'comment', { note: input.text });
        event = 'ticket.commented';
        break;
      case 'movePlan': {
        const next = new Date(input.plannedFixAt);
        // A new plan starts the "late" clock again; a missing first reply still escalates.
        Object.assign(data, { plannedFixAt: next, escalationLevel: 0 });
        await logTicket(tx, t, actor.userId, 'plan_moved', {
          note: input.reason,
          fromDate: t.plannedFixAt,
          toDate: next,
        });
        payload.due = next.toISOString();
        event = 'ticket.plan_moved';
        break;
      }
      case 'reassign':
        await checkPerson(tx, actor.companyId, input.solverId, 'The problem solver');
        Object.assign(data, {
          solverId: input.solverId,
          firstReplyAt: null,
          escalationLevel: 0,
          status: 'OPEN',
        });
        if (input.plannedFixAt) data.plannedFixAt = new Date(input.plannedFixAt);
        await logTicket(tx, t, actor.userId, 'reassigned');
        Object.assign(payload, { solverId: input.solverId, due: input.plannedFixAt ?? payload.due });
        event = 'ticket.raised';
        break;
      case 'cancel':
        data.closedAt = now;
        if (input.reason) await logTicket(tx, t, actor.userId, 'comment', { note: input.reason });
        event = 'ticket.cancelled';
        break;
    }
    if (files.length && input.action !== 'resolve')
      await attachUploads(tx, actor.companyId, actor.userId, files, 'ticket', t.id);

    const updated = await tx.ticket.update({ where: { id: t.id }, data });
    if (updated.status !== t.status)
      await logTicket(tx, t, actor.userId, 'status', { fromStatus: t.status, toStatus: updated.status });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: `ticket.${input.action}`, entityType: 'ticket', entityId: t.id, before: t, after: updated },
    );
    if (event)
      await emitEvent(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        { name: event, entityType: 'ticket', entityId: t.id, payload },
      );
    return updated;
  });
}

export async function ticketDetail(db: Db, actor: Actor, id: string) {
  const t = await db.ticket.findFirst({
    where: { id, companyId: actor.companyId, deletedAt: null },
    include: { events: { orderBy: { createdAt: 'asc' } } },
  });
  if (!t || !(await visible(db, actor, t))) throw notFound('Ticket');
  const s = await moduleSettings(db, actor.companyId, 'ticket');
  const files = await db.attachment.findMany({
    where: { companyId: actor.companyId, entityType: 'ticket', entityId: t.id, deletedAt: null },
    select: { id: true, originalName: true, mime: true, size: true, uploadedById: true, createdAt: true },
  });
  return {
    ...t,
    files: files.map((f) => ({ ...f, url: `/api/files/${f.id}` })),
    proofToResolve: s.proofToResolve,
    replyDueAt: t.firstReplyAt ? null : new Date(t.createdAt.getTime() + s.firstReplyHours * 3600_000),
    actions: availableActions(
      ticketMachine,
      t.status as TicketStatus,
      ticketRoles(actor, t),
      ticketCtx(s),
    ).filter((a) => a !== 'autoClose'),
  };
}
