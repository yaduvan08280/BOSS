import type { Db } from '@mono/db';
import { roomSchema, roomTypeSchema, roomsBulkSchema } from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { branchOf, branchWhere, ctxOf, inReach, need } from './access';

/** Phase 14 — room types (occupancy, beds, amenities, the declared tariff) and rooms (number, floor, features, connecting rooms). */
const admin = (a: Actor) => need(a, 'hosp.admin', 'Only hospitality admins change this set-up');

export async function listRooms(db: Db, actor: Actor, branchId?: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const where = {
    companyId: actor.companyId,
    deletedAt: null,
    ...branchWhere(),
    ...(branchId ? { branchId } : {}),
  };
  if (branchId && !inReach(branchId)) throw new AppError(403, 'FORBIDDEN', 'That branch is not one of yours');
  const [types, rooms] = await Promise.all([
    db.roomType.findMany({ where, orderBy: { name: 'asc' } }),
    db.room.findMany({ where, orderBy: { number: 'asc' } }),
  ]);
  return {
    types: types.map((t) => ({
      id: t.id,
      branchId: t.branchId,
      name: t.name,
      code: t.code,
      occupancy: t.occupancy,
      maxOccupancy: t.maxOccupancy,
      beds: t.beds,
      amenities: t.amenities,
      photoIds: t.photoIds,
      tariff: t.tariff === null ? null : Number(t.tariff),
      taxCode: t.taxCode,
      rooms: rooms.filter((r) => r.typeId === t.id).length,
    })),
    rooms: rooms
      .map((r) => ({
        id: r.id,
        branchId: r.branchId,
        typeId: r.typeId,
        number: r.number,
        floor: r.floor,
        features: r.features,
        connectsTo: r.connectsTo,
      }))
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })),
  };
}

export async function saveRoomType(db: Db, actor: Actor, input: z.input<typeof roomTypeSchema>, id?: string) {
  admin(actor);
  const t = roomTypeSchema.parse(input);
  await branchOf(db, actor.companyId, t.branchId);
  if (t.maxOccupancy < t.occupancy)
    throw new AppError(400, 'VALIDATION_FAILED', 'The most guests can’t be fewer than the usual number');
  if (t.taxCode && !(await db.taxRate.count({ where: { companyId: actor.companyId, code: t.taxCode } })))
    throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate with the code ${t.taxCode}`);
  if (
    id &&
    !(await db.roomType.count({
      where: { id, companyId: actor.companyId, branchId: t.branchId, deletedAt: null },
    }))
  )
    throw notFound('Room type');
  const taken = await db.roomType.count({
    where: {
      companyId: actor.companyId,
      branchId: t.branchId,
      deletedAt: null,
      code: { equals: t.code, mode: 'insensitive' },
      ...(id ? { NOT: { id } } : {}),
    },
  });
  if (taken)
    throw new AppError(409, 'CONFLICT', `This branch already has a room type with the code ${t.code}`);
  const data = {
    ...t,
    beds: t.beds ?? null,
    taxCode: t.taxCode ?? null,
    tariff: t.tariff === null || t.tariff === undefined ? null : BigInt(t.tariff),
  };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.roomType.update({ where: { id }, data })
      : await tx.roomType.create({ data: { companyId: actor.companyId, ...data } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.room_type_saved',
      entityType: 'room_type',
      entityId: row.id,
      after: t,
    });
    return { id: row.id };
  });
}
export async function deleteRoomType(db: Db, actor: Actor, id: string) {
  admin(actor);
  const t = await db.roomType.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!t || !inReach(t.branchId)) throw notFound('Room type');
  if (await db.room.count({ where: { typeId: id, deletedAt: null } }))
    throw new AppError(409, 'CONFLICT', `${t.name} still has rooms: move or delete them first`);
  await db.roomType.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}

async function typeOf(db: Db, actor: Actor, typeId: string) {
  const t = await db.roomType.findFirst({
    where: { id: typeId, companyId: actor.companyId, deletedAt: null },
  });
  if (!t || !inReach(t.branchId)) throw notFound('Room type');
  return t;
}
const numbersFree = async (
  db: Db,
  companyId: string,
  branchId: string,
  numbers: string[],
  notId?: string,
) => {
  const taken = await db.room.findMany({
    where: {
      companyId,
      branchId,
      deletedAt: null,
      number: { in: numbers },
      ...(notId ? { NOT: { id: notId } } : {}),
    },
    select: { number: true },
  });
  if (taken.length)
    throw new AppError(409, 'CONFLICT', `Room ${taken[0]!.number} already exists at this branch`);
};

export async function saveRoom(db: Db, actor: Actor, input: z.input<typeof roomSchema>, id?: string) {
  admin(actor);
  const r = roomSchema.parse(input);
  const type = await typeOf(db, actor, r.typeId);
  if (
    id &&
    !(await db.room.count({
      where: { id, companyId: actor.companyId, branchId: type.branchId, deletedAt: null },
    }))
  )
    throw notFound('Room');
  await numbersFree(db, actor.companyId, type.branchId, [r.number], id);
  // A connecting door has two sides: the other rooms must exist, and they get this room's number too.
  const others = r.connectsTo.filter((n) => n !== r.number);
  const linked = await db.room.findMany({
    where: { companyId: actor.companyId, branchId: type.branchId, deletedAt: null, number: { in: others } },
  });
  if (linked.length !== others.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'A connecting room is not a room of this branch');
  const data = {
    typeId: r.typeId,
    number: r.number,
    floor: r.floor ?? null,
    features: r.features,
    connectsTo: others,
    branchId: type.branchId,
  };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.room.update({ where: { id }, data })
      : await tx.room.create({ data: { companyId: actor.companyId, ...data } });
    for (const o of linked)
      if (!o.connectsTo.includes(r.number))
        await tx.room.update({ where: { id: o.id }, data: { connectsTo: [...o.connectsTo, r.number] } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.room_saved',
      entityType: 'room',
      entityId: row.id,
      after: r,
    });
    return { id: row.id };
  });
}

/** Rooms 101 to 110 of one type on one floor, in one go. */
export async function addRooms(db: Db, actor: Actor, input: z.input<typeof roomsBulkSchema>) {
  admin(actor);
  const b = roomsBulkSchema.parse(input);
  if (b.to < b.from || b.to - b.from >= 500)
    throw new AppError(400, 'VALIDATION_FAILED', 'Give a range of up to 500 room numbers, lowest first');
  const type = await typeOf(db, actor, b.typeId);
  const numbers = Array.from({ length: b.to - b.from + 1 }, (_, i) => String(b.from + i));
  await numbersFree(db, actor.companyId, type.branchId, numbers);
  await db.$transaction(async (tx) => {
    await tx.room.createMany({
      data: numbers.map((number) => ({
        companyId: actor.companyId,
        branchId: type.branchId,
        typeId: type.id,
        number,
        floor: b.floor ?? null,
      })),
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.rooms_added',
      entityType: 'room_type',
      entityId: type.id,
      after: b,
    });
  });
  return { added: numbers.length };
}
export async function deleteRoom(db: Db, actor: Actor, id: string) {
  admin(actor);
  const r = await db.room.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!r || !inReach(r.branchId)) throw notFound('Room');
  await db.$transaction(async (tx) => {
    await tx.room.update({ where: { id }, data: { deletedAt: new Date() } });
    for (const o of await tx.room.findMany({
      where: { companyId: actor.companyId, branchId: r.branchId, connectsTo: { has: r.number } },
    }))
      await tx.room.update({
        where: { id: o.id },
        data: { connectsTo: o.connectsTo.filter((n) => n !== r.number) },
      });
  });
  return { ok: true };
}
