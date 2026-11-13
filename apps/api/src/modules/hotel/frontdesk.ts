import type { Db, Stay, Tx } from '@mono/db';
import {
  earlyFee,
  formCMissing,
  isForeign,
  kycSchema,
  lateFee,
  slotLabel,
  stayMachine,
  transition,
  type Kyc,
  type StayStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import type { Actor } from '../work/actor';
import { nightsOf, stayRows } from './bookings';
import { desk, dmy, hotelOf, isTaken, lockHotel, minuteAt, seer, stayOf, type Hotel } from './core';
import { folioView } from './folio';
import { postCharge } from './folio-core';

/**
 * Phase 17 — the front desk: who arrives, who is in the house, who leaves; check-in (the guest's ID and, for a
 * foreign guest, what Form C needs; a clean room; an early-arrival charge by the rules), keys and visitors, and
 * check-out (a late charge by the rules; every folio closed first; the room goes to housekeeping).
 */
export async function deskLists(db: Db, actor: Actor, branchId: string) {
  seer(actor);
  const hotel = await hotelOf(db, actor, branchId);
  const where = { companyId: actor.companyId, branchId };
  const today = hotel.businessDate;
  const [arrivals, inHouse] = await Promise.all([
    db.stay.findMany({
      where: { ...where, status: 'BOOKED', arrive: { lte: today } },
      orderBy: { number: 'asc' },
    }),
    db.stay.findMany({ where: { ...where, status: 'CHECKED_IN' }, orderBy: { number: 'asc' } }),
  ]);
  const rows = await stayRows(db, hotel, [...arrivals, ...inHouse]);
  const of = (stays: Stay[]) => rows.filter((r) => stays.some((s) => s.id === r.id));
  return {
    businessDate: today,
    arrivals: of(arrivals),
    inHouse: of(inHouse),
    departures: of(inHouse.filter((s) => s.depart === today)),
    // Should have left before today and is still in the house.
    dueOuts: of(inHouse.filter((s) => s.depart < today)),
  };
}

export const checkInSchema = z.object({
  /** The room, when none was chosen at booking (or another one). */
  roomId: z.string().min(1).optional(),
  kyc: kycSchema,
  /** When the guest came, minutes of the day; left out, now. */
  arrivedMin: z.number().int().min(0).max(1439).optional(),
  keys: z.number().int().min(0).max(20).default(1),
});
export async function checkIn(db: Db, actor: Actor, stayId: string, input: z.input<typeof checkInSchema>) {
  desk(actor);
  const p = checkInSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (stay.arrive > hotel.businessDate)
    throw new AppError(409, 'CONFLICT', `This booking arrives on ${dmy(stay.arrive)}`);
  const nights = await nightsOf(db, stayId);
  const roomId = p.roomId ?? nights.find((n) => n.day >= hotel.businessDate)?.roomId ?? null;
  const room = roomId
    ? await db.room.findFirst({
        where: { id: roomId, companyId: actor.companyId, branchId: stay.branchId, deletedAt: null },
      })
    : null;
  if (roomId && !room) throw notFound('Room');
  if (!room) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a room for this guest');
  if (!p.kyc.idPhotoId || !p.kyc.signatureId)
    throw new AppError(400, 'VALIDATION_FAILED', 'Take a photo of the ID and the guest’s signature');
  // An ID is always written down; a photo of it and the guest's signature are part of the check-in.
  const kycOk = Boolean(p.kyc.idPhotoId && p.kyc.signatureId);
  const to = transition(stayMachine, {
    from: stay.status as StayStatus,
    action: 'checkIn',
    roles: ['desk'],
    ctx: { room: Boolean(room), kyc: kycOk, settled: true },
  }).to;
  if (!['CLEAN', 'INSPECTED'].includes(room!.hkStatus))
    throw new AppError(
      409,
      'CONFLICT',
      `Room ${room!.number} is not ready (${room!.hkStatus.toLowerCase().replace(/_/g, ' ')})`,
    );
  const arrivedMin = p.arrivedMin ?? minuteAt(hotel.tz);
  const foreign = isForeign(p.kyc.nationality);
  const ctx = ctxOf(actor);
  try {
    return await db.$transaction(async (tx) => {
      await lockHotel(tx, hotel.branchId);
      const left = nights.filter((n) => n.day >= hotel.businessDate);
      for (const n of left)
        if (n.roomId !== room!.id)
          await tx.roomNight.update({
            where: { id: n.id },
            data: { roomId: room!.id, roomTypeId: room!.typeId },
          });
      const row = await tx.stay.update({
        where: { id: stayId },
        data: {
          status: to,
          kyc: p.kyc,
          keys: p.keys,
          checkedInAt: new Date(),
          // Form C for a foreign guest is due within the rule's hours of check-in.
          formCDueAt: foreign ? new Date(Date.now() + hotel.rules.formCHours * 3_600_000) : null,
          formCFiledAt: null,
        },
      });
      const fee =
        stay.arrive === hotel.businessDate
          ? earlyFee(hotel.rules, arrivedMin, Number(left[0]?.rate ?? 0))
          : 0;
      if (fee > 0) {
        const type = await tx.roomType.findUniqueOrThrow({ where: { id: room!.typeId } });
        await postCharge(tx, ctx, hotel, row, {
          kind: 'EARLY',
          text: `Early check-in at ${slotLabel(arrivedMin)}`,
          amount: fee,
          taxCode: type.taxCode ?? hotel.rules.roomTaxCode ?? null,
        });
      }
      await writeAudit(tx, ctx, {
        action: 'hotel.checked_in',
        entityType: 'stay',
        entityId: stayId,
        before: { status: stay.status },
        after: { status: to, room: room!.number, foreign, earlyFee: fee },
      });
      return {
        id: stayId,
        status: to,
        room: room!.number,
        earlyFee: fee,
        formC: foreign ? { dueAt: row.formCDueAt, missing: formCMissing(p.kyc) } : null,
      };
    });
  } catch (e) {
    if (isTaken(e))
      throw new AppError(409, 'CONFLICT', `Room ${room!.number} is taken on one of those nights`);
    throw e;
  }
}

/** Form C was filed on the FRRO portal: only once every field it needs is written down. */
export async function fileFormC(db: Db, actor: Actor, stayId: string, input: { kyc?: Partial<Kyc> }) {
  desk(actor);
  const { stay } = await stayOf(db, actor, stayId);
  if (!stay.formCDueAt) throw new AppError(409, 'CONFLICT', 'This guest needs no Form C');
  const kyc = kycSchema.parse({ ...((stay.kyc as object | null) ?? {}), ...(input.kyc ?? {}) });
  const missing = formCMissing(kyc);
  if (missing.length)
    throw new AppError(400, 'VALIDATION_FAILED', `Form C still needs: ${missing.join(', ')}`, { missing });
  await db.$transaction(async (tx) => {
    await tx.stay.update({ where: { id: stayId }, data: { kyc, formCFiledAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.form_c_filed',
      entityType: 'stay',
      entityId: stayId,
      after: { passportNo: kyc.passportNo },
    });
  });
  return { filed: true };
}

export const deskNoteSchema = z.discriminatedUnion('what', [
  z.object({ what: z.literal('keys'), keys: z.number().int().min(0).max(20) }),
  z.object({
    what: z.literal('visitorIn'),
    name: z.string().trim().min(1).max(80),
    note: z.string().trim().max(200).nullish(),
  }),
  z.object({ what: z.literal('visitorOut'), index: z.number().int().min(0).max(500) }),
]);
type Visitor = { name: string; at: string; out: string | null; note: string | null; byId: string };
/** Keys handed over, and the visitor log of a room. */
export async function deskNote(db: Db, actor: Actor, stayId: string, input: z.input<typeof deskNoteSchema>) {
  desk(actor);
  const p = deskNoteSchema.parse(input);
  const { stay } = await stayOf(db, actor, stayId);
  if (stay.status !== 'CHECKED_IN') throw new AppError(409, 'CONFLICT', 'The guest is not in the hotel');
  const visitors = [...((stay.visitors as Visitor[] | null) ?? [])];
  if (p.what === 'visitorIn')
    visitors.push({
      name: p.name,
      at: new Date().toISOString(),
      out: null,
      note: p.note ?? null,
      byId: actor.userId,
    });
  if (p.what === 'visitorOut') {
    const v = visitors[p.index];
    if (!v || v.out) throw notFound('Visitor');
    visitors[p.index] = { ...v, out: new Date().toISOString() };
  }
  await db.$transaction(async (tx) => {
    await tx.stay.update({
      where: { id: stayId },
      data: p.what === 'keys' ? { keys: p.keys } : { visitors },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: `hotel.${p.what}`,
      entityType: 'stay',
      entityId: stayId,
      after: p,
    });
  });
  return { keys: p.what === 'keys' ? p.keys : stay.keys, visitors };
}

/** The late check-out charge for a guest who is leaving now (or at the time given). */
export async function lateCharge(tx: Tx, hotel: Hotel, stay: Stay, leftMin: number) {
  if (stay.depart > hotel.businessDate) return 0;
  const last = await tx.roomNight.findFirst({ where: { stayId: stay.id }, orderBy: { day: 'desc' } });
  return lateFee(hotel.rules, leftMin, Number(last?.rate ?? 0));
}

export const checkOutSchema = z.object({ leftMin: z.number().int().min(0).max(1439).optional() });
/**
 * Check out. A guest leaving late is charged by the rules first (`charge: true` posts it and stops, so the folio
 * can be settled with it); then every folio must be closed. Nights not slept go back on sale and the room goes
 * to housekeeping.
 */
export async function checkOut(db: Db, actor: Actor, stayId: string, input: z.input<typeof checkOutSchema>) {
  desk(actor);
  const p = checkOutSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (stay.status !== 'CHECKED_IN') throw new AppError(409, 'CONFLICT', 'The guest is not in the hotel');
  const leftMin = p.leftMin ?? minuteAt(hotel.tz);
  const ctx = ctxOf(actor);
  // The late charge is posted once, before the folios are closed.
  const had = await db.folioLine.count({ where: { stayId, kind: 'LATE', voided: false } });
  const fee = had ? 0 : await db.$transaction((tx) => lateCharge(tx, hotel, stay, leftMin));
  if (fee > 0) {
    await db.$transaction(async (tx) => {
      const type = await tx.roomType.findUniqueOrThrow({ where: { id: stay.roomTypeId } });
      await postCharge(tx, ctx, hotel, stay, {
        kind: 'LATE',
        text: `Late check-out at ${slotLabel(leftMin)}`,
        amount: fee,
        taxCode: type.taxCode ?? hotel.rules.roomTaxCode ?? null,
      });
    });
  }
  const folios = await db.folio.findMany({ where: { stayId }, orderBy: { no: 'asc' } });
  const open = [];
  for (const f of folios.filter((x) => x.status === 'OPEN')) {
    const v = await folioView(db, hotel, f);
    // A folio nothing was ever put on closes by itself.
    if (v.lines.some((l) => !l.voided)) open.push({ id: f.id, no: f.no, name: f.name, due: v.due });
  }
  if (open.length)
    throw new AppError(409, 'CONFLICT', 'Close every folio before the guest leaves', { open, lateFee: fee });
  const to = transition(stayMachine, {
    from: 'CHECKED_IN',
    action: 'checkOut',
    roles: ['desk'],
    ctx: { room: true, kyc: true, settled: true },
  }).to;
  return db.$transaction(async (tx) => {
    await lockHotel(tx, hotel.branchId);
    const nights = await nightsOf(tx, stayId);
    const last = nights.filter((n) => n.day <= hotel.businessDate).pop() ?? nights[0];
    // Leaving early: the nights not slept (and not charged) go back on sale.
    await tx.roomNight.deleteMany({ where: { stayId, day: { gte: hotel.businessDate }, posted: false } });
    await tx.folio.updateMany({
      where: { stayId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    await tx.stay.update({
      where: { id: stayId },
      data: {
        status: to,
        checkedOutAt: new Date(),
        ...(stay.depart > hotel.businessDate ? { depart: hotel.businessDate } : {}),
      },
    });
    if (last?.roomId) await tx.room.update({ where: { id: last.roomId }, data: { hkStatus: 'DIRTY' } });
    await writeAudit(tx, ctx, {
      action: 'hotel.checked_out',
      entityType: 'stay',
      entityId: stayId,
      before: { status: stay.status },
      after: { status: to, lateFee: fee, early: stay.depart > hotel.businessDate },
    });
    return { id: stayId, status: to, lateFee: fee };
  });
}

/** One booking with everything on it: the guest, its nights and rooms, what was written at check-in, its folios. */
export async function stayDetail(db: Db, actor: Actor, stayId: string) {
  seer(actor);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  const [row] = await stayRows(db, hotel, [stay]);
  const [nights, rooms, folios, plan] = await Promise.all([
    nightsOf(db, stayId),
    db.room.findMany({ where: { companyId: actor.companyId, branchId: stay.branchId } }),
    db.folio.findMany({ where: { stayId }, orderBy: { no: 'asc' } }),
    db.ratePlan.findUnique({ where: { id: stay.ratePlanId } }),
  ]);
  const views = [];
  for (const f of folios) views.push(await folioView(db, hotel, f));
  return {
    ...row!,
    businessDate: hotel.businessDate,
    plan: plan ? { id: plan.id, code: plan.code, name: plan.name } : null,
    commissionPct: Number(stay.commissionPct),
    note: stay.note,
    kyc: (stay.kyc as Kyc | null) ?? null,
    formC: stay.formCDueAt
      ? {
          dueAt: stay.formCDueAt,
          filedAt: stay.formCFiledAt,
          missing: formCMissing((stay.kyc as Kyc | null) ?? {}),
        }
      : null,
    keys: stay.keys,
    visitors: (stay.visitors as Visitor[] | null) ?? [],
    moves: (stay.moves as object[] | null) ?? [],
    routing: stay.routing ?? [],
    cancelReason: stay.cancelReason,
    checkedInAt: stay.checkedInAt,
    checkedOutAt: stay.checkedOutAt,
    nightly: nights.map((n) => ({
      day: n.day,
      rate: Number(n.rate),
      room: rooms.find((r) => r.id === n.roomId)?.number ?? null,
      posted: n.posted,
    })),
    folios: views,
  };
}
