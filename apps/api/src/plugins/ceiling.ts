import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens';

export type CeilingOptions = {
  /** Calls a minute for one signed-in person or API key, and for one IP's requests that are not signed in. 0 = off. */
  perMinute: number;
  /** Calls a minute for all signed-in traffic from one IP together (abuse backstop). 0 = off. */
  perIpMinute: number;
  /** APP_SECRET: checks the access cookie's signature. */
  secret: string;
};

/** How long a key that authenticated stays known (minutes). A revoked key falls back to the per-IP count after it. */
const KEY_MEMORY_MINUTES = 10;
const KEY_MEMORY_MAX = 10_000;
const KEY_SHAPE = /^mono_[0-9a-f]{12}_[A-Za-z0-9_-]{20,}$/;

function apiKeyOf(request: FastifyRequest): string | null {
  const h = request.headers.authorization;
  const x = request.headers['x-api-key'];
  const raw = h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : typeof x === 'string' ? x.trim() : '';
  return KEY_SHAPE.test(raw) ? createHash('sha256').update(raw).digest('hex') : null;
}

/**
 * A ceiling on API calls per minute, on top of each route's own limit (decision 62 keeps those per route).
 *
 * Who is counted: the signed-in person (a valid access cookie; the signature is checked, the database is not) or
 * the API key; otherwise the IP. A whole office or outlet shares one public address, so counting signed-in people
 * by IP would make ~50 staff share one budget. An API key can't be checked without the database, so a key counts
 * as itself only after it has authenticated once (remembered by its hash for a few minutes); until then, and for
 * made-up keys, the IP is counted. Signed-in traffic from one IP also has a much higher total, as a backstop.
 *
 * It is its own small counter, not @fastify/rate-limit's global mode: that mode marks a request as "limited" once,
 * so a global hook running first would switch off a route's stricter limit (login, imports).
 * Live updates (/api/events) and the health check are not counted.
 */
export default fp(async function ceilingPlugin(app: FastifyInstance, opts: CeilingOptions) {
  if (opts.perMinute <= 0) return;
  let window = 0;
  let counts = new Map<string, number>();
  /** sha256 of keys that authenticated → the minute they are forgotten. */
  const knownKeys = new Map<string, number>();
  const candidates = new WeakMap<FastifyRequest, string>();

  const over = (key: string, max: number) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return max > 0 && n > max;
  };

  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || /^\/api\/(events|health)(\?|$)/.test(request.url)) return;
    const now = Math.floor(Date.now() / 60_000);
    if (now !== window) {
      window = now;
      counts = new Map();
      for (const [k, until] of knownKeys) if (until <= now) knownKeys.delete(k);
    }

    let who: string | null = null;
    const token = request.cookies?.[ACCESS_COOKIE];
    const claims = token ? await verifyAccessToken(token, opts.secret) : null;
    if (claims) who = `u:${claims.sub}`;
    else {
      const key = apiKeyOf(request);
      if (key) {
        if (knownKeys.has(key)) who = `k:${key}`;
        else candidates.set(request, key);
      }
    }

    const limited = who
      ? // Both are counted even when the first is over, so a flood by one person still fills the IP's total.
        [over(who, opts.perMinute), over(`t:${request.ip}`, opts.perIpMinute)].some(Boolean)
      : over(`a:${request.ip}`, opts.perMinute);
    if (limited) {
      reply.header('Retry-After', String(60 - Math.floor((Date.now() / 1000) % 60)));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.');
    }
  });

  // A key that just authenticated (the public API sets `auth` with an `api:` session) is counted as itself from now on.
  app.addHook('onResponse', async (request) => {
    const key = candidates.get(request);
    if (!key || !request.auth?.sessionId.startsWith('api:')) return;
    if (knownKeys.size >= KEY_MEMORY_MAX) knownKeys.clear();
    knownKeys.set(key, Math.floor(Date.now() / 60_000) + KEY_MEMORY_MINUTES);
  });
});
