import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie auth: a browser request that changes data must come from our own origin.
 * Requests without an Origin header (curl, server-to-server with API keys) carry no browser cookies risk.
 */
export default fp(async function originPlugin(app: FastifyInstance, opts: { allowed: string[] }) {
  const allowed = new Set(opts.allowed);
  app.addHook('onRequest', async (request) => {
    if (SAFE.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) {
      throw new AppError(403, 'FORBIDDEN', 'Request blocked: unknown origin');
    }
  });
});
