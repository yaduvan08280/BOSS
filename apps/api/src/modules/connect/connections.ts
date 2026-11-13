import type { Db } from '@mono/db';
import { connectionSchema, type ConnectionKind } from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { encryptJson } from '../../lib/secrets';
import { can, type Actor } from '../work/actor';
import { metaOf, newToken, type Net } from './core';

/**
 * Phase 19 — connections: a channel manager for a property, the company's payment gateway and its e-invoice
 * provider. Keys are stored encrypted and never sent back; only admins of integrations change them.
 */
const admin = (a: Actor) => {
  if (!can(a, 'integrations.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only integration admins change connections');
};
const ctxOf = (a: Actor) => ({ ...a, actorId: a.userId });
const KEYS: Record<string, string[]> = {
  'GATEWAY:RAZORPAY': ['keyId', 'keySecret', 'webhookSecret'],
  'GATEWAY:CASHFREE': ['clientId', 'clientSecret'],
  CHANNEL: ['token'],
  EINVOICE: ['token'],
};

export async function listConnections(db: Db, actor: Actor) {
  if (!can(actor, 'integrations.view')) throw new AppError(403, 'FORBIDDEN', "You can't see integrations");
  const rows = await db.connection.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ kind: 'asc' }, { scope: 'asc' }],
  });
  const waiting = await db.syncLog.groupBy({
    by: ['connectionId', 'status'],
    where: { companyId: actor.companyId, status: { in: ['PENDING', 'FAILED'] } },
    _count: { _all: true },
  });
  return rows.map((c) => ({
    id: c.id,
    kind: c.kind,
    branchId: c.scope || null,
    provider: c.provider,
    baseUrl: c.baseUrl,
    // Never the keys: only whether they are saved.
    hasSecret: Boolean(c.secret),
    hookPath: `/api/hooks/${c.kind.toLowerCase()}/${c.hookToken}`,
    ...metaOf(c),
    active: c.active,
    lastOkAt: c.lastOkAt,
    lastError: c.lastError,
    lastErrorAt: c.lastErrorAt,
    pending: waiting.find((w) => w.connectionId === c.id && w.status === 'PENDING')?._count._all ?? 0,
    failed: waiting.find((w) => w.connectionId === c.id && w.status === 'FAILED')?._count._all ?? 0,
  }));
}

export async function saveConnection(
  db: Db,
  net: Net,
  actor: Actor,
  input: z.input<typeof connectionSchema>,
) {
  admin(actor);
  const c = connectionSchema.parse(input);
  const scope = c.kind === 'CHANNEL' ? (c.branchId ?? '') : '';
  if (c.kind === 'CHANNEL' && !scope)
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose the property this channel manager serves');
  if (c.kind === 'GATEWAY' && !['RAZORPAY', 'CASHFREE'].includes(c.provider.toUpperCase()))
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose Razorpay or Cashfree');
  if (c.kind !== 'GATEWAY' && !c.baseUrl)
    throw new AppError(400, 'VALIDATION_FAILED', 'Type the provider’s address');
  const provider = c.kind === 'GATEWAY' ? c.provider.toUpperCase() : c.provider;
  const before = await db.connection.findUnique({
    where: { companyId_kind_scope: { companyId: actor.companyId, kind: c.kind, scope } },
  });
  // A different provider starts with fresh keys (decision: switching provider resets the connection).
  const fresh = !before || before.provider !== provider;
  const want = KEYS[`${c.kind}:${provider}`] ?? KEYS[c.kind] ?? [];
  if (fresh && want.some((k) => !c.secret?.[k] && k !== 'webhookSecret'))
    throw new AppError(400, 'VALIDATION_FAILED', `This connection needs: ${want.join(', ')}`);
  const data = {
    provider,
    baseUrl: c.baseUrl ?? null,
    meta: {
      rooms: c.rooms,
      plans: c.plans,
      defaultPlanId: c.defaultPlanId ?? null,
      modeId: c.modeId ?? null,
    },
    active: c.active,
    updatedById: actor.userId,
    ...(c.secret ? { secret: encryptJson(c.secret, net.secret) } : fresh ? { secret: null } : {}),
    ...(fresh ? { lastOkAt: null, lastError: null, lastErrorAt: null } : {}),
  };
  const row = await db.$transaction(async (tx) => {
    const saved = before
      ? await tx.connection.update({ where: { id: before.id }, data })
      : await tx.connection.create({
          data: { ...data, companyId: actor.companyId, kind: c.kind, scope, hookToken: newToken() },
        });
    await writeAudit(tx, ctxOf(actor), {
      action: before ? 'integration.updated' : 'integration.connected',
      entityType: 'connection',
      entityId: saved.id,
      // The audit never holds a key.
      after: {
        kind: c.kind,
        provider,
        baseUrl: c.baseUrl ?? null,
        keys: c.secret ? Object.keys(c.secret) : [],
      },
    });
    return saved;
  });
  return (await listConnections(db, actor)).find((x) => x.id === row.id)!;
}

export async function removeConnection(db: Db, actor: Actor, kind: ConnectionKind, branchId?: string | null) {
  admin(actor);
  const scope = kind === 'CHANNEL' ? (branchId ?? '') : '';
  const before = await db.connection.findUnique({
    where: { companyId_kind_scope: { companyId: actor.companyId, kind, scope } },
  });
  if (!before) return { ok: true };
  // The log of what was sent stays; the connection is switched off and its keys are wiped.
  await db.$transaction(async (tx) => {
    await tx.connection.update({ where: { id: before.id }, data: { active: false, secret: null } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'integration.disconnected',
      entityType: 'connection',
      entityId: before.id,
      before: { kind, provider: before.provider },
    });
  });
  return { ok: true };
}

/** What was sent and received lately (newest first), for the health screen. */
export async function syncLog(db: Db, actor: Actor, connectionId?: string) {
  if (!can(actor, 'integrations.view')) throw new AppError(403, 'FORBIDDEN', "You can't see integrations");
  const rows = await db.syncLog.findMany({
    where: { companyId: actor.companyId, ...(connectionId ? { connectionId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    connectionId: r.connectionId,
    direction: r.direction,
    what: r.what,
    ref: r.ref,
    status: r.status,
    tries: r.tries,
    error: r.error,
    at: r.createdAt,
  }));
}
