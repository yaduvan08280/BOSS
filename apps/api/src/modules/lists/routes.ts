import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { addValue, changeValue, listLists, listNames, listValues, mergeValue, offer } from './service';

const idParam = z.object({ id: z.string() });
const key = z.string().min(3).max(120);
const q = z.string().max(80).optional();
const value = z.string().max(400);

/** Value lists (plan §2.1): what "remember what people type" fields offer, and Masters → Lists for admins. */
export async function listRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['lists'];
  // A fresh hook list per route (decision 62). Forms read with a sign-in; the admin screen needs core.edit (checked inside).
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const db = app.prisma;

  r.get(
    '/api/lists/offer',
    { ...signedIn(), schema: { tags, querystring: z.object({ key, q }) } },
    async (req) => offer(db, actorOf(req), req.query.key, req.query.q),
  );
  r.get('/api/lists/names', { ...signedIn(), schema: { tags } }, async (req) => listNames(db, actorOf(req)));

  r.get('/api/lists', { ...signedIn(), schema: { tags } }, async (req) => listLists(db, actorOf(req)));
  r.get(
    '/api/lists/values',
    { ...signedIn(), schema: { tags, querystring: z.object({ key, q }) } },
    async (req) => listValues(db, actorOf(req), req.query.key, req.query.q),
  );
  r.post(
    '/api/lists/values',
    { ...signedIn(), schema: { tags, body: z.object({ key, value }) } },
    async (req) => addValue(db, actorOf(req), req.body),
  );
  r.patch(
    '/api/lists/values/:id',
    {
      ...signedIn(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ value: value.optional(), hidden: z.boolean().optional() }),
      },
    },
    async (req) => changeValue(db, actorOf(req), req.params.id, req.body),
  );
  r.post(
    '/api/lists/values/:id/merge',
    { ...signedIn(), schema: { tags, params: idParam, body: z.object({ into: z.string() }) } },
    async (req) => mergeValue(db, actorOf(req), req.params.id, req.body.into),
  );
}
