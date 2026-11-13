import type { Db } from '@mono/db';
import { gridSpot, tableSchema, tablesBulkSchema } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need, outletOf } from './access';

/** Phase 14 — floors and tables: the plan of an outlet (where each table sits, how many it seats, who serves it). */
const admin = (a: Actor) => need(a, 'hosp.admin', 'Only hospitality admins change this set-up');
export const floorSchema = z.object({
  outletId: z.string().min(1),
  name: z.string().trim().min(1).max(40),
  sort: z.number().int().min(0).max(999).default(0),
});

async function floorOf(db: Db, actor: Actor, floorId: string) {
  const f = await db.floor.findFirst({ where: { id: floorId, companyId: actor.companyId, deletedAt: null } });
  if (!f) throw notFound('Floor');
  await outletOf(db, actor.companyId, f.outletId);
  return f;
}

export async function floorPlan(db: Db, actor: Actor, outletId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  await outletOf(db, actor.companyId, outletId);
  const [floors, tables] = await Promise.all([
    db.floor.findMany({
      where: { companyId: actor.companyId, outletId, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    }),
    db.diningTable.findMany({
      where: { companyId: actor.companyId, outletId, deletedAt: null },
      orderBy: [{ y: 'asc' }, { x: 'asc' }],
    }),
  ]);
  return floors.map((f) => ({
    id: f.id,
    name: f.name,
    tables: tables
      .filter((t) => t.floorId === f.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        seats: t.seats,
        shape: t.shape,
        x: t.x,
        y: t.y,
        section: t.section,
        combinable: t.combinable,
        stewardIds: t.stewardIds,
      })),
  }));
}

export async function saveFloor(db: Db, actor: Actor, input: z.input<typeof floorSchema>, id?: string) {
  admin(actor);
  const f = floorSchema.parse(input);
  await outletOf(db, actor.companyId, f.outletId);
  if (id) await floorOf(db, actor, id);
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.floor.update({ where: { id }, data: { name: f.name, sort: f.sort } })
      : await tx.floor.create({ data: { companyId: actor.companyId, ...f } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.floor_saved',
      entityType: 'floor',
      entityId: row.id,
      after: f,
    });
    return { id: row.id };
  });
}
export async function deleteFloor(db: Db, actor: Actor, id: string) {
  admin(actor);
  await floorOf(db, actor, id);
  await db.$transaction(async (tx) => {
    const at = new Date();
    await tx.floor.update({ where: { id }, data: { deletedAt: at } });
    await tx.diningTable.updateMany({ where: { floorId: id, deletedAt: null }, data: { deletedAt: at } });
    await writeAudit(tx, ctxOf(actor), { action: 'hosp.floor_deleted', entityType: 'floor', entityId: id });
  });
  return { ok: true };
}

const nameFree = async (db: Db, companyId: string, outletId: string, names: string[], notId?: string) => {
  const taken = await db.diningTable.findMany({
    where: {
      companyId,
      outletId,
      deletedAt: null,
      name: { in: names, mode: 'insensitive' },
      ...(notId ? { NOT: { id: notId } } : {}),
    },
    select: { name: true },
  });
  if (taken.length)
    throw new AppError(409, 'CONFLICT', `This outlet already has a table called ${taken[0]!.name}`);
};

export async function saveTable(db: Db, actor: Actor, input: z.input<typeof tableSchema>, id?: string) {
  admin(actor);
  const t = tableSchema.parse(input);
  const floor = await floorOf(db, actor, t.floorId);
  if (
    id &&
    !(await db.diningTable.count({
      where: { id, companyId: actor.companyId, outletId: floor.outletId, deletedAt: null },
    }))
  )
    throw notFound('Table');
  await nameFree(db, actor.companyId, floor.outletId, [t.name], id);
  if (
    t.stewardIds.length &&
    (await db.user.count({
      where: { companyId: actor.companyId, id: { in: t.stewardIds }, deletedAt: null },
    })) !== t.stewardIds.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A steward is not a person in the company');
  const data = { ...t, section: t.section ?? null, outletId: floor.outletId };
  return db.$transaction(async (tx) => {
    const row = id
      ? await tx.diningTable.update({ where: { id }, data })
      : await tx.diningTable.create({ data: { companyId: actor.companyId, ...data } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.table_saved',
      entityType: 'dining_table',
      entityId: row.id,
      after: t,
    });
    return { id: row.id };
  });
}

/** Many tables at once (T1 … T20), set out on a grid after the ones already there; they can be dragged afterwards. */
export async function addTables(db: Db, actor: Actor, input: z.input<typeof tablesBulkSchema>) {
  admin(actor);
  const b = tablesBulkSchema.parse(input);
  const floor = await floorOf(db, actor, b.floorId);
  const names = Array.from({ length: b.count }, (_, i) => `${b.prefix}${b.from + i}`);
  await nameFree(db, actor.companyId, floor.outletId, names);
  const have = await db.diningTable.count({
    where: { companyId: actor.companyId, floorId: floor.id, deletedAt: null },
  });
  await db.$transaction(async (tx) => {
    await tx.diningTable.createMany({
      data: names.map((name, i) => ({
        companyId: actor.companyId,
        outletId: floor.outletId,
        floorId: floor.id,
        name,
        seats: b.seats,
        section: b.section ?? null,
        ...gridSpot(have + i),
      })),
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.tables_added',
      entityType: 'floor',
      entityId: floor.id,
      after: b,
    });
  });
  return { added: names.length };
}

export const movesSchema = z.object({
  moves: z
    .array(
      z.object({ id: z.string(), x: z.number().int().min(0).max(200), y: z.number().int().min(0).max(400) }),
    )
    .min(1)
    .max(300),
});
/** Tables dragged on the plan: their new places. */
export async function moveTables(db: Db, actor: Actor, input: z.input<typeof movesSchema>) {
  admin(actor);
  const m = movesSchema.parse(input);
  const rows = await db.diningTable.findMany({
    where: { companyId: actor.companyId, id: { in: m.moves.map((x) => x.id) }, deletedAt: null },
  });
  if (rows.length !== m.moves.length) throw notFound('Table');
  for (const outletId of new Set(rows.map((r) => r.outletId))) await outletOf(db, actor.companyId, outletId);
  await db.$transaction(
    m.moves.map((x) => db.diningTable.update({ where: { id: x.id }, data: { x: x.x, y: x.y } })),
  );
  return { ok: true };
}
export async function deleteTable(db: Db, actor: Actor, id: string) {
  admin(actor);
  const t = await db.diningTable.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!t) throw notFound('Table');
  await outletOf(db, actor.companyId, t.outletId);
  await db.diningTable.update({ where: { id }, data: { deletedAt: new Date() } });
  return { ok: true };
}
