import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';

const startedAt = new Date().toISOString();

export async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/health',
    {
      schema: {
        tags: ['system'],
        response: {
          200: z.object({
            status: z.literal('ok'),
            db: z.literal('ok'),
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
        return { status: 'ok' as const, db: 'ok' as const, startedAt, time: new Date().toISOString() };
      } catch {
        return reply.status(503).send({ status: 'down' as const, db: 'down' as const });
      }
    },
  );
}
