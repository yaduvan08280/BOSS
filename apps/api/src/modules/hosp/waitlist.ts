import type { Db, WaitlistEntry } from '@mono/db';
import {
  durationFor,
  HOLDING_STATUSES,
  quoteWait,
  transition,
  waitlistMachine,
  waitlistSchema,
  type WaitlistAction,
  type WaitlistStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { openOrder } from './orders';
import { guestFor, outletTables, type ResOutlet } from './res-core';
import { host, staffOutlet } from './reservations';

/**
 * Phase 16 — the waitlist. A walk-in with no free table is quoted a wait (when a table that seats them is
 * expected to come free, after the parties already waiting), told when the table is ready, and seated from the
 * list — which opens the POS order.
 */
const LIVE: WaitlistStatus[] = ['WAITING', 'CALLED'];
const view = (e: WaitlistEntry, now = Date.now()) => ({
  id: e.id,
  name: e.name,
  mobile: e.mobile,
  guestId: e.guestId,
  partySize: e.partySize,
  quotedMin: e.quotedMin,
  waitedMin: Math.floor(
    ((e.seatedAt ?? e.leftAt ?? new Date(now)).getTime() - e.createdAt.getTime()) / 60_000,
  ),
  status: e.status as WaitlistStatus,
  note: e.note,
  orderId: e.orderId,
  createdAt: e.createdAt,
  calledAt: e.calledAt,
});

/** The wait for a party of this size right now (null = no table of this outlet seats them). */
export async function quoteFor(db: Db, outlet: ResOutlet, size: number, now = Date.now()) {
  const tables = (await outletTables(db, outlet)).filter((t) => t.seats >= size);
  if (!tables.length) return null;
  const turnMin = durationFor(outlet.booking, size);
  const [orders, held, waiting] = await Promise.all([
    db.posOrder.findMany({
      where: { companyId: outlet.companyId, outletId: outlet.id, status: { in: ['OPEN', 'BILLED'] } },
      select: { tableIds: true, openedAt: true, covers: true },
    }),
    db.reservation.findMany({
      where: {
        companyId: outlet.companyId,
        outletId: outlet.id,
        status: { in: [...HOLDING_STATUSES].filter((s) => s !== 'SEATED') },
        startAt: { lt: new Date(now + turnMin * 60_000) },
        endAt: { gt: new Date(now) },
      },
      select: { tableIds: true, endAt: true },
    }),
    db.waitlistEntry.findMany({
      where: { companyId: outlet.companyId, outletId: outlet.id, status: { in: LIVE } },
      select: { partySize: true },
    }),
  ]);
  const largest = Math.max(...tables.map((t) => t.seats));
  const freeAt = tables.map((t) => {
    const order = orders.find((o) => o.tableIds.includes(t.id));
    // A table in use is expected back when its party's time is up (never sooner than ten minutes from now).
    const fromOrder = order
      ? Math.max(order.openedAt.getTime() + durationFor(outlet.booking, order.covers) * 60_000, now + 600_000)
      : now;
    // A table booked for the coming span is not on offer until that booking ends.
    const booked = held.filter((h) => h.tableIds.includes(t.id)).map((h) => h.endAt.getTime());
    return Math.max(fromOrder, ...booked);
  });
  // Parties already waiting that the same tables would seat.
  const ahead = waiting.filter((w) => w.partySize <= largest).length;
  return quoteWait(now, freeAt, ahead, turnMin);
}

export async function waitlist(db: Db, actor: Actor, outletId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const outlet = await staffOutlet(db, actor, outletId);
  const since = new Date(Date.now() - 12 * 3_600_000);
  const rows = await db.waitlistEntry.findMany({
    where: {
      companyId: actor.companyId,
      outletId,
      OR: [{ status: { in: LIVE } }, { createdAt: { gt: since } }],
    },
    orderBy: { createdAt: 'asc' },
    take: 300,
  });
  return {
    outlet: { id: outlet.id, name: outlet.name },
    waiting: rows.filter((r) => LIVE.includes(r.status as WaitlistStatus)).map((r) => view(r)),
    earlier: rows
      .filter((r) => !LIVE.includes(r.status as WaitlistStatus))
      .reverse()
      .map((r) => view(r)),
  };
}

export const quoteQuery = z.object({ size: z.coerce.number().int().min(1).max(500) });
export async function quote(db: Db, actor: Actor, outletId: string, size: number) {
  need(actor, 'hosp.view', "You can't see hospitality");
  return { size, minutes: await quoteFor(db, await staffOutlet(db, actor, outletId), size) };
}

export async function joinWaitlist(db: Db, actor: Actor, input: z.input<typeof waitlistSchema>) {
  host(actor);
  const w = waitlistSchema.parse(input);
  const outlet = await staffOutlet(db, actor, w.outletId);
  const quotedMin = await quoteFor(db, outlet, w.partySize);
  if (quotedMin === null)
    throw new AppError(409, 'CONFLICT', `No table at ${outlet.name} seats ${w.partySize}`);
  const row = await db.$transaction(async (tx) => {
    const guest = w.mobile ? await guestFor(tx, actor.companyId, { mobile: w.mobile, name: w.name }) : null;
    const e = await tx.waitlistEntry.create({
      data: {
        companyId: actor.companyId,
        branchId: outlet.branchId,
        outletId: outlet.id,
        guestId: guest?.id ?? null,
        name: w.name,
        mobile: w.mobile ?? null,
        partySize: w.partySize,
        quotedMin,
        note: w.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'waitlist.joined',
      entityType: 'waitlist',
      entityId: e.id,
      after: { name: w.name, size: w.partySize, quotedMin },
    });
    return e;
  });
  return view(row);
}

export const waitActSchema = z.object({
  action: z.enum(['call', 'seat', 'leave']),
  tableIds: z.array(z.string().min(1).max(40)).max(12).optional(),
});
export async function actOnWaitlist(db: Db, actor: Actor, id: string, input: z.input<typeof waitActSchema>) {
  host(actor);
  const p = waitActSchema.parse(input);
  const e = await db.waitlistEntry.findFirst({ where: { id, companyId: actor.companyId } });
  if (!e) throw notFound('Waitlist entry');
  const outlet = await staffOutlet(db, actor, e.outletId);
  const to = transition(waitlistMachine, {
    from: e.status as WaitlistStatus,
    action: p.action as WaitlistAction,
    roles: ['staff'],
    ctx: {},
  }).to;
  const ctx = ctxOf(actor);
  let order: { id: string; number: number } | null = null;
  if (p.action === 'seat') {
    if (!p.tableIds?.length) throw new AppError(400, 'VALIDATION_FAILED', 'Choose a table');
    order = await openOrder(db, actor, {
      outletId: outlet.id,
      type: 'DINE_IN',
      tableIds: p.tableIds,
      covers: Math.min(200, e.partySize),
      guestName: e.name,
      note: e.note,
    });
  }
  const row = await db.$transaction(async (tx) => {
    if (order && e.guestId)
      await tx.posOrder.update({ where: { id: order.id }, data: { guestId: e.guestId } });
    const after = await tx.waitlistEntry.update({
      where: { id },
      data: {
        status: to,
        ...(p.action === 'call' ? { calledAt: new Date() } : {}),
        ...(p.action === 'seat' ? { seatedAt: new Date(), orderId: order?.id ?? null } : {}),
        ...(p.action === 'leave' ? { leftAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: `waitlist.${p.action}`,
      entityType: 'waitlist',
      entityId: id,
      before: { status: e.status },
      after: { status: to, orderId: order?.id ?? null },
    });
    // "Your table is ready" goes to the guest's mobile (when one was given).
    if (p.action === 'call')
      await emitEvent(tx, ctx, {
        name: 'reservation.table_ready',
        entityType: 'waitlist',
        entityId: id,
        payload: {
          branchId: outlet.branchId,
          outletId: outlet.id,
          outlet: outlet.name,
          customer: e.name,
          customerMobile: e.mobile,
          size: e.partySize,
        },
      });
    return after;
  });
  return { ...view(row), order };
}
