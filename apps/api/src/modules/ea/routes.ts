import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eaActionSchema, eaCaptureSchema, eaEditSchema } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { actOnEa, captureEa, eaBoard, editEa } from './service';

const idParam = z.object({ id: z.string() });

/** EA System (CLAUDE.md §5.5): the owner's capture board. */
export async function eaRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('ea.view')] };

  r.get(
    '/api/ea/board',
    { ...view, schema: { tags: ['ea'], querystring: z.object({ ownerId: z.string().optional() }) } },
    async (request) => eaBoard(app.prisma, actorOf(request), request.query.ownerId),
  );
  r.post('/api/ea/items', { ...view, schema: { tags: ['ea'], body: eaCaptureSchema } }, async (request) =>
    captureEa(app.prisma, actorOf(request), request.body),
  );
  r.post(
    '/api/ea/items/:id/actions',
    { ...view, schema: { tags: ['ea'], params: idParam, body: eaActionSchema } },
    async (request) => actOnEa(app.prisma, actorOf(request), request.params.id, request.body),
  );
  r.patch(
    '/api/ea/items/:id',
    { ...view, schema: { tags: ['ea'], params: idParam, body: eaEditSchema } },
    async (request) => editEa(app.prisma, actorOf(request), request.params.id, request.body),
  );
}
