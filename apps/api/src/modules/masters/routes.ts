import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { masterOptions } from './options';
import { deleteRow, importRows, importSheet, library, listRows, saveRow, useLibrary } from './rows';

const idParam = z.object({ id: z.string() });

/** Masters (CLAUDE.md §8): the library, rows, import, and the options "from a master" fields offer. */
export async function masterRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['masters'];
  // A fresh hook list per route (decision 62). Reading needs a sign-in; changes need core.edit (checked inside).
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const db = app.prisma;

  r.get('/api/masters/library', { ...signedIn(), schema: { tags } }, async (q) => library(db, actorOf(q)));
  r.post(
    '/api/masters/library/:key',
    { ...signedIn(), schema: { tags, params: z.object({ key: z.string().max(40) }) } },
    async (q) => useLibrary(db, actorOf(q), q.params.key),
  );
  r.get(
    '/api/masters/options',
    {
      ...signedIn(),
      schema: {
        tags,
        querystring: z.object({ source: z.string().max(60), q: z.string().max(80).optional() }),
      },
    },
    async (q) => masterOptions(db, actorOf(q), q.query.source, q.query.q),
  );
  r.get(
    '/api/masters/:id/rows',
    {
      ...signedIn(),
      schema: { tags, params: idParam, querystring: z.object({ q: z.string().max(80).optional() }) },
    },
    async (q) => listRows(db, actorOf(q), q.params.id, q.query.q),
  );
  r.post(
    '/api/masters/:id/rows',
    { ...signedIn(), schema: { tags, params: idParam, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveRow(db, actorOf(q), q.params.id, q.body),
  );
  r.put(
    '/api/masters/:id/rows/:rowId',
    {
      ...signedIn(),
      schema: {
        tags,
        params: z.object({ id: z.string(), rowId: z.string() }),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async (q) => saveRow(db, actorOf(q), q.params.id, q.body, q.params.rowId),
  );
  r.delete(
    '/api/masters/:id/rows/:rowId',
    { ...signedIn(), schema: { tags, params: z.object({ id: z.string(), rowId: z.string() }) } },
    async (q) => deleteRow(db, actorOf(q), q.params.id, q.params.rowId),
  );
  r.post(
    '/api/masters/:id/import',
    {
      ...signedIn(),
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags,
        params: idParam,
        body: z.object({ table: z.array(z.array(z.string().max(2000)).max(80)).max(10_001) }),
      },
    },
    async (q) => importRows(db, actorOf(q), q.params.id, q.body.table),
  );
  r.post(
    '/api/masters/:id/import-sheet',
    {
      ...signedIn(),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags, params: idParam, body: z.object({ url: z.string().url().max(500) }) },
    },
    async (q) => importSheet(db, actorOf(q), q.params.id, q.body.url),
  );
}
