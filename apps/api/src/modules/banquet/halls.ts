import type { Db } from '@mono/db';
import {
  HALL_HOLDING,
  banquetRulesSchema,
  barRulesSchema,
  branchRulesSchema,
  hallSchema,
  overrideOf,
  packageSchema,
  slotLabel,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { branchWhere, ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { admin, placeOf, seer } from './core';

/** Phase 18 — banquet set-up: halls with their capacities and rent, menu packages sold per plate, a branch's rules. */
const taxOk = async (db: Db, companyId: string, codes: (string | null | undefined)[]) => {
  for (const code of new Set(codes.filter((c): c is string => Boolean(c))))
    if (!(await db.taxRate.count({ where: { companyId, code } })))
      throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate ${code} in Money set-up`);
};

export async function listHalls(db: Db, actor: Actor, branchId?: string) {
  seer(actor);
  const halls = await db.hall.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      ...branchWhere(),
      ...(branchId ? { branchId } : {}),
    },
    orderBy: { name: 'asc' },
  });
  return halls.map((h) => ({
    id: h.id,
    branchId: h.branchId,
    name: h.name,
    capacities: h.capacities as { style: string; guests: number }[],
    rent: Number(h.rent),
    rentTaxCode: h.rentTaxCode,
  }));
}
export async function saveHall(db: Db, actor: Actor, input: z.input<typeof hallSchema>, id?: string) {
  admin(actor);
  const h = hallSchema.parse(input);
  await placeOf(db, actor, h.branchId);
  await taxOk(db, actor.companyId, [h.rentTaxCode]);
  const clash = await db.hall.findFirst({
    where: {
      companyId: actor.companyId,
      branchId: h.branchId,
      deletedAt: null,
      name: { equals: h.name, mode: 'insensitive' },
      NOT: { id: id ?? '' },
    },
  });
  if (clash) throw new AppError(409, 'CONFLICT', `There is already a hall called ${clash.name}`);
  const before = id
    ? await db.hall.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
    : null;
  if (id && !before) throw notFound('Hall');
  const data = {
    branchId: h.branchId,
    name: h.name,
    capacities: h.capacities,
    rent: BigInt(h.rent),
    rentTaxCode: h.rentTaxCode ?? null,
  };
  return db.$transaction(async (tx) => {
    const row = before
      ? await tx.hall.update({ where: { id: before.id }, data })
      : await tx.hall.create({ data: { ...data, companyId: actor.companyId } });
    await writeAudit(tx, ctxOf(actor), {
      action: before ? 'banquet.hall_updated' : 'banquet.hall_created',
      entityType: 'hall',
      entityId: row.id,
      after: { name: h.name, capacities: h.capacities, rent: h.rent },
    });
    return { id: row.id, name: row.name };
  });
}
/** A hall with events keeps its history: it leaves the lists, never the database; not while an event is still to come. */
export async function deleteHall(db: Db, actor: Actor, id: string) {
  admin(actor);
  const hall = await db.hall.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!hall) throw notFound('Hall');
  const place = await placeOf(db, actor, hall.branchId);
  const coming = await db.banquetEvent.count({
    where: {
      companyId: actor.companyId,
      hallIds: { has: id },
      status: { in: ['ENQUIRY', 'QUOTED', 'CONFIRMED'] },
      day: { gte: place.today },
    },
  });
  if (coming) throw new AppError(409, 'CONFLICT', `${hall.name} still has events to come`);
  await db.$transaction(async (tx) => {
    await tx.hall.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'banquet.hall_deleted',
      entityType: 'hall',
      entityId: id,
      before: { name: hall.name },
    });
  });
  return { ok: true };
}

export async function listPackages(db: Db, actor: Actor) {
  seer(actor);
  const rows = await db.banquetPackage.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    pricePerPlate: Number(p.pricePerPlate),
    taxCode: p.taxCode,
    items: p.items as z.infer<typeof packageSchema>['items'],
  }));
}
export async function savePackage(db: Db, actor: Actor, input: z.input<typeof packageSchema>, id?: string) {
  admin(actor);
  const p = packageSchema.parse(input);
  await taxOk(db, actor.companyId, [p.taxCode]);
  const ids = p.items.map((i) => i.itemId).filter((x): x is string => Boolean(x));
  if (
    ids.length &&
    (await db.item.count({ where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null } })) !==
      new Set(ids).size
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A dish of the package is not in the item master');
  const before = id
    ? await db.banquetPackage.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
    : null;
  if (id && !before) throw notFound('Package');
  const data = {
    name: p.name,
    pricePerPlate: BigInt(p.pricePerPlate),
    taxCode: p.taxCode ?? null,
    items: p.items,
  };
  return db.$transaction(async (tx) => {
    const row = before
      ? await tx.banquetPackage.update({ where: { id: before.id }, data })
      : await tx.banquetPackage.create({ data: { ...data, companyId: actor.companyId } });
    await writeAudit(tx, ctxOf(actor), {
      action: before ? 'banquet.package_updated' : 'banquet.package_created',
      entityType: 'banquet_package',
      entityId: row.id,
      after: { name: p.name, pricePerPlate: p.pricePerPlate, items: p.items.length },
    });
    return { id: row.id, name: row.name };
  });
}
export async function deletePackage(db: Db, actor: Actor, id: string) {
  admin(actor);
  const p = await db.banquetPackage.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!p) throw notFound('Package');
  await db.$transaction(async (tx) => {
    await tx.banquetPackage.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'banquet.package_deleted',
      entityType: 'banquet_package',
      entityId: id,
      before: { name: p.name },
    });
  });
  return { ok: true };
}

export const branchRulesPatch = z.object({
  banquet: overrideOf(banquetRulesSchema).optional(),
  bar: overrideOf(barRulesSchema).optional(),
});
/** A branch's banquet and bar rules: only the parts sent change. */
export async function saveBranchRules(
  db: Db,
  actor: Actor,
  branchId: string,
  input: z.input<typeof branchRulesPatch>,
) {
  admin(actor);
  const place = await placeOf(db, actor, branchId);
  const p = branchRulesPatch.parse(input);
  const next = branchRulesSchema.parse({
    banquet: { ...place.rules.banquet, ...(p.banquet ?? {}) },
    bar: { ...place.rules.bar, ...(p.bar ?? {}) },
  });
  await db.$transaction(async (tx) => {
    await tx.branchRule.upsert({
      where: { branchId },
      create: { companyId: actor.companyId, branchId, rules: next, updatedById: actor.userId },
      update: { rules: next, updatedById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.branch_rules_saved',
      entityType: 'branch',
      entityId: branchId,
      before: place.rules,
      after: next,
    });
  });
  return next;
}
export async function getBranchRules(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const place = await placeOf(db, actor, branchId);
  return { rules: place.rules, today: place.today, name: place.name };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const calendarQuery = z.object({ branchId: z.string().min(1), from: day, to: day });
/** The hall calendar: each hall's events between two days, with whether they hold the hall. */
export async function hallCalendar(db: Db, actor: Actor, q: z.infer<typeof calendarQuery>) {
  seer(actor);
  await placeOf(db, actor, q.branchId);
  const [halls, events] = await Promise.all([
    listHalls(db, actor, q.branchId),
    db.banquetEvent.findMany({
      where: {
        companyId: actor.companyId,
        branchId: q.branchId,
        day: { gte: q.from, lte: q.to },
        status: { notIn: ['LOST', 'CANCELLED'] },
      },
      orderBy: [{ day: 'asc' }, { startMin: 'asc' }],
    }),
  ]);
  const guests = await db.guest.findMany({
    where: { id: { in: events.map((e) => e.guestId) } },
    select: { id: true, name: true },
  });
  return halls.map((h) => ({
    ...h,
    events: events
      .filter((e) => e.hallIds.includes(h.id))
      .map((e) => ({
        id: e.id,
        number: e.number,
        day: e.day,
        from: slotLabel(e.startMin),
        to: slotLabel(e.endMin),
        occasion: e.occasion,
        guest: guests.find((g) => g.id === e.guestId)?.name ?? '',
        covers: e.guaranteedCovers ?? e.expectedCovers,
        status: e.status,
        holds: HALL_HOLDING.includes(e.status as (typeof HALL_HOLDING)[number]),
      })),
  }));
}
