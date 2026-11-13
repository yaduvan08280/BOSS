import type { Db, RoomBlock, Tx } from '@mono/db';
import { addDays, roomHkMachine, stayNights, transition, type RoomHkStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit, type ActorContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { createTicket } from '../ticket/service';
import type { Actor } from '../work/actor';
import { desk, dmy, hotelFor, hotelOf, isTaken, lockHotel, newToken, seer, stayOf, supervisor } from './core';

/**
 * Phase 17 — maintenance and guest requests ride on help tickets. A room that is out of order is taken off sale
 * by a block (it can't hold a stay on those days) and a ticket is raised for the fault; when the ticket closes
 * the room comes back, dirty, to be cleaned. A guest's request (towels, an iron, a cab) is a ticket with a short
 * time limit, raised at the desk or by the guest from the QR in the room.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const blockSchema = z.object({
  kind: z.enum(['OUT_OF_ORDER', 'OUT_OF_SERVICE']).default('OUT_OF_ORDER'),
  from: day.optional(),
  /** The last day it is off sale. */
  to: day,
  reason: z.string().trim().min(3).max(200),
  /** Who fixes it; left out, the property's maintenance person. No fixer → no ticket, a plain block. */
  solverId: z.string().min(1).nullish(),
});
const blockView = (b: RoomBlock, room: string, ticket?: { number: number; status: string } | null) => ({
  id: b.id,
  roomId: b.roomId,
  room,
  kind: b.kind,
  from: b.fromDay,
  to: b.toDay,
  reason: b.reason,
  ticketId: b.ticketId,
  ticket: ticket ?? null,
  released: Boolean(b.releasedAt),
});

export async function blockRoom(db: Db, actor: Actor, roomId: string, input: z.input<typeof blockSchema>) {
  supervisor(actor);
  const p = blockSchema.parse(input);
  const room = await db.room.findFirst({
    where: { id: roomId, companyId: actor.companyId, deletedAt: null },
  });
  if (!room) throw notFound('Room');
  const hotel = await hotelOf(db, actor, room.branchId);
  const from = p.from && p.from > hotel.businessDate ? p.from : hotel.businessDate;
  if (p.to < from) throw new AppError(400, 'VALIDATION_FAILED', 'The last day is before the first');
  const days = stayNights(from, addDays(p.to, 1));
  const hk = transition(roomHkMachine, {
    from: room.hkStatus as RoomHkStatus,
    action: 'block',
    roles: ['supervisor'],
    ctx: { service: p.kind === 'OUT_OF_SERVICE' },
  }).to;
  const solverId = p.solverId ?? hotel.rules.maintenanceSolverId ?? null;
  // The fault is a help ticket, so it is chased like any other; nobody fixes their own ticket.
  const ticket =
    solverId && solverId !== actor.userId
      ? await createTicket(
          db,
          { ...actor, permissions: [...actor.permissions, 'ticket.create'] },
          {
            title: `Room ${room.number}: ${p.reason}`,
            description: `${hotel.name} — room ${room.number} is ${p.kind === 'OUT_OF_ORDER' ? 'out of order' : 'out of service'} from ${dmy(from)} to ${dmy(p.to)}.`,
            solverId,
            plannedFixAt: new Date(Date.now() + days.length * 86_400_000).toISOString(),
            attachmentIds: [],
          },
        )
      : null;
  try {
    return await db.$transaction(async (tx) => {
      await lockHotel(tx, hotel.branchId);
      const block = await tx.roomBlock.create({
        data: {
          companyId: actor.companyId,
          branchId: room.branchId,
          roomId,
          kind: p.kind,
          fromDay: from,
          toDay: p.to,
          reason: p.reason,
          ticketId: ticket?.id ?? null,
          createdById: actor.userId,
        },
      });
      // One row a day: a stay already in the room on any of those days refuses the block.
      await tx.roomNight.createMany({
        data: days.map((d) => ({
          companyId: actor.companyId,
          branchId: room.branchId,
          roomTypeId: room.typeId,
          roomId,
          day: d,
          blockId: block.id,
        })),
      });
      await tx.room.update({ where: { id: roomId }, data: { hkStatus: hk } });
      await writeAudit(tx, ctxOf(actor), {
        action: 'hotel.room_blocked',
        entityType: 'room',
        entityId: roomId,
        after: { kind: p.kind, from, to: p.to, reason: p.reason, ticket: ticket?.number ?? null },
      });
      return blockView(block, room.number, ticket ? { number: ticket.number, status: ticket.status } : null);
    });
  } catch (e) {
    if (isTaken(e)) {
      // The ticket was raised a moment ago for a block that can't be: it is cancelled again.
      if (ticket) await db.ticket.update({ where: { id: ticket.id }, data: { status: 'CANCELLED' } });
      throw new AppError(
        409,
        'CONFLICT',
        `Room ${room.number} has a booking on one of those days — move it first`,
      );
    }
    throw e;
  }
}

/** The room is back: the days from today on are on sale again, and it must be cleaned first. */
export async function releaseIn(tx: Tx, ctx: ActorContext, block: RoomBlock, today: string) {
  await tx.roomNight.deleteMany({ where: { blockId: block.id, day: { gte: today } } });
  await tx.roomBlock.update({ where: { id: block.id }, data: { releasedAt: new Date() } });
  const room = await tx.room.findUniqueOrThrow({ where: { id: block.roomId } });
  const others = await tx.roomBlock.count({
    where: { roomId: block.roomId, releasedAt: null, fromDay: { lte: today }, toDay: { gte: today } },
  });
  if (!others && ['OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.hkStatus))
    await tx.room.update({
      where: { id: room.id },
      data: {
        hkStatus: transition(roomHkMachine, {
          from: room.hkStatus as RoomHkStatus,
          action: 'release',
          roles: ['system'],
          ctx: { service: false },
        }).to,
      },
    });
  await writeAudit(tx, ctx, {
    action: 'hotel.room_released',
    entityType: 'room',
    entityId: block.roomId,
    after: { blockId: block.id },
  });
}

/** Release a block by hand. One with a ticket comes back when the ticket closes — not before. */
export async function releaseBlockedRoom(db: Db, actor: Actor, blockId: string) {
  supervisor(actor);
  const block = await db.roomBlock.findFirst({ where: { id: blockId, companyId: actor.companyId } });
  if (!block) throw notFound('Block');
  const hotel = await hotelOf(db, actor, block.branchId);
  if (block.releasedAt) throw new AppError(409, 'CONFLICT', 'This room is already back');
  if (block.ticketId) {
    const t = await db.ticket.findUnique({ where: { id: block.ticketId } });
    if (t && !['CLOSED', 'CANCELLED'].includes(t.status))
      throw new AppError(
        409,
        'CONFLICT',
        `Ticket #${t.number} is still open — the room comes back when it closes`,
      );
  }
  await db.$transaction((tx) => releaseIn(tx, ctxOf(actor), block, hotel.businessDate));
  return { released: true };
}

export async function roomBlocks(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  await hotelOf(db, actor, branchId);
  const blocks = await db.roomBlock.findMany({
    where: { companyId: actor.companyId, branchId, releasedAt: null },
    orderBy: { fromDay: 'asc' },
  });
  const [rooms, tickets] = await Promise.all([
    db.room.findMany({ where: { companyId: actor.companyId, branchId } }),
    db.ticket.findMany({
      where: { id: { in: blocks.map((b) => b.ticketId).filter((x): x is string => Boolean(x)) } },
      select: { id: true, number: true, status: true },
    }),
  ]);
  return blocks.map((b) =>
    blockView(
      b,
      rooms.find((r) => r.id === b.roomId)?.number ?? '',
      tickets.find((t) => t.id === b.ticketId),
    ),
  );
}

/** Rooms whose ticket has closed come back by themselves (worker). */
export async function releaseFixedRooms(db: Db, onlyCompanyId?: string) {
  const blocks = await db.roomBlock.findMany({
    where: {
      releasedAt: null,
      ticketId: { not: null },
      ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}),
    },
    take: 200,
  });
  let n = 0;
  for (const b of blocks) {
    const t = await db.ticket.findUnique({ where: { id: b.ticketId! } });
    if (!t || !['CLOSED', 'CANCELLED'].includes(t.status)) continue;
    const hotel = await hotelFor(db, b.companyId, b.branchId);
    await db.$transaction((tx) =>
      releaseIn(tx, { companyId: b.companyId, actorId: null }, b, hotel.businessDate),
    );
    n++;
  }
  return n;
}

export const requestSchema = z.object({ text: z.string().trim().min(3).max(300) });
/** A guest's request is a ticket for the property's request person, due within the rule's minutes. */
async function raise(db: Db, raiser: Actor, branchId: string, room: string, text: string) {
  const hotel = await hotelFor(db, raiser.companyId, branchId);
  const solverId = hotel.rules.requestSolverId;
  if (!solverId)
    throw new AppError(409, 'CONFLICT', 'Choose who handles guest requests in the hotel rules first');
  if (solverId === raiser.userId)
    throw new AppError(409, 'CONFLICT', 'The person who handles requests can’t raise one to themselves');
  const t = await createTicket(
    db,
    { ...raiser, permissions: [...raiser.permissions, 'ticket.create'] },
    {
      title: `Room ${room}: ${text}`.slice(0, 200),
      description: `Guest request — ${hotel.name}, room ${room}.`,
      solverId,
      plannedFixAt: new Date(Date.now() + hotel.rules.requestSlaMin * 60_000).toISOString(),
      attachmentIds: [],
    },
  );
  return { ticketId: t.id, number: t.number, dueAt: t.plannedFixAt };
}
export async function guestRequest(
  db: Db,
  actor: Actor,
  stayId: string,
  input: z.input<typeof requestSchema>,
) {
  desk(actor);
  const { text } = requestSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (stay.status !== 'CHECKED_IN') throw new AppError(409, 'CONFLICT', 'The guest is not in the hotel');
  const night = await db.roomNight.findFirst({
    where: { stayId, day: { lte: hotel.businessDate } },
    orderBy: { day: 'desc' },
  });
  const room = night?.roomId ? await db.room.findUnique({ where: { id: night.roomId } }) : null;
  return raise(db, actor, stay.branchId, room?.number ?? '?', text);
}

/** The room's own link (the QR on the desk): made once, by a supervisor. */
export async function roomLink(db: Db, actor: Actor, roomId: string) {
  supervisor(actor);
  const room = await db.room.findFirst({
    where: { id: roomId, companyId: actor.companyId, deletedAt: null },
  });
  if (!room) throw notFound('Room');
  await hotelOf(db, actor, room.branchId);
  const token = room.token ?? newToken();
  if (!room.token) await db.room.update({ where: { id: roomId }, data: { token } });
  return { token, path: `/room/${token}` };
}

/**
 * A request from the QR in the room: no sign-in. It is raised in the name of whoever checked the guest in (so a
 * person at the desk confirms it was done), and only while someone is checked in to that room.
 */
export async function publicRequest(db: Db, token: string, text: string) {
  const room = await db.room.findFirst({ where: { token, deletedAt: null } });
  if (!room) throw new AppError(404, 'NOT_FOUND', 'This link is not in use');
  const hotel = await hotelFor(db, room.companyId, room.branchId);
  const stays = await db.stay.findMany({
    where: { companyId: room.companyId, branchId: room.branchId, status: 'CHECKED_IN' },
  });
  for (const s of stays) {
    const night = await db.roomNight.findFirst({
      where: { stayId: s.id, day: { lte: hotel.businessDate } },
      orderBy: { day: 'desc' },
    });
    if (night?.roomId !== room.id) continue;
    const audit = await db.auditLog.findFirst({
      where: { companyId: room.companyId, entityId: s.id, action: 'hotel.checked_in' },
      orderBy: { createdAt: 'desc' },
    });
    const raiserId = audit?.actorId ?? s.createdById;
    if (!raiserId) break;
    const out = await raise(
      db,
      { companyId: room.companyId, userId: raiserId, permissions: [] },
      room.branchId,
      room.number,
      text,
    );
    return { ok: true, number: out.number, minutes: hotel.rules.requestSlaMin };
  }
  throw new AppError(409, 'CONFLICT', 'Requests can be sent from this room once a guest has checked in');
}
export async function publicRoom(db: Db, token: string) {
  const room = await db.room.findFirst({ where: { token, deletedAt: null } });
  if (!room) throw new AppError(404, 'NOT_FOUND', 'This link is not in use');
  const hotel = await hotelFor(db, room.companyId, room.branchId);
  return { hotel: hotel.name, room: room.number, minutes: hotel.rules.requestSlaMin };
}
