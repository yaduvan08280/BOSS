import type { Db, Stay, Tx } from '@mono/db';
import { addDays, quoteStay, restriction, roomState, stayNights, type RoomHkStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit, type ActorContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { stayRows } from './bookings';
import { desk, dmy, hotelOf, isTaken, lockHotel, seer, stayOf, type Hotel } from './core';
import { inventory, planRules } from './rates';

/**
 * Phase 17 — the room calendar (tape chart) and what is done on it: a room for a booking, a move to another
 * room, a stay made longer or shorter. A room holds one stay a night — the database refuses anything else.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const tapeQuery = z.object({
  branchId: z.string().min(1),
  from: day.optional(),
  days: z.coerce.number().int().min(1).max(62).default(14),
});

export async function tapeChart(db: Db, actor: Actor, q: z.infer<typeof tapeQuery>) {
  seer(actor);
  const hotel = await hotelOf(db, actor, q.branchId);
  const from = q.from ?? hotel.businessDate;
  const to = addDays(from, q.days);
  const where = { companyId: actor.companyId, branchId: q.branchId };
  const [rooms, types, nights, blocks] = await Promise.all([
    db.room.findMany({ where: { ...where, deletedAt: null } }),
    db.roomType.findMany({ where: { ...where, deletedAt: null }, orderBy: { name: 'asc' } }),
    db.roomNight.findMany({ where: { ...where, day: { gte: from, lt: to } } }),
    db.roomBlock.findMany({ where: { ...where, releasedAt: null } }),
  ]);
  const stays = await db.stay.findMany({
    where: { id: { in: [...new Set(nights.map((n) => n.stayId).filter((x): x is string => Boolean(x)))] } },
  });
  const rows = await stayRows(db, hotel, stays);
  const inHouse = new Set(
    nights
      .filter(
        (n) => n.day === hotel.businessDate && stays.find((s) => s.id === n.stayId)?.status === 'CHECKED_IN',
      )
      .map((n) => n.roomId),
  );
  return {
    businessDate: hotel.businessDate,
    from,
    days: stayNights(from, to),
    types: types.map((t) => ({ id: t.id, name: t.name, code: t.code })),
    rooms: rooms
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
      .map((r) => ({
        id: r.id,
        number: r.number,
        floor: r.floor,
        typeId: r.typeId,
        state: roomState(r.hkStatus as RoomHkStatus, inHouse.has(r.id)),
        // One cell a day: a stay's night, a block, or nothing.
        cells: nights
          .filter((n) => n.roomId === r.id)
          .map((n) => ({
            day: n.day,
            stayId: n.stayId,
            block: n.blockId ? (blocks.find((b) => b.id === n.blockId)?.reason ?? 'Out of order') : null,
          })),
      })),
    stays: rows,
    // Booked, but no room chosen yet: shown above the chart to be dropped on a room.
    unassigned: rows.filter((s) => nights.some((n) => n.stayId === s.id && !n.roomId)).map((s) => s.id),
  };
}

export const assignSchema = z.object({
  roomId: z.string().min(1),
  /** Move from this night on (a room move during the stay); left out, every night not yet slept. */
  from: day.optional(),
  reason: z.string().trim().max(200).nullish(),
  /** A room of another type: charge the new type's rate from then on (an upgrade is free unless this is set). */
  rerate: z.boolean().default(false),
});
/**
 * Put a stay in a room: before arrival for all its nights; during the stay from tonight on (a room move — the
 * nights already slept stay where they were). Refused when the room is taken on any of those nights.
 */
export async function assignRoom(db: Db, actor: Actor, stayId: string, input: z.input<typeof assignSchema>) {
  desk(actor);
  const p = assignSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (!['BOOKED', 'CHECKED_IN'].includes(stay.status))
    throw new AppError(409, 'CONFLICT', 'This booking is closed');
  const room = await db.room.findFirst({
    where: { id: p.roomId, companyId: actor.companyId, branchId: stay.branchId, deletedAt: null },
  });
  if (!room) throw notFound('Room');
  const from =
    stay.status === 'CHECKED_IN'
      ? p.from && p.from > hotel.businessDate
        ? p.from
        : hotel.businessDate
      : (p.from ?? stay.arrive);
  const moving = stay.status === 'CHECKED_IN';
  try {
    return await db.$transaction(async (tx) => {
      await lockHotel(tx, hotel.branchId);
      const nights = await tx.roomNight.findMany({
        where: { stayId, day: { gte: from } },
        orderBy: { day: 'asc' },
      });
      if (!nights.length)
        throw new AppError(400, 'VALIDATION_FAILED', 'No night of this stay is left to move');
      const old = nights[0]!.roomId;
      if (old === room.id)
        throw new AppError(400, 'VALIDATION_FAILED', `It is already in room ${room.number}`);
      if (moving && !['CLEAN', 'INSPECTED'].includes(room.hkStatus))
        throw new AppError(409, 'CONFLICT', `Room ${room.number} is not ready`);
      let rates: Map<string, number> | null = null;
      if (room.typeId !== stay.roomTypeId && p.rerate) {
        const plan = await tx.ratePlan.findUniqueOrThrow({ where: { id: stay.ratePlanId } });
        const type = await tx.roomType.findUniqueOrThrow({ where: { id: room.typeId } });
        const q = quoteStay(
          planRules(plan),
          room.typeId,
          nights[0]!.day,
          addDays(nights[nights.length - 1]!.day, 1),
          {
            adults: stay.adults,
            children: stay.children,
            occupancy: type.occupancy,
          },
        );
        if (!q) throw new AppError(400, 'VALIDATION_FAILED', `${plan.name} has no rate for ${type.name}`);
        rates = new Map(q.nights.map((n) => [n.day, n.rate]));
      }
      for (const n of nights)
        await tx.roomNight.update({
          where: { id: n.id },
          data: {
            roomId: room.id,
            roomTypeId: room.typeId,
            ...(rates && !n.posted ? { rate: BigInt(rates.get(n.day) ?? Number(n.rate)) } : {}),
          },
        });
      const moves = [
        ...((stay.moves as object[] | null) ?? []),
        ...(moving
          ? [
              {
                at: new Date().toISOString(),
                day: from,
                from: old,
                to: room.id,
                reason: p.reason ?? null,
                byId: actor.userId,
              },
            ]
          : []),
      ];
      await tx.stay.update({
        where: { id: stayId },
        // The type a stay is charged as changes only with a paid upgrade; a free one keeps the booked rate.
        data: { moves, ...(rates ? { roomTypeId: room.typeId } : {}) },
      });
      // The room the guest left must be cleaned before it is sold again.
      if (moving && old) await tx.room.update({ where: { id: old }, data: { hkStatus: 'DIRTY' } });
      await writeAudit(tx, ctxOf(actor), {
        action: moving ? 'hotel.room_moved' : 'hotel.room_assigned',
        entityType: 'stay',
        entityId: stayId,
        before: { roomId: old },
        after: { roomId: room.id, from, reason: p.reason ?? null, rerate: Boolean(rates) },
      });
      return {
        id: stayId,
        roomId: room.id,
        room: room.number,
        from,
        upgraded: room.typeId !== stay.roomTypeId,
      };
    });
  } catch (e) {
    if (isTaken(e))
      throw new AppError(409, 'CONFLICT', `Room ${room.number} is taken on one of those nights`);
    throw e;
  }
}

export const datesSchema = z.object({ arrive: day.optional(), depart: day.optional() });
/**
 * Make a stay longer or shorter. New nights are priced by the plan and need a free room of the type (the same
 * room when the stay has one); nights given up go back on sale. Nights already charged are never touched.
 */
export async function changeDates(db: Db, actor: Actor, stayId: string, input: z.input<typeof datesSchema>) {
  desk(actor);
  const p = datesSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (!['BOOKED', 'CHECKED_IN'].includes(stay.status))
    throw new AppError(409, 'CONFLICT', 'This booking is closed');
  const arrive = p.arrive ?? stay.arrive;
  const depart = p.depart ?? stay.depart;
  if (stay.status === 'CHECKED_IN' && arrive !== stay.arrive)
    throw new AppError(409, 'CONFLICT', 'The guest has already arrived');
  if (depart <= arrive) throw new AppError(400, 'VALIDATION_FAILED', 'The departure is after the arrival');
  if (stay.status === 'CHECKED_IN' && depart < hotel.businessDate)
    throw new AppError(400, 'VALIDATION_FAILED', `The hotel's date is ${dmy(hotel.businessDate)}`);
  try {
    return await db.$transaction(async (tx) => {
      await lockHotel(tx, hotel.branchId);
      return changeDatesIn(tx, ctxOf(actor), hotel, stay, arrive, depart);
    });
  } catch (e) {
    if (isTaken(e))
      throw new AppError(409, 'CONFLICT', 'The room is taken by another booking on those nights');
    throw e;
  }
}

/** The change itself, in the caller's transaction (which holds the property's lock). */
export async function changeDatesIn(
  tx: Tx,
  ctx: ActorContext,
  hotel: Hotel,
  stay: Stay,
  arrive: string,
  depart: string,
) {
  if (depart <= arrive) throw new AppError(400, 'VALIDATION_FAILED', 'The departure is after the arrival');
  const have = await tx.roomNight.findMany({ where: { stayId: stay.id }, orderBy: { day: 'asc' } });
  const want = stayNights(arrive, depart);
  const drop = have.filter((n) => !want.includes(n.day));
  if (drop.some((n) => n.posted))
    throw new AppError(409, 'CONFLICT', 'A night that was already charged cannot be given up');
  const add = want.filter((d) => !have.some((n) => n.day === d));
  await addNights(tx, hotel, stay, add, have[have.length - 1]?.roomId ?? null, want.length);
  await tx.roomNight.deleteMany({ where: { id: { in: drop.map((n) => n.id) } } });
  await tx.stay.update({ where: { id: stay.id }, data: { arrive, depart } });
  await writeAudit(tx, ctx, {
    action: 'hotel.dates_changed',
    entityType: 'stay',
    entityId: stay.id,
    before: { arrive: stay.arrive, depart: stay.depart },
    after: { arrive, depart, added: add.length, dropped: drop.length },
  });
  return { id: stay.id, arrive, depart, added: add.length, dropped: drop.length };
}

/** New nights for a stay: checked against the days' restrictions and what is left, priced by the plan. */
async function addNights(
  tx: Tx,
  hotel: Hotel,
  stay: Stay,
  days: string[],
  roomId: string | null,
  totalNights: number,
) {
  if (!days.length) return;
  const plan = await tx.ratePlan.findUniqueOrThrow({ where: { id: stay.ratePlanId } });
  const type = await tx.roomType.findUniqueOrThrow({ where: { id: stay.roomTypeId } });
  const first = days[0]!;
  const last = addDays(days[days.length - 1]!, 1);
  // The room the guest is in decides which rooms the new nights take (a free upgrade sleeps in a better room
  // at the booked type's rate).
  const inRoom = roomId ? await tx.room.findUnique({ where: { id: roomId } }) : null;
  const sleepsIn = inRoom?.typeId ?? stay.roomTypeId;
  const inv = (
    await inventory(tx, hotel, first, last, {
      exceptStayId: stay.id,
      exceptBlockId: stay.blockId ?? undefined,
    })
  ).filter((i) => i.roomTypeId === sleepsIn && days.includes(i.day));
  const stop = restriction(first, last, new Map(inv.map((i) => [i.day, { stopSell: i.rule.stopSell }])));
  if (stop) throw new AppError(409, 'CONFLICT', 'Those days are closed for sale');
  const full = inv.find((i) => i.left < 1);
  if (full) throw new AppError(409, 'CONFLICT', `No ${type.name} is left on ${dmy(full.day)}`);
  const rules = planRules(plan);
  for (const d of days) {
    const q = quoteStay(rules, type.id, d, addDays(d, 1), {
      adults: stay.adults,
      children: stay.children,
      occupancy: type.occupancy,
    });
    if (!q) throw new AppError(400, 'VALIDATION_FAILED', `${plan.name} has no rate for ${type.name}`);
    // The length-of-stay discount follows the stay's new length for the nights added.
    const tier = [...rules.los].sort((a, b) => b.nights - a.nights).find((t) => totalNights >= t.nights);
    const rate = tier
      ? Math.round((q.nights[0]!.rate * (1 - tier.pctOff / 100)) / 100) * 100
      : q.nights[0]!.rate;
    await tx.roomNight.create({
      data: {
        companyId: stay.companyId,
        branchId: stay.branchId,
        roomTypeId: sleepsIn,
        roomId,
        day: d,
        stayId: stay.id,
        rate: BigInt(rate),
      },
    });
  }
}
