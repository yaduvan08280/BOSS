import { createHmac, timingSafeEqual } from 'node:crypto';
import { createId } from '@paralleldrive/cuid2';
import type { Connection, Db, PayLink } from '@mono/db';
import {
  payLinkMade,
  payLinkRequest,
  payLinkSchema,
  payWebhook,
  type Gateway,
  type PayPurpose,
} from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { takeAdvance as banquetAdvance } from '../banquet/day';
import { need } from '../hosp/access';
import { payCheck } from '../hosp/payments';
import { payDeposit } from '../hosp/res-flow';
import { takeAdvance as stayAdvance } from '../hotel/folio';
import type { Actor } from '../work/actor';
import { callOut, logIn, metaOf, needConnection, type Net, type Opened } from './core';

/**
 * Phase 19 — payment links. A link is made at the company's gateway (Razorpay or Cashfree) for a table deposit, a
 * stay's or a banquet's advance, or a restaurant bill; when the gateway's webhook says it was paid — and its
 * signature is right — MONO records the money exactly as a person at the desk would: once.
 */
type Subject = {
  amount: number;
  description: string;
  customer: { name: string; phone?: string | null; email?: string | null };
};

async function subjectOf(
  db: Db,
  companyId: string,
  purpose: PayPurpose,
  refId: string,
  asked?: number,
): Promise<Subject> {
  const guestOf = async (id: string) => {
    const g = await db.guest.findFirst({ where: { id, companyId } });
    return {
      name: g?.name ?? 'Guest',
      phone: g?.mobile.startsWith('+000') ? null : g?.mobile,
      email: g?.email,
    };
  };
  if (purpose === 'RESERVATION_DEPOSIT') {
    const r = await db.reservation.findFirst({ where: { id: refId, companyId } });
    if (!r) throw notFound('Reservation');
    if (r.depositState !== 'DUE') throw new AppError(409, 'CONFLICT', 'No deposit is due on this booking');
    return { amount: Number(r.depositDue), description: 'Table deposit', customer: await guestOf(r.guestId) };
  }
  if (purpose === 'STAY_ADVANCE') {
    const s = await db.stay.findFirst({ where: { id: refId, companyId } });
    if (!s) throw notFound('Booking');
    if (!asked) throw new AppError(400, 'VALIDATION_FAILED', 'Type the advance to ask for');
    return {
      amount: asked,
      description: `Advance for booking ${s.number}`,
      customer: await guestOf(s.guestId),
    };
  }
  if (purpose === 'BANQUET_ADVANCE') {
    const e = await db.banquetEvent.findFirst({ where: { id: refId, companyId } });
    if (!e) throw notFound('Event');
    if (!asked) throw new AppError(400, 'VALIDATION_FAILED', 'Type the advance to ask for');
    return {
      amount: asked,
      description: `Advance for ${e.occasion} (${e.number})`,
      customer: await guestOf(e.guestId),
    };
  }
  const c = await db.posCheck.findFirst({ where: { id: refId, companyId } });
  if (!c) throw notFound('Bill');
  if (c.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This bill is not open');
  const bill = await db.bill.findUniqueOrThrow({ where: { id: c.billId } });
  const due = Number(bill.total - bill.credited - bill.settled);
  const order = await db.posOrder.findUniqueOrThrow({ where: { id: c.orderId } });
  return {
    amount: asked ?? due,
    description: `Bill ${c.number}`,
    customer: { name: order.guestName ?? 'Guest' },
  };
}

const view = (l: PayLink) => ({
  id: l.id,
  purpose: l.purpose,
  refId: l.refId,
  amount: Number(l.amount),
  url: l.url,
  status: l.status,
  paidAt: l.paidAt,
  note: l.note,
});

export async function createPayLink(db: Db, net: Net, actor: Actor, input: z.input<typeof payLinkSchema>) {
  need(actor, 'hosp.create', "You can't ask for payments");
  const p = payLinkSchema.parse(input);
  const conn = await needConnection(db, net, actor.companyId, 'GATEWAY', '', 'A payment gateway');
  const subject = await subjectOf(db, actor.companyId, p.purpose, p.refId, p.amount);
  // One live link at a time for the same thing: asking again hands back the one that is waiting.
  const waiting = await db.payLink.findFirst({
    where: {
      companyId: actor.companyId,
      purpose: p.purpose,
      refId: p.refId,
      status: 'CREATED',
      amount: BigInt(subject.amount),
    },
  });
  if (waiting) return view(waiting);
  const reference = `pl_${createId()}`;
  const req = payLinkRequest(conn.provider as Gateway, conn.keys, {
    reference,
    amount: subject.amount,
    description: subject.description,
    customer: subject.customer,
    callbackUrl: `${(net.baseUrl ?? '').replace(/\/$/, '')}/paid`,
  });
  const out = await callOut(db, net, conn, { what: 'paylink', ref: reference, ...req });
  const made = out.ok ? payLinkMade(conn.provider as Gateway, out.json) : null;
  if (!made) throw new AppError(409, 'CONFLICT', out.error ?? 'The gateway did not make a link');
  const row = await db.$transaction(async (tx) => {
    const link = await tx.payLink.create({
      data: {
        companyId: actor.companyId,
        purpose: p.purpose,
        refId: p.refId,
        reference,
        amount: BigInt(subject.amount),
        gateway: conn.provider,
        providerId: made.id,
        url: made.url,
        createdById: actor.userId,
      },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'paylink.created',
        entityType: 'pay_link',
        entityId: link.id,
        after: { purpose: p.purpose, refId: p.refId, amount: subject.amount },
      },
    );
    return link;
  });
  return view(row);
}

export async function listPayLinks(db: Db, actor: Actor, purpose: PayPurpose, refId: string) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const rows = await db.payLink.findMany({
    where: { companyId: actor.companyId, purpose, refId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(view);
}
/** Stop waiting for a link (MONO will ignore a payment on it; the gateway's own link is not withdrawn). */
export async function cancelPayLink(db: Db, actor: Actor, id: string) {
  need(actor, 'hosp.create', "You can't change payment links");
  const link = await db.payLink.findFirst({ where: { id, companyId: actor.companyId } });
  if (!link) throw notFound('Link');
  if (link.status !== 'CREATED') throw new AppError(409, 'CONFLICT', 'This link is already closed');
  return view(await db.payLink.update({ where: { id }, data: { status: 'CANCELLED' } }));
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
/** Is this webhook really from the gateway? Each signs the raw body its own way. */
export function signatureOk(
  conn: Opened,
  raw: string,
  headers: Record<string, string | string[] | undefined>,
) {
  const h = (k: string) => (Array.isArray(headers[k]) ? headers[k][0] : headers[k]) ?? '';
  if (conn.provider === 'RAZORPAY') {
    const secret = conn.keys.webhookSecret;
    return (
      Boolean(secret) &&
      same(createHmac('sha256', secret!).update(raw).digest('hex'), h('x-razorpay-signature'))
    );
  }
  const secret = conn.keys.clientSecret;
  const ts = h('x-webhook-timestamp');
  return (
    Boolean(secret && ts) &&
    same(
      createHmac('sha256', secret!)
        .update(ts + raw)
        .digest('base64'),
      h('x-webhook-signature'),
    )
  );
}

/** The payment mode the gateway's money is booked under: the one chosen, else one made for it. */
async function gatewayMode(db: Db, conn: Connection) {
  const chosen = metaOf(conn).modeId;
  const mode =
    (chosen &&
      (await db.paymentMode.findFirst({
        where: { id: chosen, companyId: conn.companyId, deletedAt: null },
      }))) ||
    (await db.paymentMode.findFirst({
      where: { companyId: conn.companyId, name: 'Payment gateway', deletedAt: null },
    })) ||
    (await db.paymentMode.create({
      data: { companyId: conn.companyId, name: 'Payment gateway', kind: 'WALLET', needsRef: true },
    }));
  return mode.id;
}

/**
 * A gateway's webhook. A wrong signature is refused; an event that is not a paid link is ignored; a link already
 * paid or cancelled is not paid again; an amount that differs from the link is kept for a person to look at.
 */
export async function gatewayWebhook(
  db: Db,
  net: Net,
  hookToken: string,
  raw: string,
  headers: Record<string, string | string[] | undefined>,
) {
  const row = await db.connection.findUnique({ where: { hookToken } });
  if (!row || row.kind !== 'GATEWAY' || !row.active) throw notFound('Webhook');
  const conn = (await needConnection(db, net, row.companyId, 'GATEWAY'))!;
  if (!signatureOk(conn, raw, headers)) {
    await logIn(db, conn, 'payment', null, false, 'The signature did not match');
    throw new AppError(401, 'UNAUTHENTICATED', 'The signature did not match');
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AppError(400, 'VALIDATION_FAILED', 'Not JSON');
  }
  const paid = payWebhook(conn.provider as Gateway, json);
  if (!paid) return { ok: true, ignored: true };
  const link = await db.payLink.findUnique({ where: { reference: paid.reference } });
  if (!link || link.companyId !== conn.companyId) {
    await logIn(db, conn, 'payment', paid.reference, false, 'No such link');
    return { ok: true, ignored: true };
  }
  if (link.status !== 'CREATED') {
    await logIn(
      db,
      conn,
      'payment',
      paid.reference,
      true,
      link.status === 'PAID' ? 'Already recorded' : 'The link was cancelled',
    );
    return { ok: true, again: link.status === 'PAID' };
  }
  if (paid.amount !== Number(link.amount)) {
    const note = `Paid ${(paid.amount / 100).toFixed(2)} on a link of ${(Number(link.amount) / 100).toFixed(2)} (${paid.paymentId})`;
    await db.payLink.update({ where: { id: link.id }, data: { note } });
    await logIn(db, conn, 'payment', paid.reference, false, note);
    return { ok: true, mismatch: true };
  }
  // The money is recorded as the person who made the link would have done it at the desk.
  const actor: Actor = {
    companyId: conn.companyId,
    userId: link.createdById ?? '',
    permissions: ['hosp.create', 'hosp.view'],
  };
  const money = { modeId: await gatewayMode(db, conn), reference: paid.paymentId };
  try {
    if (link.purpose === 'RESERVATION_DEPOSIT') await payDeposit(db, actor, link.refId, money);
    else if (link.purpose === 'STAY_ADVANCE')
      await stayAdvance(db, actor, link.refId, { ...money, amount: paid.amount });
    else if (link.purpose === 'BANQUET_ADVANCE')
      await banquetAdvance(db, actor, link.refId, { ...money, amount: paid.amount });
    else await payCheck(db, actor, link.refId, { payments: [{ ...money, amount: paid.amount }] });
  } catch (e) {
    const note = `Paid (${paid.paymentId}) but not recorded: ${e instanceof Error ? e.message : 'error'}`;
    await db.payLink.update({ where: { id: link.id }, data: { note } });
    await logIn(db, conn, 'payment', paid.reference, false, note);
    return { ok: true, recorded: false };
  }
  await db.payLink.update({
    where: { id: link.id },
    data: { status: 'PAID', paidAt: new Date(), paymentId: paid.paymentId },
  });
  await logIn(db, conn, 'payment', paid.reference, true);
  return { ok: true, recorded: true };
}
