import type { Db } from '@mono/db';
import { addDays, auditStats, type RoomHkStatus } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { releaseBooking } from './bookings';
import { dmy, hotelOf, lockHotel, seer, supervisor } from './core';
import { postCharge } from './folio-core';
import { planDay } from './housekeeping';

/**
 * Phase 17 — the night audit closes the hotel's day: bookings that never arrived become no-shows (with the
 * plan's charge), tonight's room charge goes on every guest's folio, what is still open is listed, the figures of
 * the day are kept (occupancy, average rate, revenue per room, revenue by outlet, money by mode), tomorrow's
 * housekeeping is laid out, and the business date moves on. Once a day, and never twice.
 */
export type AuditPack = {
  day: string;
  rooms: number;
  outOfOrder: number;
  sold: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  roomRevenue: number;
  arrivals: number;
  departures: number;
  noShows: { number: string; guest: string; charge: number }[];
  revenueByOutlet: { outlet: string; bills: number; amount: number }[];
  money: { mode: string; amount: number }[];
  /** Things a manager should look at in the morning. */
  checks: {
    dueOuts: { number: string; room: string | null }[];
    openFoliosOfDeparted: { number: string; folio: string }[];
    unpaidRestaurantBills: number;
  };
};

export async function nightAudit(db: Db, actor: Actor, branchId: string) {
  supervisor(actor);
  const hotel = await hotelOf(db, actor, branchId);
  const ctx = ctxOf(actor);
  const day = hotel.businessDate;
  const where = { companyId: actor.companyId, branchId };
  const pack = await db.$transaction(
    async (tx) => {
      await lockHotel(tx, branchId);
      if (await tx.nightAudit.count({ where: { branchId, day } }))
        throw new AppError(409, 'CONFLICT', `The night audit of ${dmy(day)} is already done`);
      // 1. Bookings that should have arrived by today and did not.
      const noShows: AuditPack['noShows'] = [];
      for (const s of await tx.stay.findMany({
        where: { ...where, status: 'BOOKED', arrive: { lte: day } },
      })) {
        const out = await releaseBooking(tx, ctx, hotel, s, 'NO_SHOW', 'system', 'Did not arrive');
        const guest = await tx.guest.findFirstOrThrow({ where: { id: s.guestId } });
        noShows.push({ number: s.number, guest: guest.name, charge: out.charge });
      }
      // 2. Tonight's room charge for everyone in the house.
      const inHouse = await tx.stay.findMany({ where: { ...where, status: 'CHECKED_IN' } });
      const rooms = await tx.room.findMany({ where: { ...where, deletedAt: null } });
      const types = await tx.roomType.findMany({ where });
      let roomRevenue = 0;
      let sold = 0;
      for (const s of inHouse) {
        const night = await tx.roomNight.findFirst({ where: { stayId: s.id, day, posted: false } });
        if (!night) continue;
        const room = rooms.find((r) => r.id === night.roomId);
        const type = types.find((t) => t.id === night.roomTypeId);
        await postCharge(tx, ctx, hotel, s, {
          kind: 'ROOM',
          text: `Room ${room?.number ?? ''} — ${dmy(day)} (${s.meal})`,
          amount: Number(night.rate),
          taxCode: type?.taxCode ?? hotel.rules.roomTaxCode ?? null,
          hsn: '996311',
          refType: 'room_night',
          refId: night.id,
        });
        await tx.roomNight.update({ where: { id: night.id }, data: { posted: true } });
        // A room slept in needs cleaning in the morning.
        if (room && !['OUT_OF_ORDER', 'OUT_OF_SERVICE'].includes(room.hkStatus as RoomHkStatus))
          await tx.room.update({ where: { id: room.id }, data: { hkStatus: 'DIRTY' } });
        roomRevenue += Number(night.rate);
        sold++;
      }
      // 3. What is still open.
      const dueOuts = inHouse.filter((s) => s.depart <= day);
      const nightsOfDue = await tx.roomNight.findMany({
        where: { stayId: { in: dueOuts.map((s) => s.id) }, day },
      });
      const departed = await tx.stay.findMany({
        where: { ...where, status: { in: ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] } },
        select: { id: true, number: true },
      });
      const openFolios = await tx.folio.findMany({
        where: { ...where, status: 'OPEN', stayId: { in: departed.map((d) => d.id) } },
      });
      const withLines = [];
      for (const f of openFolios)
        if (await tx.folioLine.count({ where: { folioId: f.id, voided: false } })) withLines.push(f);
      const outlets = await tx.outlet.findMany({ where: { ...where, deletedAt: null } });
      const checks = await tx.posCheck.findMany({
        where: { companyId: actor.companyId, outletId: { in: outlets.map((o) => o.id) }, businessDay: day },
      });
      const outOfOrder = await tx.roomNight.count({ where: { ...where, day, blockId: { not: null } } });
      // Money taken at this property on its business date, by mode.
      const money = await tx.bill.findMany({
        where: { ...where, date: day, type: { in: ['RECEIPT', 'ADVANCE'] }, status: { not: 'CANCELLED' } },
        select: { modeId: true, total: true },
      });
      const modes = await tx.paymentMode.findMany({ where: { companyId: actor.companyId } });
      const byMode = new Map<string, number>();
      for (const m of money) {
        const name = modes.find((x) => x.id === m.modeId)?.name ?? 'Other';
        byMode.set(name, (byMode.get(name) ?? 0) + Number(m.total));
      }
      const stats = auditStats({ rooms: rooms.length, outOfOrder, sold, roomRevenue });
      const result: AuditPack = {
        day,
        rooms: rooms.length,
        outOfOrder,
        sold,
        occupancyPct: stats.occupancyPct,
        adr: stats.adr,
        revPar: stats.revPar,
        roomRevenue,
        arrivals: await tx.stay.count({
          where: { ...where, arrive: day, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
        }),
        departures: await tx.stay.count({ where: { ...where, depart: day, status: 'CHECKED_OUT' } }),
        noShows,
        revenueByOutlet: outlets
          .map((o) => {
            const mine = checks.filter((c) => c.outletId === o.id && c.status !== 'CANCELLED');
            return {
              outlet: o.name,
              bills: mine.length,
              amount: mine.reduce((n, c) => n + Number(c.total), 0),
            };
          })
          .filter((o) => o.bills > 0),
        money: [...byMode].map(([mode, amount]) => ({ mode, amount })),
        checks: {
          dueOuts: dueOuts.map((s) => ({
            number: s.number,
            room:
              rooms.find((r) => r.id === nightsOfDue.find((n) => n.stayId === s.id)?.roomId)?.number ?? null,
          })),
          openFoliosOfDeparted: withLines.map((f) => ({
            number: departed.find((d) => d.id === f.stayId)?.number ?? '',
            folio: f.name,
          })),
          unpaidRestaurantBills: checks.filter((c) => c.status === 'OPEN').length,
        },
      };
      // 4. The date moves on; tomorrow's housekeeping is laid out.
      const next = addDays(day, 1);
      await tx.nightAudit.create({
        data: { companyId: actor.companyId, branchId, day, pack: result, runById: actor.userId },
      });
      await tx.hotelSettings.update({ where: { branchId }, data: { businessDate: next } });
      await planDay(tx, { ...hotel, businessDate: next });
      await writeAudit(tx, ctx, {
        action: 'hotel.night_audit',
        entityType: 'branch',
        entityId: branchId,
        after: { day, sold, roomRevenue, noShows: noShows.length },
      });
      return result;
    },
    { timeout: 60_000 },
  );
  return { pack, businessDate: addDays(day, 1) };
}

/** The packs of the last audits (newest first), and the property's date. */
export async function audits(db: Db, actor: Actor, branchId: string, take = 31) {
  seer(actor);
  const hotel = await hotelOf(db, actor, branchId);
  const rows = await db.nightAudit.findMany({
    where: { companyId: actor.companyId, branchId },
    orderBy: { day: 'desc' },
    take,
  });
  return { businessDate: hotel.businessDate, audits: rows.map((r) => r.pack as AuditPack) };
}
