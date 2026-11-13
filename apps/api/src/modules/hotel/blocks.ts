import type { Db, GroupBlock } from '@mono/db';
import { groupBlockSchema, stayNights } from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { desk, dmy, hotelOf, lockHotel, seer } from './core';
import { inventory } from './rates';

/**
 * Phase 17 — group blocks: rooms of some types held for a group between two days, at one plan. Bookings are made
 * from the block (a pick-up); on the release date whatever was not taken goes back on sale.
 */
type Held = { roomTypeId: string; count: number };
async function view(db: Db, b: GroupBlock) {
  const picked = await db.stay.groupBy({
    by: ['roomTypeId'],
    where: { blockId: b.id, status: { in: ['BOOKED', 'CHECKED_IN', 'CHECKED_OUT'] } },
    _count: { _all: true },
  });
  return {
    id: b.id,
    branchId: b.branchId,
    name: b.name,
    ratePlanId: b.ratePlanId,
    partyId: b.partyId,
    arrive: b.arrive,
    depart: b.depart,
    releaseOn: b.releaseOn,
    status: b.status,
    note: b.note,
    rooms: (b.rooms as Held[]).map((r) => ({
      ...r,
      pickedUp: picked.find((p) => p.roomTypeId === r.roomTypeId)?._count._all ?? 0,
    })),
  };
}

export async function listBlocks(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  await hotelOf(db, actor, branchId);
  const rows = await db.groupBlock.findMany({
    where: { companyId: actor.companyId, branchId },
    orderBy: { arrive: 'asc' },
    take: 200,
  });
  const out = [];
  for (const r of rows) out.push(await view(db, r));
  return out;
}

export async function createBlock(db: Db, actor: Actor, input: z.input<typeof groupBlockSchema>) {
  desk(actor);
  const b = groupBlockSchema.parse(input);
  const hotel = await hotelOf(db, actor, b.branchId);
  if (b.depart <= b.arrive)
    throw new AppError(400, 'VALIDATION_FAILED', 'The departure is after the arrival');
  if (b.releaseOn > b.arrive)
    throw new AppError(400, 'VALIDATION_FAILED', 'Rooms are released on or before the arrival day');
  const plan = await db.ratePlan.findFirst({
    where: { id: b.ratePlanId, companyId: actor.companyId, branchId: b.branchId, deletedAt: null },
  });
  if (!plan) throw notFound('Rate plan');
  const row = await db.$transaction(async (tx) => {
    await lockHotel(tx, hotel.branchId);
    const inv = await inventory(tx, hotel, b.arrive, b.depart);
    for (const want of b.rooms) {
      const short = inv.find((i) => i.roomTypeId === want.roomTypeId && i.left < want.count);
      if (short || !inv.some((i) => i.roomTypeId === want.roomTypeId))
        throw new AppError(
          409,
          'CONFLICT',
          short
            ? `Only ${Math.max(0, short.left)} rooms of that type are left on ${dmy(short.day)}`
            : 'Unknown room type',
        );
    }
    const made = await tx.groupBlock.create({
      data: {
        companyId: actor.companyId,
        branchId: b.branchId,
        name: b.name,
        ratePlanId: b.ratePlanId,
        partyId: b.partyId ?? plan.partyId ?? null,
        arrive: b.arrive,
        depart: b.depart,
        rooms: b.rooms,
        releaseOn: b.releaseOn,
        note: b.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.block_created',
      entityType: 'group_block',
      entityId: made.id,
      after: {
        name: b.name,
        rooms: b.rooms,
        nights: stayNights(b.arrive, b.depart).length,
        releaseOn: b.releaseOn,
      },
    });
    return made;
  });
  return view(db, row);
}

/** Give back what the block still holds (by a person, or by the clock on the release date). */
export async function releaseBlock(db: Db, companyId: string, id: string, actorId: string | null) {
  const b = await db.groupBlock.findFirst({ where: { id, companyId } });
  if (!b) throw notFound('Group block');
  if (b.status !== 'HELD') throw new AppError(409, 'CONFLICT', 'This block is not being held');
  const row = await db.$transaction(async (tx) => {
    const after = await tx.groupBlock.update({ where: { id }, data: { status: 'RELEASED' } });
    await writeAudit(
      tx,
      { companyId, actorId },
      {
        action: 'hotel.block_released',
        entityType: 'group_block',
        entityId: id,
        before: { status: b.status },
      },
    );
    return after;
  });
  return view(db, row);
}
export async function releaseBlockBy(db: Db, actor: Actor, id: string) {
  desk(actor);
  const b = await db.groupBlock.findFirst({ where: { id, companyId: actor.companyId } });
  if (!b) throw notFound('Group block');
  await hotelOf(db, actor, b.branchId);
  return releaseBlock(db, actor.companyId, id, actor.userId);
}
