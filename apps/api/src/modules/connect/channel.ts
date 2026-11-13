import type { Connection, Db } from '@mono/db';
import { ariRows, channelBookingSchema, guestMobile, nightRate, type ChannelBooking } from '@mono/shared';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { need } from '../hosp/access';
import { bookStayIn, releaseBooking } from '../hotel/bookings';
import { hotelFor, hotelOf, lockHotel } from '../hotel/core';
import { inventory, planRules } from '../hotel/rates';
import { changeDatesIn } from '../hotel/tape';
import type { Actor } from '../work/actor';
import { callOut, logIn, metaOf, needConnection, type Net } from './core';

/**
 * Phase 19 — the channel manager of a property. MONO pushes each mapped room type's availability, price and
 * restrictions for a span of days, and takes in the bookings, changes and cancellations the channels made. The
 * adapter speaks one plain JSON contract (POST {base}/ari, GET {base}/bookings, a webhook to MONO); a real
 * channel manager's own API is mapped onto it by a small adapter — none has been certified.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const pushSchema = z.object({ branchId: z.string().min(1), from: day, to: day });

export async function pushAri(db: Db, net: Net, actor: Actor, input: z.input<typeof pushSchema>) {
  need(actor, 'hosp.edit', 'Only a manager sends rates and availability to the channels');
  const p = pushSchema.parse(input);
  const hotel = await hotelOf(db, actor, p.branchId);
  if (p.to <= p.from) throw new AppError(400, 'VALIDATION_FAILED', 'The last day is after the first');
  const conn = await needConnection(db, net, actor.companyId, 'CHANNEL', p.branchId, 'The channel manager');
  const meta = metaOf(conn);
  if (!meta.rooms?.length)
    throw new AppError(409, 'CONFLICT', 'Map at least one room type to the channel first');
  const plan = meta.defaultPlanId
    ? await db.ratePlan.findFirst({
        where: { id: meta.defaultPlanId, companyId: actor.companyId, deletedAt: null },
      })
    : null;
  const types = await db.roomType.findMany({ where: { companyId: actor.companyId, branchId: p.branchId } });
  const rows = ariRows(
    await inventory(db, hotel, p.from, p.to),
    (roomTypeId, d) => {
      const t = types.find((x) => x.id === roomTypeId);
      return plan && t
        ? nightRate(
            planRules(plan),
            roomTypeId,
            d,
            { adults: t.occupancy, children: 0, occupancy: t.occupancy },
            1,
          )
        : null;
    },
    { rooms: meta.rooms, rateCode: meta.plans?.find((x) => x.ratePlanId === plan?.id)?.code ?? null },
  );
  const out = await callOut(db, net, conn, {
    what: 'ari',
    ref: `${p.from}..${p.to}`,
    url: `${conn.baseUrl!.replace(/\/$/, '')}/ari`,
    headers: { authorization: `Bearer ${conn.keys.token ?? ''}` },
    body: { property: hotel.name, rows },
    retry: true,
  });
  return { sent: rows.length, ok: out.ok, error: out.error };
}

/** Pushes that did not go through are sent again (worker): every five minutes, five tries. */
export async function retryPushes(db: Db, net: Net, now = new Date(), onlyCompanyId?: string) {
  const due = await db.syncLog.findMany({
    where: {
      status: 'PENDING',
      direction: 'OUT',
      nextTryAt: { lte: now },
      ...(onlyCompanyId ? { companyId: onlyCompanyId } : {}),
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let sent = 0;
  for (const log of due) {
    const conn = await db.connection.findUnique({ where: { id: log.connectionId } });
    const saved = log.payload as { url?: string; method?: 'GET' | 'POST'; body?: unknown } | null;
    if (!conn?.active || !saved?.url) {
      await db.syncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', nextTryAt: null, error: log.error ?? 'The connection is off' },
      });
      continue;
    }
    const opened = await needConnection(db, net, conn.companyId, conn.kind as 'CHANNEL', conn.scope);
    const out = await callOut(db, net, conn, {
      what: log.what,
      ref: log.ref,
      url: saved.url,
      method: saved.method,
      headers: { authorization: `Bearer ${opened.keys.token ?? ''}` },
      body: saved.body,
      retry: true,
      logId: log.id,
    });
    if (out.ok) sent++;
  }
  return sent;
}

/**
 * A booking, change or cancellation from a channel. The channel's reference makes it happen once; a booking a
 * channel already sold is always taken — when no room is left it is flagged as overbooked for a person to solve.
 */
export async function applyChannelBooking(db: Db, conn: Connection, input: unknown) {
  const parsed = channelBookingSchema.safeParse(input);
  if (!parsed.success) {
    await logIn(db, conn, 'booking', null, false, 'The booking could not be read', input);
    throw new AppError(400, 'VALIDATION_FAILED', 'The booking could not be read');
  }
  const b: ChannelBooking = parsed.data;
  const fail = async (message: string, status = 409) => {
    await logIn(db, conn, 'booking', b.ref, false, message);
    return new AppError(status, status === 404 ? 'NOT_FOUND' : 'CONFLICT', message);
  };
  const meta = metaOf(conn);
  const hotel = await hotelFor(db, conn.companyId, conn.scope);
  const ctx = { companyId: conn.companyId, actorId: null };
  const had = await db.stay.findUnique({
    where: { companyId_channelRef: { companyId: conn.companyId, channelRef: b.ref } },
  });
  if (b.status === 'cancelled') {
    if (!had) throw await fail(`Booking ${b.ref} is not known here`, 404);
    if (had.status === 'BOOKED')
      await db.$transaction(async (tx) => {
        await lockHotel(tx, hotel.branchId);
        await releaseBooking(tx, ctx, hotel, had, 'CANCEL', 'system', `Cancelled on ${b.channel}`);
      });
    else if (had.status !== 'CANCELLED')
      throw await fail(
        `Booking ${had.number} is ${had.status.toLowerCase().replace('_', ' ')} — cancel it at the desk`,
      );
    await logIn(db, conn, 'booking', b.ref, true);
    return { number: had.number, status: 'CANCELLED', overbooked: false };
  }
  if (had && b.status === 'new') {
    await logIn(db, conn, 'booking', b.ref, true, 'Already taken in');
    return { number: had.number, status: had.status, overbooked: had.overbooked, again: true };
  }
  if (had) {
    if (had.status !== 'BOOKED')
      throw await fail(`Booking ${had.number} can no longer be changed from a channel`);
    try {
      await db.$transaction(async (tx) => {
        await lockHotel(tx, hotel.branchId);
        await changeDatesIn(tx, ctx, hotel, had, b.arrive, b.depart);
        await tx.stay.update({ where: { id: had.id }, data: { adults: b.adults, children: b.children } });
      });
    } catch (e) {
      throw await fail(e instanceof Error ? e.message : 'The change could not be made');
    }
    await logIn(db, conn, 'booking', b.ref, true);
    return { number: had.number, status: 'BOOKED', overbooked: had.overbooked };
  }
  const roomTypeId = meta.rooms?.find((r) => r.code === b.room)?.roomTypeId;
  if (!roomTypeId) throw await fail(`Room ${b.room} is not mapped to a room type`);
  const ratePlanId = meta.plans?.find((x) => x.code === b.rate)?.ratePlanId ?? meta.defaultPlanId;
  if (!ratePlanId) throw await fail('No rate plan is mapped for channel bookings');
  const phone = guestMobile.safeParse(b.guest.phone ?? '');
  try {
    const made = await db.$transaction((tx) =>
      bookStayIn(
        tx,
        ctx,
        hotel,
        {
          branchId: hotel.branchId,
          ratePlanId,
          roomTypeId,
          arrive: b.arrive < hotel.businessDate ? hotel.businessDate : b.arrive,
          depart: b.depart,
          adults: b.adults,
          children: b.children,
          // A channel that gives no phone still gets one guest per booking.
          guest: {
            mobile: phone.success
              ? phone.data
              : `+000${b.ref.replace(/\D/g, '').padStart(8, '0').slice(-12)}`,
            name: b.guest.name,
            email: b.guest.email || null,
          },
          kind: 'INDIVIDUAL',
          source: 'OTA',
          note: [b.channel, b.total != null ? `sold for ₹${(b.total / 100).toFixed(2)}` : null, b.note]
            .filter(Boolean)
            .join(' · '),
        },
        { channel: b.channel, ref: b.ref },
      ),
    );
    await logIn(
      db,
      conn,
      'booking',
      b.ref,
      true,
      made.overbooked ? 'Overbooked — no room of that type is left' : null,
    );
    return { number: made.number, status: 'BOOKED', overbooked: made.overbooked };
  } catch (e) {
    throw await fail(e instanceof Error ? e.message : 'The booking could not be made');
  }
}

/** Ask the channel manager for what happened since the last time (for one that does not call our webhook). */
export async function pullBookings(db: Db, net: Net, actor: Actor, branchId: string) {
  need(actor, 'hosp.edit', 'Only a manager pulls bookings from the channels');
  await hotelOf(db, actor, branchId);
  const conn = await needConnection(db, net, actor.companyId, 'CHANNEL', branchId, 'The channel manager');
  const last = await db.syncLog.findFirst({
    where: { connectionId: conn.id, what: 'pull', status: 'OK' },
    orderBy: { createdAt: 'desc' },
  });
  const out = await callOut(db, net, conn, {
    what: 'pull',
    url: `${conn.baseUrl!.replace(/\/$/, '')}/bookings?since=${encodeURIComponent((last?.createdAt ?? new Date(0)).toISOString())}`,
    method: 'GET',
    headers: { authorization: `Bearer ${conn.keys.token ?? ''}` },
  });
  if (!out.ok) throw new AppError(409, 'CONFLICT', out.error ?? 'The channel manager did not answer');
  const list = Array.isArray(out.json)
    ? out.json
    : ((out.json as { bookings?: unknown[] } | null)?.bookings ?? []);
  const results = { taken: 0, failed: 0, overbooked: 0 };
  for (const item of list) {
    try {
      const r = await applyChannelBooking(db, conn, item);
      results.taken++;
      if (r.overbooked) results.overbooked++;
    } catch {
      results.failed++;
    }
  }
  return results;
}

/** Bookings a channel sold with no room left: for a person to move, upgrade or relocate. */
export async function overbooked(db: Db, actor: Actor, branchId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const hotel = await hotelOf(db, actor, branchId);
  const stays = await db.stay.findMany({
    where: {
      companyId: actor.companyId,
      branchId,
      overbooked: true,
      status: 'BOOKED',
      depart: { gte: hotel.businessDate },
    },
    orderBy: { arrive: 'asc' },
  });
  const guests = await db.guest.findMany({ where: { id: { in: stays.map((s) => s.guestId) } } });
  return stays.map((s) => ({
    id: s.id,
    number: s.number,
    channel: s.channel,
    channelRef: s.channelRef,
    arrive: s.arrive,
    depart: s.depart,
    guest: guests.find((g) => g.id === s.guestId)?.name ?? '',
  }));
}
