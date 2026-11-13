import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { applyMove } from '../ims/moves';
import type { Actor } from '../work/actor';
import { desk, hotelOf, seer } from './core';
import { postCharge } from './folio-core';
import { occupants } from './housekeeping';

/** Phase 17 — the minibar check (what was taken goes on the folio and off the stock) and the lost & found register. */
export const minibarSchema = z.object({
  items: z
    .array(z.object({ itemId: z.string().min(1), qty: z.number().positive().max(99) }))
    .min(1)
    .max(40),
});
/** What the guest took from the minibar: charged to the room's folio and taken off the stock. */
export async function minibarCheck(
  db: Db,
  actor: Actor,
  roomId: string,
  input: z.input<typeof minibarSchema>,
) {
  desk(actor);
  const p = minibarSchema.parse(input);
  const room = await db.room.findFirst({
    where: { id: roomId, companyId: actor.companyId, deletedAt: null },
  });
  if (!room) throw notFound('Room');
  const hotel = await hotelOf(db, actor, room.branchId);
  const stay = (await occupants(db, hotel)).get(roomId);
  if (!stay) throw new AppError(409, 'CONFLICT', `Nobody is checked in to room ${room.number}`);
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const lines = [];
    for (const x of p.items) {
      const listed = hotel.rules.minibar.find((m) => m.itemId === x.itemId);
      if (!listed) throw new AppError(400, 'VALIDATION_FAILED', 'That is not in this property’s minibar');
      const line = await postCharge(tx, ctx, hotel, stay, {
        kind: 'MINIBAR',
        text: `Minibar — ${listed.name}`,
        qty: x.qty,
        amount: Math.round(listed.price * x.qty),
        taxCode: listed.taxCode ?? null,
        refType: 'minibar',
        refId: room.id,
      });
      const held = await tx.stockBalance.aggregate({
        where: { itemId: x.itemId, locationId: hotel.rules.hkLocationId, qty: { gt: 0 } },
        _sum: { qty: true },
      });
      // The stock to refill it with comes from the housekeeping store (noted when it is short).
      if (Number(held._sum.qty ?? 0) >= x.qty)
        await applyMove(tx, ctx, {
          itemId: x.itemId,
          type: 'OUT',
          delta: -x.qty,
          reason: 'MINIBAR',
          locationId: hotel.rules.hkLocationId,
          refType: 'minibar',
          refId: line.id,
          note: `Room ${room.number}`,
        });
      lines.push({ id: line.id, text: line.text, amount: Number(line.amount) });
    }
    const task = await tx.hkTask.findUnique({
      where: { roomId_day_kind: { roomId, day: hotel.businessDate, kind: 'CLEAN' } },
    });
    if (task)
      await tx.hkTask.update({
        where: { id: task.id },
        data: {
          minibar: p.items.map((x) => ({
            ...x,
            name: hotel.rules.minibar.find((m) => m.itemId === x.itemId)?.name ?? '',
          })),
        },
      });
    await writeAudit(tx, ctx, {
      action: 'hotel.minibar_checked',
      entityType: 'stay',
      entityId: stay.id,
      after: { room: room.number, items: p.items },
    });
    return { stayId: stay.id, lines };
  });
}

export const lostSchema = z.object({
  branchId: z.string().min(1),
  roomId: z.string().min(1).nullish(),
  item: z.string().trim().min(1).max(200),
  note: z.string().trim().max(300).nullish(),
});
export const lostCloseSchema = z.object({
  status: z.enum(['RETURNED', 'DISPOSED']),
  returnedTo: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export async function lostFound(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  await hotelOf(db, actor, branchId);
  const rows = await db.lostFound.findMany({
    where: { companyId: actor.companyId, branchId },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const rooms = await db.room.findMany({ where: { companyId: actor.companyId, branchId } });
  return rows.map((r) => ({
    id: r.id,
    item: r.item,
    room: rooms.find((x) => x.id === r.roomId)?.number ?? null,
    foundOn: r.foundOn,
    status: r.status,
    returnedTo: r.returnedTo,
    note: r.note,
  }));
}
export async function logFound(db: Db, actor: Actor, input: z.input<typeof lostSchema>) {
  desk(actor);
  const p = lostSchema.parse(input);
  const hotel = await hotelOf(db, actor, p.branchId);
  return db.$transaction(async (tx) => {
    const row = await tx.lostFound.create({
      data: {
        companyId: actor.companyId,
        branchId: p.branchId,
        roomId: p.roomId ?? null,
        item: p.item,
        note: p.note ?? null,
        foundOn: hotel.businessDate,
        foundById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.found',
      entityType: 'lost_found',
      entityId: row.id,
      after: { item: p.item },
    });
    return { id: row.id };
  });
}
export async function closeFound(db: Db, actor: Actor, id: string, input: z.input<typeof lostCloseSchema>) {
  desk(actor);
  const p = lostCloseSchema.parse(input);
  const row = await db.lostFound.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw notFound('Item');
  await hotelOf(db, actor, row.branchId);
  if (row.status !== 'HELD') throw new AppError(409, 'CONFLICT', 'This item is already closed');
  if (p.status === 'RETURNED' && !p.returnedTo)
    throw new AppError(400, 'VALIDATION_FAILED', 'Who was it returned to?');
  await db.$transaction(async (tx) => {
    await tx.lostFound.update({
      where: { id },
      data: {
        status: p.status,
        returnedTo: p.returnedTo ?? null,
        note: p.note ?? row.note,
        closedAt: new Date(),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.found_closed',
      entityType: 'lost_found',
      entityId: id,
      before: { status: row.status },
      after: p,
    });
  });
  return { id, status: p.status };
}
