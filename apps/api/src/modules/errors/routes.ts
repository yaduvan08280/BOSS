import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { listErrors, recordError, resolveError, webErrorSchema } from './service';

/** Error monitoring: browsers report here; admins read and close them in System Master → Errors. */
export async function errorRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['system'];
  r.post(
    '/api/errors',
    {
      onRequest: [app.authenticate],
      schema: { tags, body: webErrorSchema },
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (q) => {
      await recordError(app.prisma, {
        source: 'web',
        ...q.body,
        companyId: q.auth!.companyId,
        userId: q.auth!.userId,
      });
      return { ok: true };
    },
  );
  r.get(
    '/api/system/errors',
    {
      onRequest: [app.authenticate],
      schema: { tags, querystring: z.object({ all: z.enum(['0', '1']).optional() }) },
    },
    async (q) => listErrors(app.prisma, actorOf(q), q.query.all === '1'),
  );
  r.post(
    '/api/system/errors/:id/resolve',
    { onRequest: [app.authenticate], schema: { tags, params: z.object({ id: z.string().max(40) }) } },
    async (q) => resolveError(app.prisma, actorOf(q), q.params.id),
  );
}
