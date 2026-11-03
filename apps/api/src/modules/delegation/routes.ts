import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { taskActionSchema, taskCreateSchema, taskEditSchema, taskImportSchema } from '@mono/shared';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { listTasks, myTiles, rygData, scorecardReport, taskDetail } from './queries';
import { editTask } from './edit';
import { actOnTask, createTask } from './service';

export const actorOf = (r: FastifyRequest): Actor => ({
  companyId: r.auth!.companyId,
  userId: r.auth!.userId,
  permissions: r.auth!.permissions,
  ip: r.ip,
  userAgent: r.headers['user-agent'] ?? null,
});

const idParam = z.object({ id: z.string() });

/** Delegation sheet (CLAUDE.md §5.1). Fine-grained rights are checked per task by the state machine. */
export async function delegationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('delegation.view')] };

  r.get(
    '/api/tasks',
    {
      ...view,
      schema: {
        tags: ['delegation'],
        querystring: z.object({
          scope: z.enum(['mine', 'team', 'all']).optional(),
          tab: z.enum(['pending', 'verification', 'done', 'all']).optional(),
          q: z.string().max(100).optional(),
          from: z.iso.datetime({ offset: true }).optional(),
          to: z.iso.datetime({ offset: true }).optional(),
          doerId: z.string().optional(),
        }),
      },
    },
    async (request) => listTasks(app.prisma, actorOf(request), request.query),
  );

  r.get('/api/tasks/tiles', { ...view, schema: { tags: ['delegation'] } }, async (request) =>
    myTiles(app.prisma, actorOf(request)),
  );

  r.get('/api/tasks/:id', { ...view, schema: { tags: ['delegation'], params: idParam } }, async (request) =>
    taskDetail(app.prisma, actorOf(request), request.params.id),
  );

  r.post(
    '/api/tasks',
    { ...view, schema: { tags: ['delegation'], body: taskCreateSchema } },
    async (request) => app.prisma.$transaction((tx) => createTask(tx, actorOf(request), request.body)),
  );

  r.post(
    '/api/tasks/import',
    { ...view, schema: { tags: ['delegation'], body: taskImportSchema } },
    async (request) =>
      app.prisma.$transaction(
        async (tx) => {
          const created = [];
          for (const t of request.body.tasks)
            created.push(await createTask(tx, actorOf(request), { ...t, source: 'import' }));
          return { created: created.length };
        },
        { timeout: 60_000 },
      ),
  );

  r.post(
    '/api/tasks/:id/actions',
    { ...view, schema: { tags: ['delegation'], params: idParam, body: taskActionSchema } },
    async (request) => actOnTask(app.prisma, actorOf(request), request.params.id, request.body),
  );

  r.patch(
    '/api/tasks/:id',
    { ...view, schema: { tags: ['delegation'], params: idParam, body: taskEditSchema } },
    async (request) => editTask(app.prisma, actorOf(request), request.params.id, request.body),
  );

  r.get(
    '/api/tasks/reports/scorecard',
    {
      ...view,
      schema: {
        tags: ['delegation'],
        querystring: z.object({ at: z.iso.datetime({ offset: true }).optional() }),
      },
    },
    async (request) =>
      scorecardReport(
        app.prisma,
        actorOf(request),
        request.query.at ? new Date(request.query.at) : new Date(),
      ),
  );

  r.get(
    '/api/tasks/reports/ryg',
    {
      ...view,
      schema: {
        tags: ['delegation'],
        querystring: z.object({
          from: z.iso.datetime({ offset: true }),
          to: z.iso.datetime({ offset: true }),
        }),
      },
    },
    async (request) => {
      const from = new Date(request.query.from);
      const to = new Date(request.query.to);
      if (to <= from || to.getTime() - from.getTime() > 400 * 86_400_000)
        throw new AppError(400, 'BAD_REQUEST', 'Pick a range of up to a year');
      return rygData(app.prisma, actorOf(request), from, to);
    },
  );
}
