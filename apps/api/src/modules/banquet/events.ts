import { formatNumber, nextCounter, type BanquetEvent, type Db, type Tx } from '@mono/db';
import {
  HALL_HOLDING,
  advanceNeeded,
  banquetMachine,
  enquirySchema,
  formatINR,
  quoteSchema,
  transition,
  type BanquetQuote,
  type BanquetStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { type Actor } from '../work/actor';
import { ctxOf } from '../hosp/access';
import { guestFor, guestParty } from '../hosp/res-core';
import { lockBranch, placeOf, sales, seer } from './core';

/**
 * Phase 18 — a banquet event from enquiry to confirmation: the enquiry (who, when, which halls, how many), the
 * quotation (a menu package per plate, hall rent, extras), and the booking — confirmed once the advance is in,
 * when the halls are held for it and nobody else can be confirmed there for that time.
 */
import { advancesOf, eventOf, eventView, indentFor, instant, rolesOf, tell, totalsOf } from './event-core';

export async function createEnquiry(db: Db, actor: Actor, input: z.input<typeof enquirySchema>) {
  sales(actor);
  const q = enquirySchema.parse(input);
  const place = await placeOf(db, actor, q.branchId);
  if (q.endMin <= q.startMin) throw new AppError(400, 'VALIDATION_FAILED', 'The event ends after it starts');
  if (q.day < place.today) throw new AppError(400, 'VALIDATION_FAILED', 'That day has passed');
  const halls = await db.hall.findMany({
    where: { companyId: actor.companyId, branchId: q.branchId, id: { in: q.hallIds }, deletedAt: null },
  });
  if (halls.length !== new Set(q.hallIds).size)
    throw new AppError(400, 'VALIDATION_FAILED', 'A hall is not one of this branch’s');
  if (
    q.companyPartyId &&
    !(await db.party.count({ where: { id: q.companyPartyId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Party');
  const row = await db.$transaction(async (tx) => {
    const guest = await guestFor(tx, actor.companyId, q.guest);
    const e = await tx.banquetEvent.create({
      data: {
        companyId: actor.companyId,
        branchId: q.branchId,
        number: formatNumber('BQ', await nextCounter(tx, actor.companyId, 'banquet'), { pad: 4 }),
        guestId: guest.id,
        partyId: q.companyPartyId ?? (await guestParty(tx, guest)),
        occasion: q.occasion,
        day: q.day,
        startMin: q.startMin,
        endMin: q.endMin,
        startAt: instant(place, q.day, q.startMin),
        endAt: instant(place, q.day, q.endMin),
        hallIds: [...new Set(q.hallIds)],
        style: q.style ?? null,
        expectedCovers: q.expectedCovers,
        note: q.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'banquet.enquiry',
      entityType: 'banquet_event',
      entityId: e.id,
      after: { number: e.number, day: q.day, halls: q.hallIds, covers: q.expectedCovers },
    });
    return e;
  });
  return eventView(db, place, row);
}

export const quoteBody = quoteSchema.extend({
  /** Where the food's stock is taken from ("" = the main store). */
  locationId: z.string().max(40).optional(),
});
/**
 * Make (or change) the quotation. Before confirmation it only prices the enquiry; on a confirmed event it is a
 * revision — the indent is worked out again and the BEO gets a new version.
 */
export async function quoteEvent(db: Db, actor: Actor, id: string, input: z.input<typeof quoteBody>) {
  sales(actor);
  const q = quoteBody.parse(input);
  const { event, place } = await eventOf(db, actor, id);
  const confirmed = event.status === 'CONFIRMED';
  const to = transition(banquetMachine, {
    from: event.status as BanquetStatus,
    action: confirmed ? 'revise' : 'quote',
    roles: rolesOf(actor),
    ctx: { advancePaid: true, checked: true, settled: true },
  }).to;
  const pack = q.packageId
    ? await db.banquetPackage.findFirst({
        where: { id: q.packageId, companyId: actor.companyId, deletedAt: null },
      })
    : null;
  if (q.packageId && !pack) throw notFound('Package');
  const halls = await db.hall.findMany({ where: { id: { in: event.hallIds } } });
  // The halls must seat the guaranteed covers in the way they are set (or in their largest setting).
  const seats = halls.reduce((n, h) => {
    const caps = h.capacities as { style: string; guests: number }[];
    const cap =
      caps.find((c) => c.style.toLowerCase() === (event.style ?? '').toLowerCase())?.guests ??
      Math.max(...caps.map((c) => c.guests));
    return n + cap;
  }, 0);
  if (q.guaranteedCovers > seats)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `${halls.map((h) => h.name).join(' + ')} holds ${seats} guests at most`,
    );
  if (
    q.locationId &&
    !(await db.location.count({
      where: { id: q.locationId, companyId: actor.companyId, branchId: event.branchId, deletedAt: null },
    }))
  )
    throw notFound('Location');
  const rented = halls.filter((h) => h.rent > 0n);
  const quote: BanquetQuote = {
    packageId: pack?.id ?? null,
    packageName: pack?.name ?? null,
    pricePerPlate: q.pricePerPlate ?? Number(pack?.pricePerPlate ?? 0),
    taxCode: pack?.taxCode ?? null,
    items: (pack?.items as BanquetQuote['items'] | undefined) ?? [],
    guaranteedCovers: q.guaranteedCovers,
    hallRent: q.hallRent ?? halls.reduce((n, h) => n + Number(h.rent), 0),
    rentTaxCode: rented[0]?.rentTaxCode ?? halls[0]?.rentTaxCode ?? null,
    extras: q.extras,
    discount: q.discount,
  };
  for (const code of new Set(q.extras.map((x) => x.taxCode).filter((c): c is string => Boolean(c))))
    if (!(await db.taxRate.count({ where: { companyId: actor.companyId, code } })))
      throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate ${code} in Money set-up`);
  const locationId = q.locationId ?? event.locationId;
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    const after = await tx.banquetEvent.update({
      where: { id },
      data: {
        status: to,
        quote,
        quoteVersion: { increment: 1 },
        guaranteedCovers: q.guaranteedCovers,
        locationId,
        ...(confirmed
          ? {
              indent: await indentFor(tx, actor.companyId, quote, q.guaranteedCovers, locationId),
              beoVersion: { increment: 1 },
              beoSentAt: null,
            }
          : {}),
      },
    });
    const totals = await totalsOf(tx, place, after);
    await writeAudit(tx, ctx, {
      action: confirmed ? 'banquet.revised' : 'banquet.quoted',
      entityType: 'banquet_event',
      entityId: id,
      before: { status: event.status, quote: event.quote },
      after: { status: to, quote, total: totals.total },
    });
    if (!confirmed)
      await tell(tx, ctx, 'banquet.quoted', place, after, { amount: formatINR(BigInt(totals.total)) });
    return after;
  });
  return eventView(db, place, row);
}

/** Halls of this event that someone else already holds for any part of its time. */
export async function hallClash(tx: Tx, e: BanquetEvent) {
  const other = await tx.banquetEvent.findFirst({
    where: {
      companyId: e.companyId,
      id: { not: e.id },
      status: { in: [...HALL_HOLDING] },
      hallIds: { hasSome: e.hallIds },
      startAt: { lt: e.endAt },
      endAt: { gt: e.startAt },
    },
  });
  if (!other) return null;
  const hall = await tx.hall.findFirst({
    where: { id: { in: e.hallIds.filter((h) => other.hallIds.includes(h)) } },
  });
  return { number: other.number, hall: hall?.name ?? '' };
}

/** Confirm the booking: the advance must be in and the halls free; they are then held, and the BEO is started. */
export async function confirmEvent(db: Db, actor: Actor, id: string) {
  sales(actor);
  const { event, place } = await eventOf(db, actor, id);
  const quote = event.quote as BanquetQuote | null;
  if (!quote) throw new AppError(409, 'CONFLICT', 'Make the quotation first');
  const totals = await totalsOf(db, place, event);
  const { paid } = await advancesOf(db, event);
  const needed = advanceNeeded(place.rules.banquet, totals.total);
  if (paid < needed)
    throw new AppError(
      409,
      'CONFLICT',
      `An advance of ${formatINR(BigInt(needed))} confirms this booking (${formatINR(BigInt(paid))} paid)`,
    );
  const to = transition(banquetMachine, {
    from: event.status as BanquetStatus,
    action: 'confirm',
    roles: rolesOf(actor),
    ctx: { advancePaid: true, checked: false, settled: false },
  }).to;
  const ctx = ctxOf(actor);
  const row = await db.$transaction(async (tx) => {
    // One confirmation at a time per branch: two events can never both take a hall for the same time.
    await lockBranch(tx, `banquet:${event.branchId}`);
    const clash = await hallClash(tx, event);
    if (clash)
      throw new AppError(409, 'CONFLICT', `${clash.hall} is already booked for that time (${clash.number})`);
    const after = await tx.banquetEvent.update({
      where: { id },
      data: {
        status: to,
        indent: await indentFor(tx, actor.companyId, quote, quote.guaranteedCovers, event.locationId),
        checklist: place.rules.banquet.checklist.map((c) => ({ ...c, done: false })),
        beo: (event.beo as object | null) ?? { kitchen: '', service: '', housekeeping: '' },
        beoVersion: 1,
      },
    });
    await writeAudit(tx, ctx, {
      action: 'banquet.confirmed',
      entityType: 'banquet_event',
      entityId: id,
      before: { status: event.status },
      after: { status: to, advance: paid, total: totals.total },
    });
    await tell(tx, ctx, 'banquet.confirmed', place, after, { amount: formatINR(BigInt(totals.total)) });
    return after;
  });
  return eventView(db, place, row);
}

export const eventQuery = z.object({
  branchId: z.string().min(1),
  status: z.enum(['ENQUIRY', 'QUOTED', 'CONFIRMED', 'COMPLETED', 'CLOSED', 'LOST', 'CANCELLED']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export async function listEvents(db: Db, actor: Actor, q: z.infer<typeof eventQuery>) {
  seer(actor);
  const place = await placeOf(db, actor, q.branchId);
  const rows = await db.banquetEvent.findMany({
    where: {
      companyId: actor.companyId,
      branchId: q.branchId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.from ? { day: { gte: q.from } } : {}),
    },
    orderBy: [{ day: 'asc' }, { startMin: 'asc' }],
    take: 300,
  });
  const out = [];
  for (const e of rows) out.push(await eventView(db, place, e));
  return { today: place.today, events: out };
}
export async function getEvent(db: Db, actor: Actor, id: string) {
  seer(actor);
  const { event, place } = await eventOf(db, actor, id);
  return eventView(db, place, event);
}
