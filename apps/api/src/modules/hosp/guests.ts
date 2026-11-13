import { Prisma, type Db, type Guest } from '@mono/db';
import { consentSchema, guestPatchSchema, guestSchema, type Consent } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { branchWhere, ctxOf, need } from './access';
import { resNumber, whenOf } from './res-core';
import { host } from './reservations';

/**
 * Phase 16 — guest profiles: one per mobile number in a company. What the guest told us is kept on the profile
 * (allergies, preferences, dates, notes, tags, marketing consent with when and how it was given); what they did
 * (visits, spend, favourite dishes, no-shows) is read from their orders and bookings, never typed.
 */
const brief = (g: Guest) => ({
  id: g.id,
  name: g.name,
  mobile: g.mobile,
  email: g.email,
  birthday: g.birthday,
  anniversary: g.anniversary,
  allergies: g.allergies,
  preferences: g.preferences,
  notes: g.notes,
  tags: g.tags,
  consent: (g.consent as Consent | null) ?? null,
});

export const guestQuery = z.object({
  q: z.string().trim().max(80).optional(),
  tag: z.string().trim().max(30).optional(),
  /** yes = may be sent offers; no = said no or never asked. */
  marketing: z.enum(['yes', 'no']).optional(),
  /** Birthdays or anniversaries in this month (1–12). */
  month: z.coerce.number().int().min(1).max(12).optional(),
});
export async function listGuests(db: Db, actor: Actor, query: z.infer<typeof guestQuery>) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const mm = query.month ? `-${String(query.month).padStart(2, '0')}-` : null;
  const and: Prisma.GuestWhereInput[] = [];
  if (query.q)
    and.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { mobile: { contains: query.q.replace(/\s/g, '') } },
      ],
    });
  if (query.marketing === 'yes') and.push({ consent: { path: ['marketing'], equals: true } });
  // "No" is everyone who has not said yes: never asked, or took it back.
  if (query.marketing === 'no')
    and.push({
      OR: [{ consent: { equals: Prisma.DbNull } }, { consent: { path: ['marketing'], equals: false } }],
    });
  if (mm) and.push({ OR: [{ birthday: { contains: mm } }, { anniversary: { contains: mm } }] });
  const where: Prisma.GuestWhereInput = {
    companyId: actor.companyId,
    deletedAt: null,
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    AND: and,
  };
  const rows = await db.guest.findMany({ where, orderBy: { name: 'asc' }, take: 300 });
  const visits = await db.posOrder.groupBy({
    by: ['guestId'],
    where: { companyId: actor.companyId, guestId: { in: rows.map((r) => r.id) }, status: 'PAID' },
    _count: { _all: true },
    _max: { openedAt: true },
  });
  const by = new Map(visits.map((v) => [v.guestId, v]));
  const tags = await db.guest.findMany({
    where: { companyId: actor.companyId, deletedAt: null, NOT: { tags: { isEmpty: true } } },
    select: { tags: true },
    take: 2000,
  });
  return {
    tags: [...new Set(tags.flatMap((t) => t.tags))].sort(),
    guests: rows.map((g) => ({
      ...brief(g),
      visits: by.get(g.id)?._count._all ?? 0,
      lastVisit: by.get(g.id)?._max.openedAt ?? null,
    })),
  };
}

/** A guest with their history: visits, spend, favourite dishes, bookings kept and missed. */
export async function guestProfile(db: Db, actor: Actor, id: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const g = await db.guest.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!g) throw notFound('Guest');
  // History is read within the person's branches: a franchise never sees another's visits.
  const scope = branchWhere();
  const orders = await db.posOrder.findMany({
    where: { companyId: actor.companyId, guestId: id, status: 'PAID', ...scope },
    orderBy: { openedAt: 'desc' },
    take: 500,
    select: { id: true, outletId: true, openedAt: true, covers: true, businessDay: true },
  });
  const ids = orders.map((o) => o.id);
  const [checks, items, reservations, outlets] = await Promise.all([
    db.posCheck.findMany({
      where: { companyId: actor.companyId, orderId: { in: ids }, status: 'PAID' },
      select: { orderId: true, total: true },
    }),
    db.posOrderItem.groupBy({
      by: ['name'],
      where: { companyId: actor.companyId, orderId: { in: ids }, status: { not: 'VOID' } },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 5,
    }),
    db.reservation.findMany({
      where: { companyId: actor.companyId, guestId: id, ...scope },
      orderBy: { startAt: 'desc' },
      take: 100,
    }),
    db.outlet.findMany({ where: { companyId: actor.companyId }, select: { id: true, name: true } }),
  ]);
  const outletName = (oid: string) => outlets.find((o) => o.id === oid)?.name ?? '';
  const spendOf = (orderId: string) =>
    checks.filter((c) => c.orderId === orderId).reduce((n, c) => n + Number(c.total), 0);
  const spend = checks.reduce((n, c) => n + Number(c.total), 0);
  const now = Date.now();
  return {
    ...brief(g),
    consentLog: (g.consentLog as Consent[] | null) ?? [],
    history: {
      visits: orders.length,
      spend,
      average: orders.length ? Math.round(spend / orders.length) : 0,
      lastVisit: orders[0]?.openedAt ?? null,
      favourites: items.map((i) => ({ name: i.name, qty: Number(i._sum.qty ?? 0) })),
      noShows: reservations.filter((r) => r.status === 'NO_SHOW').length,
      cancelled: reservations.filter((r) => r.status === 'CANCELLED').length,
    },
    recent: orders.slice(0, 10).map((o) => ({
      orderId: o.id,
      day: o.businessDay,
      outlet: outletName(o.outletId),
      covers: o.covers,
      spend: spendOf(o.id),
    })),
    upcoming: reservations
      .filter((r) => r.startAt.getTime() > now && ['REQUESTED', 'CONFIRMED', 'REMINDED'].includes(r.status))
      .reverse()
      .map((r) => ({
        id: r.id,
        number: resNumber(r.number),
        when: whenOf(r),
        outlet: outletName(r.outletId),
        size: r.partySize,
        status: r.status,
      })),
  };
}

/** Add a guest, or find them by mobile: one profile per number. */
export async function saveGuest(db: Db, actor: Actor, input: z.input<typeof guestSchema>) {
  host(actor);
  const g = guestSchema.parse(input);
  const had = await db.guest.findFirst({ where: { companyId: actor.companyId, mobile: g.mobile } });
  if (had && !had.deletedAt)
    throw new AppError(409, 'CONFLICT', `${had.name} already has this mobile number`, { id: had.id });
  const data = {
    name: g.name,
    email: g.email ?? null,
    birthday: g.birthday ?? null,
    anniversary: g.anniversary ?? null,
    allergies: g.allergies ?? null,
    preferences: g.preferences ?? null,
    notes: g.notes ?? null,
    tags: g.tags,
  };
  return db.$transaction(async (tx) => {
    const row = had
      ? await tx.guest.update({ where: { id: had.id }, data: { ...data, deletedAt: null } })
      : await tx.guest.create({ data: { ...data, companyId: actor.companyId, mobile: g.mobile } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'guest.created',
      entityType: 'guest',
      entityId: row.id,
      after: brief(row),
    });
    return brief(row);
  });
}

export async function changeGuest(db: Db, actor: Actor, id: string, input: z.input<typeof guestPatchSchema>) {
  host(actor);
  const p = guestPatchSchema.parse(input);
  const before = await db.guest.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!before) throw notFound('Guest');
  if (p.mobile && p.mobile !== before.mobile) {
    const other = await db.guest.findFirst({ where: { companyId: actor.companyId, mobile: p.mobile } });
    if (other) throw new AppError(409, 'CONFLICT', `${other.name} already has this mobile number`);
  }
  return db.$transaction(async (tx) => {
    const row = await tx.guest.update({ where: { id }, data: p });
    if (row.partyId && (p.name || p.mobile || 'email' in p))
      await tx.party.update({
        where: { id: row.partyId },
        data: { name: row.name, mobile: row.mobile, email: row.email },
      });
    await writeAudit(tx, ctxOf(actor), {
      action: 'guest.updated',
      entityType: 'guest',
      entityId: id,
      before: brief(before),
      after: brief(row),
    });
    return brief(row);
  });
}

/** Record what the guest said about offers and messages: when, how, and who wrote it down. Nothing is overwritten. */
export async function recordConsent(
  db: Db,
  ctx: { companyId: string; actorId: string | null },
  id: string,
  input: z.input<typeof consentSchema>,
) {
  const c = consentSchema.parse(input);
  const g = await db.guest.findFirst({ where: { id, companyId: ctx.companyId, deletedAt: null } });
  if (!g) throw notFound('Guest');
  const entry: Consent = {
    marketing: c.marketing,
    source: c.source,
    at: new Date().toISOString(),
    byId: ctx.actorId,
    note: c.note ?? null,
  };
  return db.$transaction(async (tx) => {
    const row = await tx.guest.update({
      where: { id },
      data: { consent: entry, consentLog: [...((g.consentLog as Consent[] | null) ?? []), entry] },
    });
    await writeAudit(tx, ctx, {
      action: c.marketing ? 'guest.consent_given' : 'guest.consent_withdrawn',
      entityType: 'guest',
      entityId: id,
      before: g.consent,
      after: entry,
    });
    return brief(row);
  });
}

/** Remove a profile from the lists (soft): never while a booking of theirs is still to come. */
export async function deleteGuest(db: Db, actor: Actor, id: string) {
  need(actor, 'hosp.edit', "You can't delete guests");
  const g = await db.guest.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!g) throw notFound('Guest');
  const live = await db.reservation.count({
    where: {
      companyId: actor.companyId,
      guestId: id,
      status: { in: ['REQUESTED', 'CONFIRMED', 'REMINDED', 'ARRIVED', 'SEATED'] },
    },
  });
  if (live) throw new AppError(409, 'CONFLICT', `${g.name} still has a booking`);
  await db.$transaction(async (tx) => {
    await tx.guest.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'guest.deleted',
      entityType: 'guest',
      entityId: id,
      before: brief(g),
    });
  });
  return { ok: true };
}
