import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Env } from '../../env';
import { overall, runChecks } from './checks';

const startedAt = new Date();

export async function healthRoutes(app: FastifyInstance, opts: { env: Env }) {
  const { env } = opts;
  const r = app.withTypeProvider<ZodTypeProvider>();
  const checks = () =>
    runChecks(app.prisma, {
      uploadDir: env.UPLOAD_DIR,
      production: env.NODE_ENV === 'production',
      startedAt,
    });

  // Is the server up and can it reach its database (what Docker and the tunnel ask every few seconds).
  r.get(
    '/api/health',
    {
      schema: {
        tags: ['system'],
        response: {
          200: z.object({
            status: z.literal('ok'),
            db: z.literal('ok'),
            version: z.string(),
            startedAt: z.string(),
            time: z.string(),
          }),
          503: z.object({ status: z.literal('down'), db: z.literal('down') }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await app.prisma.$queryRaw`SELECT 1`;
        return {
          status: 'ok' as const,
          db: 'ok' as const,
          version: env.APP_VERSION,
          startedAt: startedAt.toISOString(),
          time: new Date().toISOString(),
        };
      } catch {
        return reply.status(503).send({ status: 'down' as const, db: 'down' as const });
      }
    },
  );

  // Is everything doing its job: the worker, the queues, the backups, the disks. For a monitor outside the
  // machine: one word and the names of what is wrong — no details (those are for admins, below).
  r.get(
    '/api/health/ready',
    { schema: { tags: ['system'] }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      const list = await checks();
      const status = overall(list);
      const body = {
        status,
        failing: list.filter((c) => c.state === 'fail').map((c) => c.key),
        version: env.APP_VERSION,
      };
      return list.some((c) => c.key === 'database' && c.state === 'fail')
        ? reply.status(503).send(body)
        : body;
    },
  );

  // The same with every check in words (System Master → Errors shows it).
  r.get(
    '/api/system/health',
    { onRequest: [app.requirePermission('core.admin')], schema: { tags: ['system'] } },
    async () => {
      const list = await checks();
      return {
        status: overall(list),
        version: env.APP_VERSION,
        startedAt: startedAt.toISOString(),
        checks: list,
      };
    },
  );
}
