import { createHash } from 'node:crypto';
import type { Db } from '@mono/db';
import { z } from 'zod';
import { notFound } from '../../lib/errors';
import { needAdmin } from '../platform/keys';
import type { Actor } from '../work/actor';

export type ErrorReport = {
  source: 'api' | 'worker' | 'web';
  message: string;
  stack?: string | null;
  path?: string | null;
  companyId?: string | null;
  userId?: string | null;
};

/** Numbers, ids and quoted values vary between occurrences of the same error; they don't split the group. */
const shape = (s: string) =>
  s
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '#')
    .replace(/\b[a-z0-9]{24,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/(["'`]).*?\1/g, '"…"')
    .slice(0, 300);
const firstFrame = (stack?: string | null) =>
  (stack ?? '')
    .split('\n')
    .find((l) => /^\s+at /.test(l))
    ?.trim()
    .replace(/:\d+:\d+\)?$/, '') ?? '';

/**
 * Error monitoring (phase 10): every unexpected error from the API, the worker or a browser is kept, grouped by its
 * shape (one row per kind, counted). Never throws — a broken error log must not break the request.
 */
export async function recordError(db: Db, r: ErrorReport) {
  try {
    const message = r.message.slice(0, 1000) || 'Unknown error';
    const fingerprint = createHash('sha1')
      .update(
        [
          r.companyId ?? '-',
          r.source,
          shape(message),
          firstFrame(r.stack),
          r.source === 'web' ? '' : (r.path ?? '').replace(/\/[a-z0-9]{20,}/gi, '/:id'),
        ].join('|'),
      )
      .digest('hex');
    await db.errorEvent.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        source: r.source,
        message,
        stack: r.stack?.slice(0, 8000) ?? null,
        path: r.path?.slice(0, 300) ?? null,
        companyId: r.companyId ?? null,
        lastUserId: r.userId ?? null,
      },
      update: {
        count: { increment: 1 },
        lastAt: new Date(),
        message,
        stack: r.stack?.slice(0, 8000) ?? null,
        path: r.path?.slice(0, 300) ?? null,
        lastUserId: r.userId ?? null,
        resolvedAt: null,
      },
    });
  } catch {
    // ignore: the log line is still written by the caller
  }
}

export const webErrorSchema = z.object({
  message: z.string().max(1000),
  stack: z.string().max(8000).nullish(),
  path: z.string().max(300).nullish(),
});

/** The owner sees errors without a company (worker, start-up) too; admins see their company's. */
export async function listErrors(db: Db, actor: Actor, showResolved = false) {
  needAdmin(actor);
  const owner = actor.permissions.includes('*');
  const rows = await db.errorEvent.findMany({
    where: {
      OR: [{ companyId: actor.companyId }, ...(owner ? [{ companyId: null }] : [])],
      ...(showResolved ? {} : { resolvedAt: null }),
    },
    orderBy: { lastAt: 'desc' },
    take: 200,
  });
  const names = new Map(
    (
      await db.user.findMany({
        where: { id: { in: rows.map((r) => r.lastUserId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    message: r.message,
    stack: r.stack,
    path: r.path,
    count: r.count,
    firstAt: r.firstAt,
    lastAt: r.lastAt,
    resolvedAt: r.resolvedAt,
    lastUser: r.lastUserId ? (names.get(r.lastUserId) ?? null) : null,
  }));
}

export async function resolveError(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const r = await db.errorEvent.findFirst({
    where: {
      id,
      OR: [{ companyId: actor.companyId }, ...(actor.permissions.includes('*') ? [{ companyId: null }] : [])],
    },
  });
  if (!r) throw notFound('Error');
  await db.errorEvent.update({ where: { id }, data: { resolvedAt: new Date() } });
  return { ok: true };
}
