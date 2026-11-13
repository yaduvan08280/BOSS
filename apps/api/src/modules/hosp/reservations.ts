import type { Db, Guest, Reservation, Tx } from '@mono/db';
import { nextCounter } from '@mono/db';
import {
  addDays,
  depositFor,
  durationFor,
  fitTables,
  localDate,
  overlaps,
  reservationMachine,
  reservationPatchSchema,
  reservationSchema,
  slotLabel,
  slotsOf,
  transition,
  zonedToUtc,
  HOLDING_STATUSES,
  type ReservationStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit, type ActorContext } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, need, outletOf } from './access';
import {
  bookedTables,
  guestFor,
  lockOutlet,
  needBookable,
  newToken,
  outletTables,
  resNumber,
  resOutlet,
  tellGuest,
  whenOf,
  type ResOutlet,
} from './res-core';

/**
 * Phase 16 — the reservation book. A booking takes its table(s) for its time: the best fit unless a person
 * chooses, never a table that is already booked for any part of that time.
 */
export const host = (a: Actor) => need(a, 'hosp.create', "You can't take bookings");
/** The outlet, for a signed-in person: it must be one of their branches'. */
export async function staffOutlet(db: Db | Tx, actor: Actor, outletId: string): Promise<ResOutlet> {
  await outletOf(db, actor.companyId, outletId);
  const o = await resOutlet(db, { id: outletId, companyId: actor.companyId });
  if (!o) throw new AppError(409, 'CONFLICT', 'Hospitality is not switched on for this company');
  return o;
}
/** A slot of a day → its instant (slots past 1440 are after midnight). */
export const instantOf = (outlet: ResOutlet, day: string, min: number) =>
  zonedToUtc(addDays(day, Math.floor(min / 1440)), min % 1440, outlet.tz);

type TableRow = Awaited<ReturnType<typeof outletTables>>[number];
export function resView(r: Reservation, guest: Guest | undefined, tables: TableRow[]) {
  return {
    id: r.id,
    number: resNumber(r.number),
    outletId: r.outletId,
    day: r.day,
    startMin: r.startMin,
    time: slotLabel(r.startMin),
    durationMin: r.durationMin,
    startAt: r.startAt,
    endAt: r.endAt,
    partySize: r.partySize,
    tableIds: r.tableIds,
    tables: r.tableIds.map((id) => tables.find((t) => t.id === id)?.name ?? '?'),
    status: r.status as ReservationStatus,
    source: r.source,
    occasion: r.occasion,
    requests: r.requests,
    note: r.note,
    deposit: r.depositState
      ? { amount: Number(r.depositDue), state: r.depositState, billId: r.depositBillId }
      : null,
    orderId: r.orderId,
    cancelReason: r.cancelReason,
    guest: guest
      ? {
          id: guest.id,
          name: guest.name,
          mobile: guest.mobile,
          allergies: guest.allergies,
          preferences: guest.preferences,
          tags: guest.tags,
        }
      : null,
  };
}
export async function viewOf(db: Db | Tx, r: Reservation) {
  const [guest, tables] = await Promise.all([
    db.guest.findFirst({ where: { id: r.guestId } }),
    outletTables(db, { id: r.outletId, companyId: r.companyId }),
  ]);
  return resView(r, guest ?? undefined, tables);
}

/** The slots of a day for a party: which are free, and with which table(s). */
export async function availability(
  db: Db | Tx,
  outlet: ResOutlet,
  day: string,
  size: number,
  exceptId?: string,
) {
  const durationMin = durationFor(outlet.booking, size);
  const slots = slotsOf(outlet.booking, outlet.openMin, outlet.closeMin);
  const tables = await outletTables(db, outlet);
  const from = instantOf(outlet, day, 0);
  const held = await db.reservation.findMany({
    where: {
      companyId: outlet.companyId,
      outletId: outlet.id,
      status: { in: [...HOLDING_STATUSES] },
      startAt: { lt: new Date(from.getTime() + 3 * 86_400_000) },
      endAt: { gt: from },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { tableIds: true, startAt: true, endAt: true },
  });
  const now = Date.now();
  return {
    day,
    size,
    durationMin,
    deposit: depositFor(outlet.booking, size),
    slots: slots.map((startMin) => {
      const start = instantOf(outlet, day, startMin).getTime();
      const end = start + durationMin * 60_000;
      const busy = new Set(
        held
          .filter((h) => overlaps(start, end, h.startAt.getTime(), h.endAt.getTime()))
          .flatMap((h) => h.tableIds),
      );
      const fit = start > now ? fitTables(tables, size, busy) : null;
      return { startMin, time: slotLabel(startMin), free: Boolean(fit), tableIds: fit };
    }),
  };
}

type BookInput = z.infer<typeof reservationSchema>;
/** Make a booking (in a transaction that holds the outlet's lock). `staff`: a host made it, not the public page. */
export async function bookIn(tx: Tx, ctx: ActorContext, outlet: ResOutlet, o: BookInput, staff: boolean) {
  const b = outlet.booking;
  const today = localDate(new Date(), outlet.tz);
  const startAt = instantOf(outlet, o.day, o.startMin);
  if (!staff) {
    if (!b.online) throw new AppError(404, 'NOT_FOUND', 'Online booking is not open');
    if (o.day < today || o.day > addDays(today, b.aheadDays))
      throw new AppError(400, 'VALIDATION_FAILED', `Bookings open ${b.aheadDays} days ahead`);
    if (o.partySize > b.maxOnline)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `For more than ${b.maxOnline} guests please call ${outlet.name}`,
      );
    if (!slotsOf(b, outlet.openMin, outlet.closeMin).includes(o.startMin))
      throw new AppError(400, 'VALIDATION_FAILED', 'Choose one of the times offered');
  }
  if (startAt.getTime() < Date.now() - (staff ? 60 : 0) * 60_000)
    throw new AppError(400, 'VALIDATION_FAILED', 'That time has passed');
  const durationMin = (staff && o.durationMin) || durationFor(b, o.partySize);
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  await lockOutlet(tx, outlet.id);
  const tableIds = await tablesFor(tx, outlet, startAt, endAt, o.partySize, staff ? o.tableIds : undefined);
  const guest = await guestFor(tx, outlet.companyId, o.guest);
  const deposit = depositFor(b, o.partySize);
  const confirmed = deposit === 0 && (staff || b.autoConfirm);
  const status = confirmed
    ? transition(reservationMachine, {
        from: 'REQUESTED',
        action: 'confirm',
        roles: [staff ? 'staff' : 'system'],
        ctx: { depositDue: false, pastHold: false },
      }).to
    : 'REQUESTED';
  const row = await tx.reservation.create({
    data: {
      companyId: outlet.companyId,
      branchId: outlet.branchId,
      outletId: outlet.id,
      number: await nextCounter(tx, outlet.companyId, 'reservation'),
      guestId: guest.id,
      day: o.day,
      startMin: o.startMin,
      durationMin,
      startAt,
      endAt,
      partySize: o.partySize,
      tableIds,
      status,
      source: staff ? o.source : 'ONLINE',
      occasion: o.occasion ?? null,
      requests: o.requests ?? null,
      note: staff ? (o.note ?? null) : null,
      depositDue: BigInt(deposit),
      depositState: deposit ? 'DUE' : null,
      token: newToken(),
      createdById: ctx.actorId,
    },
  });
  await writeAudit(tx, ctx, {
    action: 'reservation.made',
    entityType: 'reservation',
    entityId: row.id,
    after: { number: row.number, when: whenOf(row), size: o.partySize, tableIds, status, source: row.source },
  });
  await tellGuest(
    tx,
    ctx,
    deposit ? 'reservation.deposit_due' : confirmed ? 'reservation.confirmed' : 'reservation.requested',
    outlet,
    row,
    guest,
  );
  return { row, guest };
}

/** The tables for a span: the ones a person chose (each must be free), or the best fit. */
async function tablesFor(
  tx: Tx,
  outlet: ResOutlet,
  startAt: Date,
  endAt: Date,
  size: number,
  chosen: string[] | undefined,
  exceptId?: string,
) {
  const tables = await outletTables(tx, outlet);
  const busy = await bookedTables(tx, outlet, startAt, endAt, exceptId);
  if (chosen?.length) {
    const ids = [...new Set(chosen)];
    for (const id of ids) {
      const t = tables.find((x) => x.id === id);
      if (!t) throw new AppError(400, 'VALIDATION_FAILED', 'A table is not one of this outlet’s');
      if (busy.has(id)) throw new AppError(409, 'CONFLICT', `${t.name} is already booked for that time`);
    }
    return ids;
  }
  const fit = fitTables(tables, size, busy);
  if (!fit) throw new AppError(409, 'CONFLICT', `No table is free for ${size} at that time`);
  return fit;
}

export async function makeReservation(db: Db, actor: Actor, input: z.input<typeof reservationSchema>) {
  host(actor);
  const o = reservationSchema.parse(input);
  const outlet = await staffOutlet(db, actor, o.outletId);
  const { row } = await db.$transaction((tx) => bookIn(tx, ctxOf(actor), outlet, o, true));
  return viewOf(db, row);
}

export const changeSchema = reservationPatchSchema.extend({
  /** A deposit asked (or changed) by hand, minor units; 0 = none. Only while it is not yet paid. */
  depositDue: z.number().int().min(0).max(1e12).optional(),
});
const OPEN: ReservationStatus[] = ['REQUESTED', 'CONFIRMED', 'REMINDED', 'ARRIVED'];
/** Change a booking that has not been seated: a new time, size or table is checked like a new booking. */
export async function changeReservation(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof changeSchema>,
) {
  host(actor);
  const p = changeSchema.parse(input);
  const before = await db.reservation.findFirst({ where: { id, companyId: actor.companyId } });
  if (!before) throw notFound('Reservation');
  const outlet = await staffOutlet(db, actor, before.outletId);
  if (!OPEN.includes(before.status as ReservationStatus))
    throw new AppError(409, 'CONFLICT', 'This booking can no longer be changed');
  const day = p.day ?? before.day;
  const startMin = p.startMin ?? before.startMin;
  const partySize = p.partySize ?? before.partySize;
  const durationMin =
    p.durationMin ??
    (partySize === before.partySize ? before.durationMin : durationFor(outlet.booking, partySize));
  const startAt = instantOf(outlet, day, startMin);
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);
  const moved =
    startAt.getTime() !== before.startAt.getTime() ||
    endAt.getTime() !== before.endAt.getTime() ||
    partySize !== before.partySize;
  const after = await db.$transaction(async (tx) => {
    await lockOutlet(tx, outlet.id);
    let tableIds = before.tableIds;
    if (p.tableIds?.length) tableIds = await tablesFor(tx, outlet, startAt, endAt, partySize, p.tableIds, id);
    else if (moved) {
      // Keep the same table(s) when they are still free and still seat the party; otherwise the best fit.
      const busy = await bookedTables(tx, outlet, startAt, endAt, id);
      const tables = await outletTables(tx, outlet);
      const seats = before.tableIds.reduce((n, t) => n + (tables.find((x) => x.id === t)?.seats ?? 0), 0);
      const keep = before.tableIds.length && before.tableIds.every((t) => !busy.has(t)) && seats >= partySize;
      if (!keep) tableIds = await tablesFor(tx, outlet, startAt, endAt, partySize, undefined, id);
    }
    const unpaid = before.depositState === null || before.depositState === 'DUE';
    const deposit =
      p.depositDue !== undefined
        ? p.depositDue
        : unpaid && partySize !== before.partySize
          ? depositFor(outlet.booking, partySize)
          : Number(before.depositDue);
    if (p.depositDue !== undefined && !unpaid)
      throw new AppError(409, 'CONFLICT', 'The deposit is already paid');
    const row = await tx.reservation.update({
      where: { id },
      data: {
        day,
        startMin,
        durationMin,
        startAt,
        endAt,
        partySize,
        tableIds,
        ...(unpaid ? { depositDue: BigInt(deposit), depositState: deposit ? 'DUE' : null } : {}),
        ...(moved ? { remindedAt: null } : {}),
        ...('occasion' in p ? { occasion: p.occasion ?? null } : {}),
        ...('requests' in p ? { requests: p.requests ?? null } : {}),
        ...('note' in p ? { note: p.note ?? null } : {}),
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'reservation.changed',
      entityType: 'reservation',
      entityId: id,
      before: { when: whenOf(before), size: before.partySize, tableIds: before.tableIds },
      after: { when: whenOf(row), size: row.partySize, tableIds: row.tableIds },
    });
    return row;
  });
  return viewOf(db, after);
}

/** The book of a day at an outlet: every booking in time order, and how full the day is. */
export async function book(db: Db, actor: Actor, outletId: string, day?: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await staffOutlet(db, actor, outletId);
  const on = day ?? localDate(new Date(), outlet.tz);
  const [rows, tables] = await Promise.all([
    db.reservation.findMany({
      where: { companyId: actor.companyId, outletId, day: on },
      orderBy: [{ startMin: 'asc' }, { number: 'asc' }],
    }),
    outletTables(db, outlet),
  ]);
  const guests = new Map(
    (await db.guest.findMany({ where: { id: { in: rows.map((r) => r.guestId) } } })).map((g) => [g.id, g]),
  );
  const live = rows.filter((r) => !['CANCELLED', 'NO_SHOW'].includes(r.status));
  return {
    outlet: { id: outlet.id, name: outlet.name },
    day: on,
    today: localDate(new Date(), outlet.tz),
    booking: outlet.booking,
    bookingToken: outlet.bookingToken,
    tables: tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, combinable: t.combinable })),
    counts: {
      bookings: live.length,
      covers: live.reduce((n, r) => n + r.partySize, 0),
      toConfirm: rows.filter((r) => r.status === 'REQUESTED').length,
      noShows: rows.filter((r) => r.status === 'NO_SHOW').length,
    },
    reservations: rows.map((r) => resView(r, guests.get(r.guestId), tables)),
  };
}

export async function getReservation(db: Db, actor: Actor, id: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const r = await db.reservation.findFirst({ where: { id, companyId: actor.companyId } });
  if (!r) throw notFound('Reservation');
  await staffOutlet(db, actor, r.outletId);
  return viewOf(db, r);
}

export { needBookable };
