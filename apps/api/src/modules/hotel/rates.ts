import type { Db, RatePlan, Tx } from '@mono/db';
import {
  addDays,
  hotelRulesSchema,
  overrideOf,
  quoteStay,
  ratePlanSchema,
  restriction,
  stayNights,
  type DayRule,
  type RatePlanInput,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { admin, hotelFor, hotelOf, seer, supervisor, type Hotel } from './core';

/**
 * Phase 17 — rates and availability. A rate plan prices a night for each room type it sells; a day can carry
 * restrictions; the rooms left to sell on a day are the type's rooms less the nights already taken, the rooms
 * out of order, and what a group block still holds.
 */
type PlanRules = Pick<
  RatePlanInput,
  'rates' | 'weekendDays' | 'seasons' | 'los' | 'minStay' | 'cancel' | 'noShow'
>;
export const planRules = (p: RatePlan) => p.rules as unknown as PlanRules;
const planView = (p: RatePlan) => ({
  id: p.id,
  branchId: p.branchId,
  code: p.code,
  name: p.name,
  meal: p.meal,
  kind: p.kind,
  partyId: p.partyId,
  commissionPct: Number(p.commissionPct),
  active: p.active,
  ...planRules(p),
});

export async function listPlans(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  await hotelOf(db, actor, branchId);
  const rows = await db.ratePlan.findMany({
    where: { companyId: actor.companyId, branchId, deletedAt: null },
    orderBy: { code: 'asc' },
  });
  return rows.map(planView);
}

export async function savePlan(db: Db, actor: Actor, input: z.input<typeof ratePlanSchema>, id?: string) {
  admin(actor);
  const p = ratePlanSchema.parse(input);
  await hotelOf(db, actor, p.branchId);
  const types = await db.roomType.findMany({
    where: { companyId: actor.companyId, branchId: p.branchId, deletedAt: null },
    select: { id: true },
  });
  if (p.rates.some((r) => !types.some((t) => t.id === r.roomTypeId)))
    throw new AppError(400, 'VALIDATION_FAILED', 'A room type is not one of this property’s');
  if (p.kind !== 'RACK' && !p.partyId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose the company or agent this plan is for');
  if (
    p.partyId &&
    !(await db.party.count({ where: { id: p.partyId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Party');
  const clash = await db.ratePlan.findFirst({
    where: {
      companyId: actor.companyId,
      branchId: p.branchId,
      code: p.code,
      deletedAt: null,
      NOT: { id: id ?? '' },
    },
  });
  if (clash) throw new AppError(409, 'CONFLICT', `There is already a plan ${p.code}`);
  const before = id
    ? await db.ratePlan.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
    : null;
  if (id && !before) throw notFound('Rate plan');
  const { rates, weekendDays, seasons, los, minStay, cancel, noShow } = p;
  const data = {
    branchId: p.branchId,
    code: p.code,
    name: p.name,
    meal: p.meal,
    kind: p.kind,
    partyId: p.partyId ?? null,
    commissionPct: p.commissionPct,
    active: p.active,
    rules: { rates, weekendDays, seasons, los, minStay, cancel, noShow },
  };
  return db.$transaction(async (tx) => {
    const row = before
      ? await tx.ratePlan.update({ where: { id: before.id }, data })
      : await tx.ratePlan.create({ data: { ...data, companyId: actor.companyId } });
    await writeAudit(tx, ctxOf(actor), {
      action: before ? 'hotel.plan_updated' : 'hotel.plan_created',
      entityType: 'rate_plan',
      entityId: row.id,
      before: before ? planView(before) : undefined,
      after: planView(row),
    });
    return planView(row);
  });
}

/** A plan with bookings keeps its history: it is switched off the lists, never removed. */
export async function deletePlan(db: Db, actor: Actor, id: string) {
  admin(actor);
  const p = await db.ratePlan.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!p) throw notFound('Rate plan');
  await hotelOf(db, actor, p.branchId);
  await db.$transaction(async (tx) => {
    await tx.ratePlan.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.plan_deleted',
      entityType: 'rate_plan',
      entityId: id,
      before: planView(p),
    });
  });
  return { ok: true };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const roomDaysSchema = z.object({
  branchId: z.string().min(1),
  roomTypeIds: z.array(z.string().min(1)).min(1).max(60),
  from: day,
  to: day,
  stopSell: z.boolean().optional(),
  closedToArrival: z.boolean().optional(),
  /** null clears it. */
  minStay: z.number().int().min(1).max(60).nullish(),
});
/** Set restrictions on room types for a run of days: only what is sent changes. */
export async function setRoomDays(db: Db, actor: Actor, input: z.input<typeof roomDaysSchema>) {
  supervisor(actor);
  const p = roomDaysSchema.parse(input);
  await hotelOf(db, actor, p.branchId);
  const days = stayNights(p.from, addDays(p.to, 1));
  if (!days.length || days.length > 370) throw new AppError(400, 'VALIDATION_FAILED', 'Choose up to a year');
  const patch = {
    ...(p.stopSell !== undefined ? { stopSell: p.stopSell } : {}),
    ...(p.closedToArrival !== undefined ? { closedToArrival: p.closedToArrival } : {}),
    ...('minStay' in p ? { minStay: p.minStay ?? null } : {}),
  };
  await db.$transaction(async (tx) => {
    for (const roomTypeId of p.roomTypeIds)
      for (const d of days)
        await tx.roomDay.upsert({
          where: { roomTypeId_day: { roomTypeId, day: d } },
          create: { companyId: actor.companyId, branchId: p.branchId, roomTypeId, day: d, ...patch },
          update: patch,
        });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.restrictions_set',
      entityType: 'branch',
      entityId: p.branchId,
      after: p,
    });
  });
  return { days: days.length * p.roomTypeIds.length };
}

export type Inventory = {
  roomTypeId: string;
  day: string;
  rooms: number;
  sold: number;
  outOfOrder: number;
  held: number;
  left: number;
  rule: DayRule;
};
/** Rooms left to sell for each room type on each day of a span (`to` not included). */
export async function inventory(
  db: Db | Tx,
  hotel: Hotel,
  from: string,
  to: string,
  opts: { exceptStayId?: string; exceptBlockId?: string } = {},
): Promise<Inventory[]> {
  const days = stayNights(from, to);
  const where = { companyId: hotel.companyId, branchId: hotel.branchId };
  const [types, rooms, nights, rules, blocks] = await Promise.all([
    db.roomType.findMany({ where: { ...where, deletedAt: null }, select: { id: true } }),
    db.room.groupBy({ by: ['typeId'], where: { ...where, deletedAt: null }, _count: { _all: true } }),
    db.roomNight.findMany({
      where: { ...where, day: { gte: from, lt: to } },
      select: { roomTypeId: true, day: true, stayId: true, blockId: true },
    }),
    db.roomDay.findMany({ where: { ...where, day: { gte: from, lt: to } } }),
    db.groupBlock.findMany({
      where: { ...where, status: 'HELD', arrive: { lt: to }, depart: { gt: from } },
    }),
  ]);
  // What a group block still holds: its rooms less the bookings already made from it.
  const picked = blocks.length
    ? await db.stay.groupBy({
        by: ['blockId', 'roomTypeId'],
        where: {
          ...where,
          blockId: { in: blocks.map((b) => b.id) },
          status: { in: ['BOOKED', 'CHECKED_IN'] },
        },
        _count: { _all: true },
      })
    : [];
  const out: Inventory[] = [];
  for (const t of types)
    for (const d of days) {
      const mine = nights.filter((n) => n.roomTypeId === t.id && n.day === d);
      const held = blocks
        .filter((b) => b.id !== opts.exceptBlockId && b.arrive <= d && b.depart > d)
        .reduce((n, b) => {
          const want = (b.rooms as { roomTypeId: string; count: number }[]).find(
            (r) => r.roomTypeId === t.id,
          );
          const got = picked.find((p) => p.blockId === b.id && p.roomTypeId === t.id)?._count._all ?? 0;
          return n + Math.max(0, (want?.count ?? 0) - got);
        }, 0);
      const count = rooms.find((r) => r.typeId === t.id)?._count._all ?? 0;
      const sold = mine.filter((n) => n.stayId && n.stayId !== opts.exceptStayId).length;
      const outOfOrder = mine.filter((n) => n.blockId).length;
      const r = rules.find((x) => x.roomTypeId === t.id && x.day === d);
      out.push({
        roomTypeId: t.id,
        day: d,
        rooms: count,
        sold,
        outOfOrder,
        held,
        left: count - sold - outOfOrder - held,
        rule: {
          stopSell: r?.stopSell ?? false,
          closedToArrival: r?.closedToArrival ?? false,
          minStay: r?.minStay ?? null,
        },
      });
    }
  return out;
}

export const availabilityQuery = z.object({ branchId: z.string().min(1), from: day, to: day });
export async function availability(db: Db, actor: Actor, q: z.infer<typeof availabilityQuery>) {
  seer(actor);
  const hotel = await hotelOf(db, actor, q.branchId);
  if (q.to <= q.from || stayNights(q.from, q.to).length > 92)
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose up to three months');
  return { businessDate: hotel.businessDate, days: await inventory(db, hotel, q.from, q.to) };
}

export const quoteSchema = z.object({
  ratePlanId: z.string().min(1),
  roomTypeId: z.string().min(1),
  arrive: day,
  depart: day,
  adults: z.coerce.number().int().min(1).max(20).default(1),
  children: z.coerce.number().int().min(0).max(20).default(0),
});
/**
 * A stay priced night by night, with why it can't be sold when it can't (a restriction, or no room left).
 * `own`: the stay or block being changed, whose rooms don't count against it.
 */
export async function priceStay(
  db: Db | Tx,
  companyId: string,
  q: z.infer<typeof quoteSchema>,
  own: { exceptStayId?: string; blockId?: string | null } = {},
) {
  const plan = await db.ratePlan.findFirst({ where: { id: q.ratePlanId, companyId, deletedAt: null } });
  if (!plan) throw notFound('Rate plan');
  const type = await db.roomType.findFirst({
    where: { id: q.roomTypeId, companyId, branchId: plan.branchId, deletedAt: null },
  });
  if (!type) throw notFound('Room type');
  if (q.depart <= q.arrive)
    throw new AppError(400, 'VALIDATION_FAILED', 'The departure is after the arrival');
  if (q.adults + q.children > type.maxOccupancy)
    throw new AppError(400, 'VALIDATION_FAILED', `${type.name} takes at most ${type.maxOccupancy} guests`);
  const rules = planRules(plan);
  const quote = quoteStay(rules, type.id, q.arrive, q.depart, {
    adults: q.adults,
    children: q.children,
    occupancy: type.occupancy,
  });
  if (!quote) throw new AppError(400, 'VALIDATION_FAILED', `${plan.name} has no rate for ${type.name}`);
  const hotel = await hotelFor(db, companyId, plan.branchId);
  const inv = (
    await inventory(db, hotel, q.arrive, q.depart, {
      exceptStayId: own.exceptStayId,
      exceptBlockId: own.blockId ?? undefined,
    })
  ).filter((i) => i.roomTypeId === type.id);
  const stop = restriction(q.arrive, q.depart, new Map(inv.map((i) => [i.day, i.rule])), rules.minStay);
  const full = inv.find((i) => i.left < 1);
  return {
    plan,
    type,
    hotel,
    rules,
    nights: quote.nights,
    total: quote.total,
    problem: stop ?? (full ? ('SOLD_OUT' as const) : null),
    soldOutOn: full?.day ?? null,
  };
}
export async function quote(db: Db, actor: Actor, q: z.infer<typeof quoteSchema>) {
  seer(actor);
  const p = await priceStay(db, actor.companyId, q);
  await hotelOf(db, actor, p.plan.branchId);
  return { nights: p.nights, total: p.total, meal: p.plan.meal, problem: p.problem, soldOutOn: p.soldOutOn };
}

export const rulesPatchSchema = overrideOf(hotelRulesSchema);
/** The property's rules: only the parts sent change. */
export async function saveRules(
  db: Db,
  actor: Actor,
  branchId: string,
  input: z.input<typeof rulesPatchSchema>,
) {
  admin(actor);
  const hotel = await hotelOf(db, actor, branchId);
  const next = hotelRulesSchema.parse({ ...hotel.rules, ...rulesPatchSchema.parse(input) });
  const codes = [
    next.roomTaxCode,
    ...next.extras.map((e) => e.taxCode),
    ...next.minibar.map((m) => m.taxCode),
  ].filter((c): c is string => Boolean(c));
  for (const code of new Set(codes))
    if (!(await db.taxRate.count({ where: { companyId: actor.companyId, code } })))
      throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate ${code} in Money set-up`);
  await db.$transaction(async (tx) => {
    await tx.hotelSettings.update({ where: { branchId }, data: { rules: next, updatedById: actor.userId } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.rules_saved',
      entityType: 'branch',
      entityId: branchId,
      before: hotel.rules,
      after: next,
    });
  });
  return { rules: next, businessDate: hotel.businessDate };
}
export async function getRules(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const hotel = await hotelOf(db, actor, branchId);
  return { rules: hotel.rules, businessDate: hotel.businessDate, name: hotel.name };
}
