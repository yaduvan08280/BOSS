import { randomBytes } from 'node:crypto';
import { formatNumber, nextCounter, type Db, type Guest, type Reservation, type Tx } from '@mono/db';
import {
  DEFAULT_BOOKING,
  HOLDING_STATUSES,
  bookingSchema,
  formatINR,
  slotLabel,
  type Booking,
} from '@mono/shared';
import type { ActorContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { hospOf } from './access';

/**
 * Phase 16 — what the reservation, waitlist and guest services share: an outlet with its clock and booking rules,
 * the guest behind a mobile number, which tables are taken at a time, and the messages a guest gets.
 */
export type ResOutlet = {
  id: string;
  companyId: string;
  branchId: string;
  name: string;
  openMin: number;
  closeMin: number;
  tz: string;
  booking: Booking;
  bookingToken: string | null;
};

/** An outlet for booking, by id or by its public link. No reach is asked here: the callers check the person. */
export async function resOutlet(
  db: Db | Tx,
  where: { id: string; companyId: string } | { bookingToken: string },
): Promise<ResOutlet | null> {
  const o = await db.outlet.findFirst({ where: { ...where, deletedAt: null, active: true } });
  if (!o || !(await hospOf(db, o.companyId)).enabled) return null;
  const [branch, company] = await Promise.all([
    db.branch.findFirst({ where: { id: o.branchId }, select: { timezone: true } }),
    db.company.findUniqueOrThrow({ where: { id: o.companyId }, select: { timezone: true } }),
  ]);
  const parsed = bookingSchema.safeParse(o.booking ?? {});
  return {
    id: o.id,
    companyId: o.companyId,
    branchId: o.branchId,
    name: o.name,
    openMin: o.openMin,
    closeMin: o.closeMin,
    tz: branch?.timezone ?? company.timezone,
    booking: parsed.success ? parsed.data : DEFAULT_BOOKING,
    bookingToken: o.bookingToken,
  };
}

export const newToken = () => randomBytes(18).toString('base64url');
export const resNumber = (n: number) => formatNumber('RES', n);
/** "13/11/2026 19:30" on the outlet's clock. */
export const whenOf = (r: { day: string; startMin: number }) =>
  `${r.day.split('-').reverse().join('/')} ${slotLabel(r.startMin)}`;

/** The guest behind a mobile: found, or made. A name given later fills a blank one; nothing else is overwritten. */
export async function guestFor(
  tx: Tx,
  companyId: string,
  g: { mobile: string; name: string; email?: string | null },
): Promise<Guest> {
  const had = await tx.guest.findFirst({ where: { companyId, mobile: g.mobile } });
  if (had) {
    const data = {
      ...(had.deletedAt ? { deletedAt: null, name: g.name } : {}),
      ...(!had.email && g.email ? { email: g.email } : {}),
    };
    return Object.keys(data).length ? tx.guest.update({ where: { id: had.id }, data }) : had;
  }
  return tx.guest.create({ data: { companyId, mobile: g.mobile, name: g.name, email: g.email ?? null } });
}

/** The guest's party in the money core (for a deposit, or a bill in their name): made the first time it is needed. */
export async function guestParty(tx: Tx, guest: Guest): Promise<string> {
  if (guest.partyId) return guest.partyId;
  const party = await tx.party.create({
    data: {
      companyId: guest.companyId,
      code: formatNumber('GST', await nextCounter(tx, guest.companyId, 'guest_party')),
      name: guest.name,
      mobile: guest.mobile,
      email: guest.email,
      kinds: ['guest'],
    },
  });
  await tx.guest.update({ where: { id: guest.id }, data: { partyId: party.id } });
  return party.id;
}

/**
 * One booking at a time per outlet: every change that takes or moves a table holds this lock for its
 * transaction, so two people (or the public page and a host) can never take the same table for the same time.
 */
export const lockOutlet = (tx: Tx, outletId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`res:${outletId}`}))`;

/** Tables that are booked for any part of a time span (a booking keeps its table while it is live). */
export async function bookedTables(
  db: Db | Tx,
  outlet: { id: string; companyId: string },
  startAt: Date,
  endAt: Date,
  exceptId?: string,
): Promise<Set<string>> {
  const rows = await db.reservation.findMany({
    where: {
      companyId: outlet.companyId,
      outletId: outlet.id,
      status: { in: [...HOLDING_STATUSES] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { tableIds: true },
  });
  return new Set(rows.flatMap((r) => r.tableIds));
}

export const outletTables = (db: Db | Tx, outlet: { id: string; companyId: string }) =>
  db.diningTable.findMany({
    where: { companyId: outlet.companyId, outletId: outlet.id, deletedAt: null },
    orderBy: { name: 'asc' },
  });

export const depositLeft = (r: Pick<Reservation, 'depositDue' | 'depositState'>) =>
  r.depositState === 'DUE' ? Number(r.depositDue) : 0;

/** A message to the guest (WhatsApp / email by the company's rules) or about them to the outlet's managers. */
export async function tellGuest(
  tx: Tx,
  ctx: ActorContext,
  name:
    | 'reservation.requested'
    | 'reservation.deposit_due'
    | 'reservation.confirmed'
    | 'reservation.reminder'
    | 'reservation.cancelled'
    | 'reservation.no_show',
  outlet: ResOutlet,
  r: Reservation,
  guest: Guest,
  extra: Record<string, unknown> = {},
) {
  await emitEvent(tx, ctx, {
    name,
    entityType: 'reservation',
    entityId: r.id,
    payload: {
      branchId: outlet.branchId,
      outletId: outlet.id,
      outlet: outlet.name,
      number: resNumber(r.number),
      guest: guest.name,
      customer: guest.name,
      customerMobile: guest.mobile,
      customerEmail: guest.email,
      size: r.partySize,
      when: whenOf(r),
      time: slotLabel(r.startMin),
      source: r.source,
      amount: formatINR(r.depositDue),
      deposit: '',
      link: `/book/manage/${r.token}`,
      ...extra,
    },
  });
}

export function needBookable(outlet: ResOutlet | null): asserts outlet is ResOutlet {
  if (!outlet) throw new AppError(404, 'NOT_FOUND', 'Outlet not found');
}
