import { randomBytes } from 'node:crypto';
import type { Connection, Db, Prisma } from '@mono/db';
import type { ConnectionKind } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { decryptJson } from '../../lib/secrets';
import { assertPublicUrl } from '../platform/safe-url';

/**
 * Phase 19 — what every integration shares: a connection with its opened secret, one way to call out (logged,
 * with the connection's health kept), and the log of what came in.
 */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
/** `secret`: APP_SECRET. `fetch`: the network (tests pass their own). `production`: https only, public addresses only. `baseUrl`: where MONO itself is reached. */
export type Net = { secret: string; fetch?: Fetch; production?: boolean; baseUrl?: string };
export type Opened = Connection & { keys: Record<string, string> };
export type ConnMeta = {
  rooms?: { roomTypeId: string; code: string }[];
  plans?: { ratePlanId: string; code: string }[];
  defaultPlanId?: string | null;
  modeId?: string | null;
};
export const metaOf = (c: Connection) => (c.meta ?? {}) as ConnMeta;
export const newToken = () => randomBytes(18).toString('base64url');

export async function connectionOf(
  db: Db,
  net: Net,
  companyId: string,
  kind: ConnectionKind,
  scope = '',
): Promise<Opened | null> {
  const c = await db.connection.findUnique({ where: { companyId_kind_scope: { companyId, kind, scope } } });
  if (!c || !c.active) return null;
  return { ...c, keys: decryptJson<Record<string, string>>(c.secret, net.secret) ?? {} };
}
export async function needConnection(
  db: Db,
  net: Net,
  companyId: string,
  kind: ConnectionKind,
  scope = '',
  what = 'This',
) {
  const c = await connectionOf(db, net, companyId, kind, scope);
  if (!c)
    throw new AppError(
      409,
      'CONFLICT',
      `${what} is not connected — set it up in System Master → Integration`,
    );
  return c;
}

type Call = {
  what: string;
  ref?: string | null;
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  basic?: [string, string];
  body?: unknown;
  /** Kept on the log so a failed push can be sent again by the worker. */
  retry?: boolean;
  logId?: string;
};
/**
 * Call an outside service: the address must be public (https in production), the answer is read as JSON, and
 * the call is logged with how it went — the connection shows when it last worked and what last went wrong.
 */
export async function callOut(db: Db, net: Net, conn: Connection, c: Call) {
  const started = Date.now();
  let status = 0;
  let json: unknown = null;
  let error: string | null = null;
  try {
    if (!net.fetch) await assertPublicUrl(c.url, { production: net.production ?? false });
    const headers: Record<string, string> = { accept: 'application/json', ...(c.headers ?? {}) };
    if (c.basic)
      headers.authorization = `Basic ${Buffer.from(`${c.basic[0]}:${c.basic[1]}`).toString('base64')}`;
    if (c.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    const res = await (net.fetch ?? fetch)(c.url, {
      method: c.method ?? 'POST',
      headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) error = `The service answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`;
  } catch (e) {
    error = e instanceof Error ? e.message : 'The service could not be reached';
  }
  const ok = !error;
  const data = {
    status: ok ? 'OK' : c.retry ? 'PENDING' : 'FAILED',
    error,
    doneAt: ok ? new Date() : null,
    nextTryAt: !ok && c.retry ? new Date(Date.now() + 5 * 60_000) : null,
  };
  const log = c.logId
    ? await db.syncLog.update({ where: { id: c.logId }, data: { ...data, tries: { increment: 1 } } })
    : await db.syncLog.create({
        data: {
          companyId: conn.companyId,
          connectionId: conn.id,
          direction: 'OUT',
          what: c.what,
          ref: c.ref ?? null,
          tries: 1,
          payload: (c.retry
            ? { url: c.url, method: c.method ?? 'POST', body: c.body }
            : { ms: Date.now() - started }) as Prisma.InputJsonValue,
          ...data,
        },
      });
  // Five tries, then it is failed for a person to look at.
  if (!ok && log.tries >= 5 && log.status === 'PENDING')
    await db.syncLog.update({ where: { id: log.id }, data: { status: 'FAILED', nextTryAt: null } });
  await db.connection.update({
    where: { id: conn.id },
    data: ok ? { lastOkAt: new Date(), lastError: null } : { lastError: error, lastErrorAt: new Date() },
  });
  return { ok, status, json, error, logId: log.id };
}

/** Something a service sent us, kept with what we made of it. */
export const logIn = (
  db: Db,
  conn: Connection,
  what: string,
  ref: string | null,
  ok: boolean,
  error?: string | null,
  payload?: unknown,
) =>
  db.syncLog.create({
    data: {
      companyId: conn.companyId,
      connectionId: conn.id,
      direction: 'IN',
      what,
      ref,
      status: ok ? 'OK' : 'FAILED',
      tries: 1,
      error: error ?? null,
      payload: (payload ?? undefined) as Prisma.InputJsonValue | undefined,
      doneAt: new Date(),
    },
  });

/** The network as the running server sees it. */
export const connectNet = (env: { APP_SECRET: string; NODE_ENV: string; BASE_URL: string }): Net => ({
  secret: env.APP_SECRET,
  production: env.NODE_ENV === 'production',
  baseUrl: env.BASE_URL,
});
