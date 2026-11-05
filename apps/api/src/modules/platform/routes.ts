import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { DATA_EVENTS, NOTIFY_EVENTS } from '@mono/shared';
import type { Env } from '../../env';
import { actorOf } from '../delegation/routes';
import { createApiKey, keySchema, listApiKeys, needAdmin, revokeApiKey } from './keys';
import {
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  rotateSecret,
  saveWebhook,
  testWebhook,
  webhookSchema,
  netOf,
} from './webhooks';

const idParam = z.object({ id: z.string().max(40) });

/** System Master → API Keys (CLAUDE.md §4.2, §12): keys, outgoing webhooks and their deliveries. Admins only. */
export async function platformRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['api keys'];
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const net = netOf(opts.env);

  r.get('/api/platform/info', { ...signedIn(), schema: { tags } }, async (q) => {
    needAdmin(actorOf(q));
    return {
      apiUrl: `${opts.env.origin}/api/v1`,
      docsUrl: `${opts.env.origin}/api/docs`,
      openapiUrl: `${opts.env.origin}/api/v1/openapi.json`,
      events: [...DATA_EVENTS, ...NOTIFY_EVENTS.map((e) => ({ event: e.event, module: e.module }))],
    };
  });
  r.get('/api/platform/keys', { ...signedIn(), schema: { tags } }, async (q) => listApiKeys(db, actorOf(q)));
  r.post(
    '/api/platform/keys',
    {
      ...signedIn(),
      schema: { tags, body: keySchema },
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (q) => createApiKey(db, actorOf(q), q.body),
  );
  r.delete('/api/platform/keys/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    revokeApiKey(db, actorOf(q), q.params.id),
  );

  r.get('/api/platform/webhooks', { ...signedIn(), schema: { tags } }, async (q) =>
    listWebhooks(db, actorOf(q)),
  );
  r.post('/api/platform/webhooks', { ...signedIn(), schema: { tags, body: webhookSchema } }, async (q) =>
    saveWebhook(db, actorOf(q), net, q.body),
  );
  r.put(
    '/api/platform/webhooks/:id',
    { ...signedIn(), schema: { tags, params: idParam, body: webhookSchema } },
    async (q) => saveWebhook(db, actorOf(q), net, q.body, q.params.id),
  );
  r.delete('/api/platform/webhooks/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    deleteWebhook(db, actorOf(q), q.params.id),
  );
  r.post(
    '/api/platform/webhooks/:id/test',
    {
      ...signedIn(),
      schema: { tags, params: idParam },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (q) => testWebhook(db, actorOf(q), net, q.params.id),
  );
  r.post(
    '/api/platform/webhooks/:id/secret',
    { ...signedIn(), schema: { tags, params: idParam } },
    async (q) => rotateSecret(db, actorOf(q), net, q.params.id),
  );
  r.get(
    '/api/platform/webhooks/:id/deliveries',
    { ...signedIn(), schema: { tags, params: idParam } },
    async (q) => listDeliveries(db, actorOf(q), q.params.id),
  );
}
