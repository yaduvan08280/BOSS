import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

/**
 * A ceiling on API calls per IP per minute, on top of each route's own limit (decision 62 keeps those per route).
 * It is its own small counter, not @fastify/rate-limit's global mode: that mode marks a request as "limited" once,
 * so a global hook running first would switch off a route's stricter limit (login, imports).
 * Live updates (/api/events) and the health check are not counted.
 */
export default fp(async function ceilingPlugin(app: FastifyInstance, opts: { perMinute: number }) {
  if (opts.perMinute <= 0) return;
  let window = 0;
  let counts = new Map<string, number>();
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || /^\/api\/(events|health)(\?|$)/.test(request.url)) return;
    const now = Math.floor(Date.now() / 60_000);
    if (now !== window) {
      window = now;
      counts = new Map();
    }
    const n = (counts.get(request.ip) ?? 0) + 1;
    counts.set(request.ip, n);
    if (n > opts.perMinute) {
      reply.header('Retry-After', String(60 - Math.floor((Date.now() / 1000) % 60)));
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Wait a minute and try again.');
    }
  });
});
