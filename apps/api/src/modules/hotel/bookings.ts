import { formatNumber, nextCounter, type Db, type Stay, type Tx } from '@mono/db';
import {
  bookingInputSchema,
  cancelCharge,
  formatINR,
  noShowCharge,
  stayMachine,
  stayNights,
  transition,
  zonedToUtc,
  type StayStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit, type ActorContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { ctxOf } from '../hosp/access';
import { guestFor, guestParty } from '../hosp/res-core';
import type { Actor } from '../work/actor';
import { desk, dmy, hotelOf, isTaken, lockHotel, newToken, seer, stayOf, type Hotel } from './core';
import { postCharge } from './folio-core';
import { planRules, priceStay } from './rates';

/**
 * Phase 17 — bookings. A booking takes a room of its type for every night (the room itself may be chosen now or
 * at check-in), at the plan's rate for each night. Individual, corporate (the company pays the room), through a
 * travel agent (commission), or a room of a group block.
 */
const PROBLEMS = {
  STOP_SELL: 'Those days are closed for sale',
  CLOSED_TO_ARRIVAL: 'Nobody can arrive on that day',
  MIN_STAY: 'That is fewer nights than the minimum stay',
  SOLD_OUT: 'No room of that type is left',
} as const;

/** Say it to the guest (voucher, cancellation) or about them to the property's managers. */
export async function tell(
  tx: Tx,
  ctx: ActorContext,
  name: 'hotel.booked' | 'hotel.cancelled' | 'hotel.no_show' | 'hotel.form_c_due',
  hotel: Hotel,
  stay: Stay,
  extra: Record<string, unknown> = {},
) {
  const guest = await tx.guest.findFirstOrThrow({ where: { id: stay.guestId } });
  await emitEvent(tx, ctx, {
    name,
    entityType: 'stay',
    entityId: stay.id,
    payload: {
      branchId: hotel.branchId,
      hotel: hotel.name,
      number: stay.number,
      guest: guest.name,
      customer: guest.name,
      customerMobile: guest.mobile,
      customerEmail: guest.email,
      arrive: dmy(stay.arrive),
      depart: dmy(stay.depart),
      nights: stayNights(stay.arrive, stay.depart).length,
      link: `/stay/${stay.token}`,
      ...extra,
    },
  });
}

/**
 * Make a booking in the caller's transaction (which must hold the property's lock afterwards — it is taken
 * here). `from`: a channel that already sold it — it is never refused for restrictions or a full house.
 */
export async function bookStayIn(
  tx: Tx,
  ctx: ActorContext,
  hotel: Hotel,
  b: z.infer<typeof bookingInputSchema>,
  from?: { channel: string; ref: string },
) {
  await lockHotel(tx, hotel.branchId);
  const block = b.blockId
    ? await tx.groupBlock.findFirst({
        where: { id: b.blockId, companyId: ctx.companyId, branchId: hotel.branchId, status: 'HELD' },
      })
    : null;
  if (b.blockId && !block) throw new AppError(409, 'CONFLICT', 'That group block is not being held');
  if (block && (b.arrive < block.arrive || b.depart > block.depart))
    throw new AppError(400, 'VALIDATION_FAILED', 'Those nights are outside the group’s block');
  const p = await priceStay(
    tx,
    ctx.companyId,
    { ...b, ratePlanId: block?.ratePlanId ?? b.ratePlanId },
    { blockId: block?.id },
  );
  if (p.plan.branchId !== hotel.branchId || !p.plan.active) throw notFound('Rate plan');
  if (block) {
    const want = (block.rooms as { roomTypeId: string; count: number }[]).find(
      (r) => r.roomTypeId === b.roomTypeId,
    );
    const got = await tx.stay.count({
      where: { blockId: block.id, roomTypeId: b.roomTypeId, status: { in: ['BOOKED', 'CHECKED_IN'] } },
    });
    if (!want || got >= want.count)
      throw new AppError(409, 'CONFLICT', 'Every room of that type in the block is taken');
  }
  // A block's own rooms are already held: only the restrictions of the open market don't apply to it.
  // A booking a channel already sold is taken even when MONO would refuse it — and flagged when no room is left.
  if (p.problem && !from && !(block && p.problem !== 'SOLD_OUT'))
    throw new AppError(409, 'CONFLICT', PROBLEMS[p.problem], { problem: p.problem, day: p.soldOutOn });
  if (b.roomId) {
    const room = await tx.room.findFirst({
      where: { id: b.roomId, companyId: ctx.companyId, typeId: b.roomTypeId, deletedAt: null },
    });
    if (!room) throw new AppError(400, 'VALIDATION_FAILED', 'That room is not of this type');
  }
  const companyPartyId = b.companyPartyId ?? (p.plan.kind === 'CORPORATE' ? p.plan.partyId : null);
  const agentPartyId = b.agentPartyId ?? (p.plan.kind === 'AGENT' ? p.plan.partyId : null);
  for (const id of [companyPartyId, agentPartyId])
    if (id && !(await tx.party.count({ where: { id, companyId: ctx.companyId, deletedAt: null } })))
      throw notFound('Party');
  const guest = await guestFor(tx, ctx.companyId, b.guest);
  const partyId = await guestParty(tx, guest);
  const stay = await tx.stay.create({
    data: {
      companyId: ctx.companyId,
      branchId: hotel.branchId,
      number: formatNumber('BK', await nextCounter(tx, ctx.companyId, 'stay'), { pad: 5 }),
      guestId: guest.id,
      partyId,
      companyPartyId,
      agentPartyId,
      commissionPct: agentPartyId ? p.plan.commissionPct : 0,
      ratePlanId: p.plan.id,
      meal: p.plan.meal,
      roomTypeId: b.roomTypeId,
      kind: block ? 'GROUP' : companyPartyId ? 'CORPORATE' : agentPartyId ? 'AGENT' : b.kind,
      source: b.source,
      channel: from?.channel ?? null,
      channelRef: from?.ref ?? null,
      overbooked: Boolean(from && p.problem === 'SOLD_OUT'),
      blockId: block?.id ?? null,
      arrive: b.arrive,
      depart: b.depart,
      adults: b.adults,
      children: b.children,
      note: b.note ?? null,
      // A company that pays is billed the room; everything else stays with the guest.
      routing: companyPartyId ? [{ kinds: ['ROOM', 'EARLY', 'LATE'], folio: 2 }] : undefined,
      token: newToken(),
      createdById: ctx.actorId,
    },
  });
  await tx.roomNight.createMany({
    data: p.nights.map((n) => ({
      companyId: ctx.companyId,
      branchId: hotel.branchId,
      roomTypeId: b.roomTypeId,
      roomId: b.roomId ?? null,
      day: n.day,
      stayId: stay.id,
      rate: BigInt(n.rate),
    })),
  });
  await tx.folio.create({
    data: {
      companyId: ctx.companyId,
      branchId: hotel.branchId,
      stayId: stay.id,
      no: 1,
      name: guest.name,
      partyId,
    },
  });
  if (companyPartyId) {
    const company = await tx.party.findUniqueOrThrow({ where: { id: companyPartyId } });
    await tx.folio.create({
      data: {
        companyId: ctx.companyId,
        branchId: hotel.branchId,
        stayId: stay.id,
        no: 2,
        name: company.name,
        partyId: companyPartyId,
      },
    });
  }
  await writeAudit(tx, ctx, {
    action: 'hotel.booked',
    entityType: 'stay',
    entityId: stay.id,
    after: {
      number: stay.number,
      arrive: b.arrive,
      depart: b.depart,
      roomTypeId: b.roomTypeId,
      total: p.total,
    },
  });
  await tell(tx, ctx, 'hotel.booked', hotel, stay, {
    roomType: p.type.name,
    plan: p.plan.name,
    amount: formatINR(BigInt(p.total)),
  });
  return { id: stay.id, number: stay.number, total: p.total, nights: p.nights, overbooked: stay.overbooked };
}

export async function createBooking(db: Db, actor: Actor, input: z.input<typeof bookingInputSchema>) {
  desk(actor);
  const b = bookingInputSchema.parse(input);
  const hotel = await hotelOf(db, actor, b.branchId);
  if (b.arrive < hotel.businessDate)
    throw new AppError(400, 'VALIDATION_FAILED', `The hotel's date is ${dmy(hotel.businessDate)}`);
  try {
    return await db.$transaction((tx) => bookStayIn(tx, ctxOf(actor), hotel, b));
  } catch (e) {
    if (isTaken(e)) throw new AppError(409, 'CONFLICT', 'That room is already taken on one of those nights');
    throw e;
  }
}

/** The nights of a stay as they stand, oldest first. */
export const nightsOf = (db: Db | Tx, stayId: string) =>
  db.roomNight.findMany({ where: { stayId }, orderBy: { day: 'asc' } });

/**
 * A booking that will not be used (cancelled, or the guest never came): its nights go back on sale, and the plan's
 * charge — if any — is put on the guest's folio, to be settled like any folio.
 */
export async function releaseBooking(
  tx: Tx,
  ctx: ActorContext,
  hotel: Hotel,
  stay: Stay,
  how: 'CANCEL' | 'NO_SHOW',
  role: 'desk' | 'system',
  reason?: string | null,
) {
  const to = transition(stayMachine, {
    from: stay.status as StayStatus,
    action: how === 'CANCEL' ? 'cancel' : 'noShow',
    roles: [role],
    ctx: { room: true, kyc: true, settled: true },
  }).to;
  const plan = await tx.ratePlan.findUniqueOrThrow({ where: { id: stay.ratePlanId } });
  const nights = (await nightsOf(tx, stay.id)).map((n) => ({ day: n.day, rate: Number(n.rate) }));
  const hours =
    (zonedToUtc(stay.arrive, hotel.rules.checkInMin, hotel.tz).getTime() - Date.now()) / 3_600_000;
  const rules = planRules(plan);
  const charge =
    how === 'CANCEL' ? cancelCharge(rules.cancel, nights, hours) : noShowCharge(rules.noShow, nights);
  await tx.roomNight.deleteMany({ where: { stayId: stay.id } });
  const row = await tx.stay.update({
    where: { id: stay.id },
    data: { status: to, cancelReason: reason ?? null },
  });
  if (charge > 0) {
    const type = await tx.roomType.findUniqueOrThrow({ where: { id: stay.roomTypeId } });
    await postCharge(tx, ctx, hotel, row, {
      kind: how === 'CANCEL' ? 'CANCEL' : 'NO_SHOW',
      text: how === 'CANCEL' ? `Cancellation charge — ${stay.number}` : `No-show charge — ${stay.number}`,
      amount: charge,
      taxCode: type.taxCode ?? hotel.rules.roomTaxCode ?? null,
      folioNo: 1,
    });
  }
  await writeAudit(tx, ctx, {
    action: how === 'CANCEL' ? 'hotel.cancelled' : 'hotel.no_show',
    entityType: 'stay',
    entityId: stay.id,
    before: { status: stay.status },
    after: { status: to, charge, reason: reason ?? null },
  });
  await tell(tx, ctx, how === 'CANCEL' ? 'hotel.cancelled' : 'hotel.no_show', hotel, row, {
    charge: charge ? formatINR(BigInt(charge)) : '',
  });
  return { stay: row, charge };
}

export const cancelSchema = z.object({ reason: z.string().trim().max(200).nullish() });
export async function cancelBooking(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof cancelSchema>,
  how: 'CANCEL' | 'NO_SHOW' = 'CANCEL',
) {
  desk(actor);
  const { reason } = cancelSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, id);
  const out = await db.$transaction(async (tx) => {
    await lockHotel(tx, hotel.branchId);
    return releaseBooking(tx, ctxOf(actor), hotel, stay, how, 'desk', reason);
  });
  return { id, status: out.stay.status, charge: out.charge };
}

export const stayQuery = z.object({
  branchId: z.string().min(1),
  status: z.enum(['BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']).optional(),
  q: z.string().trim().max(80).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type StayRow = Awaited<ReturnType<typeof stayRows>>[number];
/** Stays as rows for a list: the guest, the room it is in tonight (or first), the dates, the status. */
export async function stayRows(db: Db | Tx, hotel: Hotel, stays: Stay[]) {
  const ids = stays.map((s) => s.id);
  const [guests, nights, rooms, types] = await Promise.all([
    db.guest.findMany({ where: { id: { in: stays.map((s) => s.guestId) } } }),
    db.roomNight.findMany({ where: { stayId: { in: ids } }, orderBy: { day: 'asc' } }),
    db.room.findMany({ where: { companyId: hotel.companyId, branchId: hotel.branchId } }),
    db.roomType.findMany({ where: { companyId: hotel.companyId, branchId: hotel.branchId } }),
  ]);
  return stays.map((s) => {
    const mine = nights.filter((n) => n.stayId === s.id);
    const tonight =
      mine.find((n) => n.day === hotel.businessDate) ??
      mine.find((n) => n.day > hotel.businessDate) ??
      mine[mine.length - 1];
    const guest = guests.find((g) => g.id === s.guestId);
    return {
      id: s.id,
      number: s.number,
      status: s.status as StayStatus,
      kind: s.kind,
      source: s.source,
      arrive: s.arrive,
      depart: s.depart,
      nights: stayNights(s.arrive, s.depart).length,
      adults: s.adults,
      children: s.children,
      meal: s.meal,
      roomTypeId: s.roomTypeId,
      roomType: types.find((t) => t.id === s.roomTypeId)?.name ?? '',
      roomId: tonight?.roomId ?? null,
      room: rooms.find((r) => r.id === tonight?.roomId)?.number ?? null,
      guest: guest ? { id: guest.id, name: guest.name, mobile: guest.mobile, tags: guest.tags } : null,
      companyPartyId: s.companyPartyId,
      agentPartyId: s.agentPartyId,
      blockId: s.blockId,
      total: mine.reduce((n, x) => n + Number(x.rate), 0),
      formCDue: Boolean(s.formCDueAt && !s.formCFiledAt),
    };
  });
}

export async function listStays(db: Db, actor: Actor, q: z.infer<typeof stayQuery>) {
  seer(actor);
  const hotel = await hotelOf(db, actor, q.branchId);
  const guestIds = q.q
    ? (
        await db.guest.findMany({
          where: {
            companyId: actor.companyId,
            OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { mobile: { contains: q.q } }],
          },
          select: { id: true },
          take: 200,
        })
      ).map((g) => g.id)
    : null;
  const stays = await db.stay.findMany({
    where: {
      companyId: actor.companyId,
      branchId: q.branchId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { depart: { gte: q.from } } : {}),
      ...(q.to ? { arrive: { lte: q.to } } : {}),
      ...(guestIds
        ? { OR: [{ guestId: { in: guestIds } }, { number: { contains: q.q!, mode: 'insensitive' } }] }
        : {}),
    },
    orderBy: [{ arrive: 'asc' }, { number: 'asc' }],
    take: 500,
  });
  return { businessDate: hotel.businessDate, stays: await stayRows(db, hotel, stays) };
}
