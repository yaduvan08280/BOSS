import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '@mono/db';
import type { Env } from '../../env';
import { channelClients } from '../../lib/channels/config';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent, recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';

/** In-app notifications (bell), web push subscriptions and the admin "Send test" button. */
export async function inboxRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const authed = { onRequest: [app.authenticate] };

  r.get(
    '/api/notifications',
    {
      ...authed,
      schema: {
        tags: ['notify'],
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (request) => {
      const where = { userId: request.auth!.userId };
      const [items, unread] = await Promise.all([
        request.db.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: request.query.limit,
        }),
        request.db.notification.count({ where: { ...where, readAt: null } }),
      ]);
      return { items, unread };
    },
  );

  r.post(
    '/api/notifications/:id/read',
    { ...authed, schema: { tags: ['notify'], params: z.object({ id: z.string() }) } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const n = await tx.notification.findFirst({ where: { id: request.params.id, userId: ctx.actorId } });
        if (!n) throw notFound('Notification');
        if (!n.readAt) {
          await tx.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
          await emitEvent(tx, ctx, {
            name: 'notification.read',
            entityType: n.entityType ?? 'notification',
            entityId: n.entityId ?? n.id,
            payload: { notificationId: n.id, eventId: n.eventId },
          });
        }
        return { ok: true };
      }),
  );

  r.post('/api/notifications/read-all', { ...authed, schema: { tags: ['notify'] } }, async (request) => {
    const res = await request.db.notification.updateMany({
      where: { userId: request.auth!.userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: res.count };
  });

  r.get('/api/notify/push/key', { ...authed, schema: { tags: ['notify'] } }, async (request) => {
    const clients = await channelClients(request.db as unknown as Tx, request.auth!.companyId, opts.env);
    return { publicKey: clients.push?.publicKey ?? null };
  });

  r.post(
    '/api/notify/push/subscribe',
    {
      ...authed,
      schema: {
        tags: ['notify'],
        body: z.object({
          endpoint: z.url().max(1000),
          keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
        }),
      },
    },
    async (request) => {
      const { endpoint, keys } = request.body;
      const auth = request.auth!;
      await app.prisma.pushSubscription.upsert({
        where: { endpoint },
        create: {
          companyId: auth.companyId,
          userId: auth.userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          userAgent: request.headers['user-agent']?.slice(0, 200) ?? null,
        },
        update: { companyId: auth.companyId, userId: auth.userId, p256dh: keys.p256dh, auth: keys.auth },
      });
      return { ok: true };
    },
  );

  r.post(
    '/api/notify/push/unsubscribe',
    { ...authed, schema: { tags: ['notify'], body: z.object({ endpoint: z.string().max(1000) }) } },
    async (request) => {
      await request.db.pushSubscription.deleteMany({
        where: { endpoint: request.body.endpoint, userId: request.auth!.userId },
      });
      return { ok: true };
    },
  );

  /** Fire a real `notify.test` event through the rules engine, so every enabled channel is exercised end to end. */
  r.post(
    '/api/notify/test',
    {
      onRequest: [app.requirePermission('integrations.admin')],
      schema: { tags: ['notify'], body: z.object({ userId: z.string() }) },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const user = await tx.user.findFirst({ where: { id: request.body.userId, deletedAt: null } });
        if (!user) throw notFound('Person');
        if (
          !(await tx.notificationRule.count({
            where: { event: 'notify.test', active: true, deletedAt: null },
          }))
        ) {
          throw new AppError(
            400,
            'BAD_REQUEST',
            'There is no active rule for test messages. Load the default rules first.',
          );
        }
        await recordChange(tx, ctx, {
          event: 'notify.test',
          entityType: 'user',
          entityId: user.id,
          payload: { userId: user.id, link: '/notifications' },
        });
        return { ok: true };
      }),
  );
}
