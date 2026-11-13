import { randomBytes } from 'node:crypto';
import type { Db, Stay, Tx } from '@mono/db';
import { DEFAULT_HOTEL_RULES, hotelRulesSchema, localDate, type HotelRules } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { branchOf, hospOf, need } from '../hosp/access';
import type { Actor } from '../work/actor';

/**
 * Phase 17 — what every hotel service needs: the property (a branch) with its clock, rules and business date,
 * who may do what, and the lock that keeps two people from selling the same room.
 */
export type Hotel = {
  companyId: string;
  branchId: string;
  name: string;
  tz: string;
  rules: HotelRules;
  /** The hotel's own date: it moves on only with the night audit. */
  businessDate: string;
};

/** Front desk and reservations (hosp.create), supervisors (hosp.edit), set-up (hosp.admin). */
export const desk = (a: Actor) => need(a, 'hosp.create', "You can't work the front desk");
export const supervisor = (a: Actor) => need(a, 'hosp.edit', 'Only a supervisor does this');
export const admin = (a: Actor) => need(a, 'hosp.admin', 'Only hospitality admins change this set-up');
export const seer = (a: Actor) => need(a, 'hosp.view', "You can't see hospitality");

/** The property behind a branch (no reach asked: for the worker and for callers that checked already). */
export async function hotelFor(db: Db | Tx, companyId: string, branchId: string): Promise<Hotel> {
  const branch = await db.branch.findFirst({ where: { id: branchId, companyId, deletedAt: null } });
  if (!branch) throw notFound('Branch');
  if (!(await hospOf(db, companyId)).enabled)
    throw new AppError(409, 'CONFLICT', 'Hospitality is not switched on for this company');
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = branch.timezone ?? company.timezone;
  let row = await db.hotelSettings.findUnique({ where: { branchId } });
  // The first time a property is used its business date starts at today on its own clock.
  if (!row)
    row = await db.hotelSettings.upsert({
      where: { branchId },
      create: { companyId, branchId, rules: DEFAULT_HOTEL_RULES, businessDate: localDate(new Date(), tz) },
      update: {},
    });
  const parsed = hotelRulesSchema.safeParse(row.rules ?? {});
  return {
    companyId,
    branchId,
    name: branch.name,
    tz,
    rules: parsed.success ? parsed.data : DEFAULT_HOTEL_RULES,
    businessDate: row.businessDate,
  };
}
/** The property, for a signed-in person: the branch must be one of theirs. */
export async function hotelOf(db: Db | Tx, actor: Actor, branchId: string): Promise<Hotel> {
  await branchOf(db, actor.companyId, branchId);
  return hotelFor(db, actor.companyId, branchId);
}

export async function stayOf(db: Db | Tx, actor: Actor, id: string): Promise<{ stay: Stay; hotel: Hotel }> {
  const stay = await db.stay.findFirst({ where: { id, companyId: actor.companyId } });
  if (!stay) throw notFound('Booking');
  return { stay, hotel: await hotelOf(db, actor, stay.branchId) };
}

/**
 * One change to a property's rooms at a time: every booking, move, extension and block holds this lock for its
 * transaction. (A room can only be in one RoomNight row a day anyway — the lock makes the answers clear.)
 */
export const lockHotel = (tx: Tx, branchId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hotel:${branchId}`}))`;

export const newToken = () => randomBytes(18).toString('base64url');
/** The minutes of the day on the property's clock. */
export function minuteAt(tz: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}
export const dmy = (day: string) => day.split('-').reverse().join('/');
/** A room that turned out to be taken (the unique index on a room's day): said in words. */
export const isTaken = (e: unknown) =>
  typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
