import { createHmac, randomBytes } from 'node:crypto';
import type { Db, DomainEvent } from '@mono/db';
import { WEBHOOK_EVENT_PATTERN } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { decryptJson, encryptJson } from '../../lib/secrets';
import type { Env } from '../../env';
import type { Actor } from '../work/actor';
import { needAdmin } from './keys';
import { assertPublicUrl } from './safe-url';
import { reachOfUser } from '../branches/reach';

const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });

/** Where outgoing calls may go: https and public addresses in production (no SSRF into the server's network). */
export type WebhookNet = {
  secret: string;
  production: boolean;
  allowPrivate?: boolean;
  fetch?: typeof fetch;
  resolve?: (h: string) => Promise<string[]>;
};

export const netOf = (env: Env): WebhookNet => ({
  secret: env.APP_SECRET,
  production: env.NODE_ENV === 'production',
  allowPrivate: env.WEBHOOK_ALLOW_PRIVATE && env.NODE_ENV !== 'production',
});

/** Events never sent out: sign-ins and passwords. */
const PRIVATE_EVENTS = /^(auth\.|user\.password_reset$|telegram\.codes_sent$)/;
const eventPattern = z
  .string()
  .regex(WEBHOOK_EVENT_PATTERN, 'An event name like crm.order_taken, crm.* or *');

export const webhookSchema = z.object({
  url: z.string().trim().max(500),
  events: z.array(eventPattern).min(1).max(60),
  description: z.string().trim().max(200).nullish(),
  active: z.boolean().default(true),
});

export const matchesEvent = (patterns: string[], name: string) =>
  !PRIVATE_EVENTS.test(name) &&
  patterns.some((p) => p === '*' || p === name || (p.endsWith('.*') && name.startsWith(p.slice(0, -1))));

const newSecret = () => `whsec_${randomBytes(24).toString('base64url')}`;

async function checkUrl(url: string, net: WebhookNet) {
  try {
    return await assertPublicUrl(url, net);
  } catch (e) {
    throw new AppError(400, 'VALIDATION_FAILED', (e as Error).message, {
      fields: { url: (e as Error).message },
    });
  }
}

export async function listWebhooks(db: Db, actor: Actor) {
  needAdmin(actor);
  const hooks = await db.webhook.findMany({
    where: { companyId: actor.companyId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const stats = await db.webhookDelivery.groupBy({
    by: ['webhookId', 'status'],
    where: { webhookId: { in: hooks.map((h) => h.id) } },
    _count: true,
  });
  const count = (id: string, s: string) =>
    stats.find((x) => x.webhookId === id && x.status === s)?._count ?? 0;
  return hooks.map((h) => ({
    id: h.id,
    url: h.url,
    events: h.events,
    description: h.description,
    active: h.active,
    createdAt: h.createdAt,
    sent: count(h.id, 'SENT'),
    failed: count(h.id, 'FAILED'),
    pending: count(h.id, 'PENDING'),
  }));
}

/** Add or change a webhook. A new one gets a signing secret, shown once. */
export async function saveWebhook(
  db: Db,
  actor: Actor,
  net: WebhookNet,
  input: z.input<typeof webhookSchema>,
  id?: string,
) {
  needAdmin(actor);
  const w = webhookSchema.parse(input);
  await checkUrl(w.url, net);
  const before = id
    ? await db.webhook.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })
    : null;
  if (id && !before) throw notFound('Webhook');
  const signing = id ? null : newSecret();
  const data = {
    url: w.url,
    events: [...new Set(w.events)],
    description: w.description ?? null,
    active: w.active,
  };
  const row = await db.$transaction(async (tx) => {
    const r = id
      ? await tx.webhook.update({ where: { id }, data })
      : await tx.webhook.create({
          data: {
            ...data,
            companyId: actor.companyId,
            secret: encryptJson({ secret: signing }, net.secret),
            createdById: actor.userId,
          },
        });
    await writeAudit(tx, ctxOf(actor), {
      action: id ? 'webhook.changed' : 'webhook.created',
      entityType: 'webhook',
      entityId: r.id,
      before: before ? { url: before.url, events: before.events, active: before.active } : null,
      after: data,
    });
    return r;
  });
  return { id: row.id, secret: signing };
}

export async function deleteWebhook(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const h = await db.webhook.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!h) throw notFound('Webhook');
  await db.$transaction(async (tx) => {
    await tx.webhook.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await tx.webhookDelivery.updateMany({
      where: { webhookId: id, status: 'PENDING' },
      data: { status: 'FAILED', error: 'Webhook deleted' },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'webhook.deleted',
      entityType: 'webhook',
      entityId: id,
      before: { url: h.url },
    });
  });
  return { ok: true };
}

/** A new signing secret (the old one stops at once), shown once. */
export async function rotateSecret(db: Db, actor: Actor, net: WebhookNet, id: string) {
  needAdmin(actor);
  const h = await db.webhook.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!h) throw notFound('Webhook');
  const signing = newSecret();
  await db.$transaction(async (tx) => {
    await tx.webhook.update({
      where: { id },
      data: { secret: encryptJson({ secret: signing }, net.secret) },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'webhook.secret_rotated',
      entityType: 'webhook',
      entityId: id,
    });
  });
  return { id, secret: signing };
}

export async function listDeliveries(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const h = await db.webhook.findFirst({ where: { id, companyId: actor.companyId } });
  if (!h) throw notFound('Webhook');
  return db.webhookDelivery.findMany({
    where: { webhookId: id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      event: true,
      status: true,
      tries: true,
      responseCode: true,
      error: true,
      sentAt: true,
      createdAt: true,
      nextAt: true,
    },
  });
}

/** The JSON body of a delivery and its signature headers (`t.body` signed with HMAC-SHA256). */
export function signedRequest(signing: string, deliveryId: string, body: object, now = new Date()) {
  const text = JSON.stringify(body);
  const ts = String(Math.floor(now.getTime() / 1000));
  const sig = createHmac('sha256', signing).update(`${ts}.${text}`).digest('hex');
  return {
    body: text,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'MONO-Webhooks/1',
      'X-Mono-Event': (body as { event?: string }).event ?? 'unknown',
      'X-Mono-Delivery': deliveryId,
      'X-Mono-Timestamp': ts,
      'X-Mono-Signature': `sha256=${sig}`,
    },
  };
}

const bodyOf = (
  e: Pick<DomainEvent, 'id' | 'name' | 'occurredAt' | 'entityType' | 'entityId' | 'payload'>,
) => ({
  id: e.id,
  event: e.name,
  occurredAt: e.occurredAt.toISOString(),
  entity: e.entityType ? { type: e.entityType, id: e.entityId } : null,
  data: e.payload,
});

/** Post one request; never follows redirects (a redirect could point inside the network). */
async function post(url: string, req: ReturnType<typeof signedRequest>, net: WebhookNet) {
  await assertPublicUrl(url, net);
  const res = await (net.fetch ?? fetch)(url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  await res.body?.cancel().catch(() => undefined);
  return res.status;
}

/** Send a test call now and say what came back. */
export async function testWebhook(db: Db, actor: Actor, net: WebhookNet, id: string) {
  needAdmin(actor);
  const h = await db.webhook.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!h) throw notFound('Webhook');
  const signing = decryptJson<{ secret: string }>(h.secret, net.secret)!.secret;
  const body = bodyOf({
    id: `test_${randomBytes(6).toString('hex')}`,
    name: 'webhook.test',
    occurredAt: new Date(),
    entityType: 'webhook',
    entityId: h.id,
    payload: { hello: 'This is a test from MONO' },
  });
  try {
    const status = await post(h.url, signedRequest(signing, body.id, body), net);
    return { ok: status >= 200 && status < 300, status, error: null };
  } catch (e) {
    return { ok: false, status: null, error: (e as Error).message.slice(0, 200) };
  }
}

/** The branch of the record an event is about, for the kinds of record that carry one. */
async function branchOfEvent(db: Db, event: DomainEvent): Promise<string | null> {
  const id = event.entityId;
  if (!id) return null;
  const where = { id, companyId: event.companyId };
  const select = { branchId: true };
  switch (event.entityType) {
    case 'task':
      return (await db.task.findFirst({ where, select }))?.branchId ?? null;
    case 'checklist_run':
      return (await db.checklistRun.findFirst({ where, select }))?.branchId ?? null;
    case 'slip':
      return (await db.slip.findFirst({ where, select }))?.branchId ?? null;
    case 'ticket':
      return (await db.ticket.findFirst({ where, select }))?.branchId ?? null;
    case 'fms_record':
      return (await db.fmsRecord.findFirst({ where, select }))?.branchId ?? null;
    case 'record':
      return (await db.recordEntry.findFirst({ where, select }))?.branchId ?? null;
    case 'purchase_order':
      return (await db.purchaseOrder.findFirst({ where, select }))?.branchId ?? null;
    case 'sales_order':
      return (await db.salesOrder.findFirst({ where, select }))?.branchId ?? null;
    default:
      return null;
  }
}

/** Worker, for every event: a delivery for each active webhook that wants it (once per webhook and event). */
export async function queueWebhooks(db: Db, event: DomainEvent) {
  if (PRIVATE_EVENTS.test(event.name)) return 0;
  const hooks = await db.webhook.findMany({
    where: { companyId: event.companyId, active: true, deletedAt: null },
    select: { id: true, events: true, createdById: true },
  });
  let want = hooks.filter((h) => matchesEvent(h.events, event.name));
  if (!want.length) return 0;
  // A webhook carries its maker's reach (phase 12): an event about a record of a branch its maker can't see is
  // not sent to it. Events about things with no branch go to everyone, as before.
  const branchId = await branchOfEvent(db, event);
  if (branchId) {
    const kept = [];
    for (const h of want) {
      const reach = h.createdById ? await reachOfUser(db, event.companyId, h.createdById) : null;
      if (!reach || reach.branchIds === null || reach.branchIds.includes(branchId)) kept.push(h);
    }
    want = kept;
    if (!want.length) return 0;
  }
  const r = await db.webhookDelivery.createMany({
    data: want.map((h) => ({
      companyId: event.companyId,
      webhookId: h.id,
      eventId: event.id,
      event: event.name,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

export const WEBHOOK_TRIES = 6;
/** Waits after each failed try: 30 s, 2 min, 8 min, 32 min, ~2 h. */
export const retryDelayMs = (tries: number) => 30_000 * 4 ** (tries - 1);

/** Worker: send what is due. A 2xx is SENT; anything else retries with backoff, FAILED after the last try. */
export async function sendWebhooks(db: Db, net: WebhookNet, now = new Date()) {
  const due = await db.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAt: { lte: now } },
    orderBy: { nextAt: 'asc' },
    take: 50,
    include: { webhook: true },
  });
  let sent = 0;
  for (const d of due) {
    if (!d.webhook.active || d.webhook.deletedAt) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: 'FAILED', error: 'Webhook turned off' },
      });
      continue;
    }
    const event = await db.domainEvent.findUnique({ where: { id: d.eventId } });
    if (!event) {
      await db.webhookDelivery.update({
        where: { id: d.id },
        data: { status: 'FAILED', error: 'Event no longer exists' },
      });
      continue;
    }
    const tries = d.tries + 1;
    let code: number | null = null;
    let error: string | null = null;
    try {
      const signing = decryptJson<{ secret: string }>(d.webhook.secret, net.secret)!.secret;
      code = await post(d.webhook.url, signedRequest(signing, d.id, bodyOf(event), now), net);
      if (code < 200 || code >= 300) error = `HTTP ${code}`;
    } catch (e) {
      error = (e as Error).message.slice(0, 300);
    }
    if (!error) sent++;
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: error
        ? {
            tries,
            responseCode: code,
            error,
            ...(tries >= WEBHOOK_TRIES
              ? { status: 'FAILED' }
              : { nextAt: new Date(now.getTime() + retryDelayMs(tries)) }),
          }
        : { tries, responseCode: code, error: null, status: 'SENT', sentAt: new Date() },
    });
  }
  return sent;
}
