import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '@mono/db';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });
export const needAdmin = (actor: Actor) => {
  if (!can(actor, 'core.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only admins manage API keys and webhooks');
};
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const keySchema = z.object({ name: z.string().trim().min(2).max(60) });

/**
 * A new API key (CLAUDE.md §12): `mono_<prefix>_<secret>`, shown once. Only its sha256 is kept; the prefix finds it.
 * The key acts as the person who made it, with their role's permissions at the time of each call.
 */
export async function createApiKey(db: Db, actor: Actor, input: z.input<typeof keySchema>) {
  needAdmin(actor);
  const { name } = keySchema.parse(input);
  const prefix = randomBytes(6).toString('hex');
  const key = `mono_${prefix}_${randomBytes(24).toString('base64url')}`;
  const row = await db.$transaction(async (tx) => {
    const r = await tx.apiKey.create({
      data: {
        companyId: actor.companyId,
        name,
        prefix,
        hash: sha(key),
        last4: key.slice(-4),
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: r.id,
      after: { name, last4: r.last4 },
    });
    return r;
  });
  return { id: row.id, name, key, last4: row.last4 };
}

export async function listApiKeys(db: Db, actor: Actor) {
  needAdmin(actor);
  const keys = await db.apiKey.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: 'desc' },
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: keys.map((k) => k.createdById).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    masked: `mono_${k.prefix}_••••${k.last4}`,
    last4: k.last4,
    createdAt: k.createdAt,
    createdBy: k.createdById ? (names.get(k.createdById) ?? null) : null,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
  }));
}

export async function revokeApiKey(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const k = await db.apiKey.findFirst({ where: { id, companyId: actor.companyId } });
  if (!k) throw notFound('API key');
  if (k.revokedAt) return { ok: true };
  await db.$transaction(async (tx) => {
    await tx.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'api_key.revoked',
      entityType: 'api_key',
      entityId: id,
      before: { name: k.name },
    });
  });
  return { ok: true };
}

/**
 * The key on a request → who it acts as (null when unknown, revoked, or its maker can no longer sign in).
 * Compared in constant time; last-used is written at most once a minute.
 */
export async function resolveApiKey(db: Db, raw: string | undefined) {
  const m = raw ? /^mono_([0-9a-f]{12})_[A-Za-z0-9_-]{20,}$/.exec(raw.trim()) : null;
  if (!m) return null;
  const k = await db.apiKey.findUnique({ where: { prefix: m[1]! } });
  if (!k || k.revokedAt || !k.createdById) return null;
  const a = Buffer.from(sha(raw!.trim()));
  const b = Buffer.from(k.hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const user = await db.user.findFirst({
    where: { id: k.createdById, companyId: k.companyId, deletedAt: null, status: 'ACTIVE' },
    select: { id: true, role: { select: { key: true, permissions: true, reach: true } } },
  });
  if (!user) return null;
  if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000)
    await db.apiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } });
  return {
    keyId: k.id,
    prefix: k.prefix,
    companyId: k.companyId,
    userId: user.id,
    roleKey: user.role.key,
    permissions: user.role.permissions,
    reach: user.role.reach,
  };
}
