import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';
import { ACCESS_COOKIE, verifyAccessToken } from '../lib/tokens';

/** One internet address may carry this many people's worth of calls before the address itself is held back. */
export const ADDRESS_FACTOR = 20;

/**
 * A ceiling on API calls per minute, on top of each route's own limit (decision 62 keeps those per route).
 *
 * It is counted **per signed-in person**: everyone in one office or outlet shares one internet address, so a
 * count per address would make 30 tablets lock each other out. Whoever is not signed in (or sends a token that
 * does not verify) is counted per address. As a flood guard, one address is also held to `ADDRESS_FACTOR` times
 * the ceiling in total.
 *
 * The person is read from the signed access cookie only (no database call); a forged cookie fails the signature
 * and falls back to the address. API keys keep their own per-key limit (/api/v1) and count per address here.
 *
 * It is its own small counter, not @fastify/rate-limit's global mode: that mode marks a request as "limited"
 * once, so a global hook running first would switch off a route's stricter limit (login, imports).
 * Live updates (/api/events) and the health check are not counted.
 */
export default fp(async function ceilingPlugin(
  app: FastifyInstance,
  opts: { perMinute: number; secret: string; addressFactor?: number },
) {
  if (opts.perMinute <= 0) return;
  const perAddress = opts.perMinute * (opts.addressFactor ?? ADDRESS_FACTOR);
  let window = 0;
  let counts = new Map<string, number>();
  const bump = (key: string) => {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n;
  };
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || /^\/api\/(events|health)(\?|$)/.test(request.url)) return;
    const now = Math.floor(Date.now() / 60_000);
    if (now !== window) {
      window = now;
      counts = new Map();
    }
    const token = request.cookies?.[ACCESS_COOKIE];
    const claims = token ? await verifyAccessToken(token, opts.secret) : null;
    const over = claims
      ? bump(`person:${claims.sub}`) > opts.perMinute || bump(`address:${request.ip}`) > perAddress
      : bump(`visitor:${request.ip}`) > opts.perMinute;
    if (over) {
      reply.header('Retry-After', String(60 - Math.floor((Date.now() / 1000) % 60)));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.');
    }
  });
});
