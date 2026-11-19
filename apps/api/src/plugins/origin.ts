import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie auth: a browser request that changes data must come from our own origin.
 * A request that carries a session cookie must also say where it comes from: every browser sends Origin on a
 * request that changes data, so a cookie with no Origin is not a browser we know — and is refused. Requests
 * with no cookie at all (an API key, the site agent, a provider's webhook) need no Origin.
 */
export default fp(async function originPlugin(app: FastifyInstance, opts: { allowed: string[] }) {
  const allowed = new Set(opts.allowed);
  app.addHook('onRequest', async (request) => {
    if (SAFE.has(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin)) {
      throw new AppError(403, 'FORBIDDEN', 'Request blocked: unknown origin');
    }
    if (!origin && /(?:^|;\s*)mono_(?:at|rt)=/.test(request.headers.cookie ?? '')) {
      throw new AppError(403, 'FORBIDDEN', 'Request blocked: it does not say where it comes from');
    }
  });
});
