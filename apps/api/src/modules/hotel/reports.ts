import type { Db } from '@mono/db';
import { addDays, isForeign, stayNights, type Kyc } from '@mono/shared';
import { z } from 'zod';
import type { Actor } from '../work/actor';
import type { AuditPack } from './audit';
import { hotelFor, hotelOf, seer } from './core';
import { releaseBlock } from './blocks';
import { tell } from './bookings';
import { releaseFixedRooms } from './maintenance';

/**
 * Phase 17 — the registers a hotel must keep and the numbers it watches: the guest (police) register, the Form C
 * list for foreign guests with a file for the FRRO portal, and occupancy by day from the night audits.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const registerQuery = z.object({ branchId: z.string().min(1), from: day, to: day });

async function registerRows(db: Db, companyId: string, q: z.infer<typeof registerQuery>) {
  const stays = await db.stay.findMany({
    where: {
      companyId,
      branchId: q.branchId,
      status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
      arrive: { lte: q.to },
      depart: { gte: q.from },
    },
    orderBy: [{ checkedInAt: 'asc' }, { number: 'asc' }],
    take: 2000,
  });
  const [guests, nights, rooms] = await Promise.all([
    db.guest.findMany({ where: { id: { in: stays.map((s) => s.guestId) } } }),
    db.roomNight.findMany({ where: { stayId: { in: stays.map((s) => s.id) } }, orderBy: { day: 'asc' } }),
    db.room.findMany({ where: { companyId, branchId: q.branchId } }),
  ]);
  return stays.map((s) => {
    const k = ((s.kyc as Kyc | null) ?? {}) as Partial<Kyc>;
    const g = guests.find((x) => x.id === s.guestId);
    const roomIds = [...new Set(nights.filter((n) => n.stayId === s.id).map((n) => n.roomId))];
    return {
      number: s.number,
      name: g?.name ?? '',
      mobile: g?.mobile ?? '',
      nationality: k.nationality ?? '',
      foreign: isForeign(k.nationality),
      idType: k.idType ?? '',
      idNumber: k.idNumber ?? '',
      address: k.address ?? '',
      rooms: roomIds
        .map((id) => rooms.find((r) => r.id === id)?.number ?? '')
        .filter(Boolean)
        .join(', '),
      adults: s.adults,
      children: s.children,
      arrive: s.arrive,
      depart: s.depart,
      checkedInAt: s.checkedInAt,
      checkedOutAt: s.checkedOutAt,
      arrivedFrom: k.arrivedFrom ?? '',
      nextDestination: k.nextDestination ?? '',
      purpose: k.purpose ?? '',
      passportNo: k.passportNo ?? '',
      visaNo: k.visaNo ?? '',
      visaExpiry: k.visaExpiry ?? '',
      arrivedIndiaOn: k.arrivedIndiaOn ?? '',
      formCFiledAt: s.formCFiledAt,
    };
  });
}

/** Everyone who stayed between two days, as the guest register wants them. */
export async function guestRegister(db: Db, actor: Actor, q: z.infer<typeof registerQuery>) {
  seer(actor);
  await hotelOf(db, actor, q.branchId);
  return registerRows(db, actor.companyId, q);
}

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
/** The foreign guests of a span as a file to type into (or upload to) the FRRO portal. */
export async function formCExport(db: Db, actor: Actor, q: z.infer<typeof registerQuery>) {
  seer(actor);
  await hotelOf(db, actor, q.branchId);
  const rows = (await registerRows(db, actor.companyId, q)).filter((r) => r.foreign);
  return csv([
    [
      'Booking',
      'Name',
      'Nationality',
      'Passport no',
      'Visa no',
      'Visa expiry',
      'Arrived in India',
      'Arrived from',
      'Next destination',
      'Purpose',
      'Room',
      'Check-in',
      'Check-out',
      'Address',
      'Filed',
    ],
    ...rows.map((r) => [
      r.number,
      r.name,
      r.nationality,
      r.passportNo,
      r.visaNo,
      r.visaExpiry,
      r.arrivedIndiaOn,
      r.arrivedFrom,
      r.nextDestination,
      r.purpose,
      r.rooms,
      r.arrive,
      r.depart,
      r.address,
      r.formCFiledAt ? 'yes' : 'no',
    ]),
  ]);
}

/** Occupancy, average rate and revenue per room, day by day, from the night audits; the span's totals. */
export async function occupancy(db: Db, actor: Actor, q: z.infer<typeof registerQuery>) {
  seer(actor);
  await hotelOf(db, actor, q.branchId);
  const packs = (
    await db.nightAudit.findMany({
      where: { companyId: actor.companyId, branchId: q.branchId, day: { gte: q.from, lte: q.to } },
      orderBy: { day: 'asc' },
    })
  ).map((a) => a.pack as AuditPack);
  const sum = (f: (p: AuditPack) => number) => packs.reduce((n, p) => n + f(p), 0);
  const sellable = sum((p) => p.rooms - p.outOfOrder);
  const sold = sum((p) => p.sold);
  const revenue = sum((p) => p.roomRevenue);
  return {
    days: packs.map((p) => ({
      day: p.day,
      sold: p.sold,
      rooms: p.rooms - p.outOfOrder,
      occupancyPct: p.occupancyPct,
      adr: p.adr,
      revPar: p.revPar,
      roomRevenue: p.roomRevenue,
    })),
    total: {
      nights: stayNights(q.from, addDays(q.to, 1)).length,
      audited: packs.length,
      sold,
      occupancyPct: sellable ? Math.round((sold / sellable) * 1000) / 10 : 0,
      adr: sold ? Math.round(revenue / sold) : 0,
      revPar: sellable ? Math.round(revenue / sellable) : 0,
      roomRevenue: revenue,
    },
  };
}

/**
 * What the clock does for hotels (worker, every few minutes): a group block past its release date gives its
 * rooms back; a foreign guest whose Form C is not filed is flagged to the managers once, six hours before it is due; a room whose
 * maintenance ticket has closed comes back.
 */
export async function hotelSweep(db: Db, now = new Date(), onlyCompanyId?: string) {
  const scope = onlyCompanyId ? { companyId: onlyCompanyId } : {};
  const out = { released: 0, formC: 0, rooms: 0 };
  for (const b of await db.groupBlock.findMany({ where: { ...scope, status: 'HELD' }, take: 500 })) {
    const hotel = await hotelFor(db, b.companyId, b.branchId);
    if (hotel.businessDate <= b.releaseOn) continue;
    await releaseBlock(db, b.companyId, b.id, null);
    out.released++;
  }
  const due = await db.stay.findMany({
    where: {
      ...scope,
      status: 'CHECKED_IN',
      formCFiledAt: null,
      formCReminded: false,
      formCDueAt: { lte: new Date(now.getTime() + 6 * 3_600_000) },
    },
    take: 200,
  });
  for (const s of due) {
    const hotel = await hotelFor(db, s.companyId, s.branchId);
    await db.$transaction(async (tx) => {
      await tx.stay.update({ where: { id: s.id }, data: { formCReminded: true } });
      await tell(tx, { companyId: s.companyId, actorId: null }, 'hotel.form_c_due', hotel, s, {
        hours: hotel.rules.formCHours,
      });
    });
    out.formC++;
  }
  out.rooms = await releaseFixedRooms(db, onlyCompanyId);
  return out;
}
