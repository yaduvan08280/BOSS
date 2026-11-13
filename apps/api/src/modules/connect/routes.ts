import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CONNECTION_KINDS, connectionSchema, PAY_PURPOSES, payLinkSchema } from '@mono/shared';
import { z } from 'zod';
import type { Env } from '../../env';
import { notFound } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import {
  ackSchema,
  agentOf,
  agentPrinted,
  agentPrintJobs,
  agentSchema,
  agentVouchers,
  agentVouchersDone,
  createAgent,
  listAgents,
  revokeAgent,
  tallyQueue,
  tallyRetry,
} from './agent';
import { aggregatorReport, importPayout, tagOrder, tagSchema } from './aggregator';
import { applyChannelBooking, overbooked, pullBookings, pushAri, pushSchema } from './channel';
import { listConnections, removeConnection, saveConnection, syncLog } from './connections';
import { connectNet, type Fetch } from './core';
import { cancelEinvoice, makeEinvoice } from './einvoice';
import { integrationHealth } from './health';
import { cancelPayLink, createPayLink, gatewayWebhook, listPayLinks } from './paylinks';
import { roomsPublicRoutes } from './rooms-public';

const idParam = z.object({ id: z.string() });
const branchBody = z.object({ branchId: z.string().min(1) });

/** Integrations (phase 19): connections and their health, channel manager, payment links, aggregators, e-invoice, site agents. */
export async function connectRoutes(app: FastifyInstance, opts: { env: Env; fetch?: Fetch }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['integrations'];
  const db = app.prisma;
  const net = { ...connectNet(opts.env), fetch: opts.fetch };
  // A fresh hook list per route (decision 62); the services check the finer rights.
  const signedIn = (key: 'integrations.view' | 'hosp.view' | 'money.view') => ({
    onRequest: [app.requirePermission(key)],
  });
  const view = () => signedIn('integrations.view');
  const hosp = () => signedIn('hosp.view');

  r.get('/api/connect/connections', view(), async (q) => listConnections(db, actorOf(q)));
  r.put('/api/connect/connections', { ...view(), schema: { tags, body: connectionSchema } }, async (q) =>
    saveConnection(db, net, actorOf(q), q.body),
  );
  r.delete(
    '/api/connect/connections/:kind',
    {
      ...view(),
      schema: {
        tags,
        params: z.object({ kind: z.enum(CONNECTION_KINDS) }),
        querystring: z.object({ branchId: z.string().optional() }),
      },
    },
    async (q) => removeConnection(db, actorOf(q), q.params.kind, q.query.branchId),
  );
  r.get(
    '/api/connect/log',
    { ...view(), schema: { tags, querystring: z.object({ connectionId: z.string().optional() }) } },
    async (q) => syncLog(db, actorOf(q), q.query.connectionId),
  );
  r.get('/api/connect/health', view(), async (q) => integrationHealth(db, actorOf(q)));

  // The channel manager of a property.
  r.post('/api/connect/channel/push', { ...hosp(), schema: { tags, body: pushSchema } }, async (q) =>
    pushAri(db, net, actorOf(q), q.body),
  );
  r.post('/api/connect/channel/pull', { ...hosp(), schema: { tags, body: branchBody } }, async (q) =>
    pullBookings(db, net, actorOf(q), q.body.branchId),
  );
  r.get(
    '/api/connect/channel/overbooked',
    { ...hosp(), schema: { tags, querystring: branchBody } },
    async (q) => overbooked(db, actorOf(q), q.query.branchId),
  );

  // Payment links.
  r.post('/api/connect/paylinks', { ...hosp(), schema: { tags, body: payLinkSchema } }, async (q) =>
    createPayLink(db, net, actorOf(q), q.body),
  );
  r.get(
    '/api/connect/paylinks',
    {
      ...hosp(),
      schema: { tags, querystring: z.object({ purpose: z.enum(PAY_PURPOSES), refId: z.string().min(1) }) },
    },
    async (q) => listPayLinks(db, actorOf(q), q.query.purpose, q.query.refId),
  );
  r.post('/api/connect/paylinks/:id/cancel', { ...hosp(), schema: { tags, params: idParam } }, async (q) =>
    cancelPayLink(db, actorOf(q), q.params.id),
  );

  // Delivery aggregators.
  r.post(
    '/api/pos/orders/:id/aggregator',
    { ...hosp(), schema: { tags, params: idParam, body: tagSchema } },
    async (q) => tagOrder(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/connect/aggregators', hosp(), async (q) => aggregatorReport(db, actorOf(q)));
  r.post(
    '/api/connect/payouts',
    {
      ...hosp(),
      bodyLimit: 3_000_000,
      schema: {
        tags,
        body: z.object({
          aggregator: z.enum(['ZOMATO', 'SWIGGY', 'OTHER']),
          csv: z.string().min(1).max(2_000_000),
          fileName: z.string().max(120).nullish(),
          modeId: z.string().max(40).nullish(),
          dryRun: z.boolean().default(false),
        }),
      },
    },
    async (q) => importPayout(db, actorOf(q), q.body),
  );

  // E-invoice of a bill.
  r.post(
    '/api/money/bills/:id/einvoice',
    { ...signedIn('money.view'), schema: { tags, params: idParam } },
    async (q) => makeEinvoice(db, net, actorOf(q), q.params.id),
  );
  r.post(
    '/api/money/bills/:id/einvoice/cancel',
    {
      ...signedIn('money.view'),
      schema: {
        tags,
        params: idParam,
        body: z.object({
          reason: z.enum(['1', '2', '3', '4']).default('2'),
          remark: z.string().min(3).max(100),
        }),
      },
    },
    async (q) => cancelEinvoice(db, net, actorOf(q), q.params.id, q.body),
  );

  // Site agents and what waits for Tally.
  r.get('/api/connect/agents', view(), async (q) => listAgents(db, actorOf(q)));
  r.post('/api/connect/agents', { ...view(), schema: { tags, body: agentSchema } }, async (q) =>
    createAgent(db, actorOf(q), q.body),
  );
  r.delete('/api/connect/agents/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    revokeAgent(db, actorOf(q), q.params.id),
  );
  r.get('/api/connect/tally', signedIn('money.view'), async (q) => tallyQueue(db, actorOf(q)));
  r.post('/api/connect/tally/retry', signedIn('money.view'), async (q) => tallyRetry(db, actorOf(q)));

  // The site agent itself: its key is its only sign-in.
  const agentLimit = { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };
  r.get('/api/agent/print', { ...agentLimit, schema: { tags } }, async (q) =>
    agentPrintJobs(db, await agentOf(db, q.headers.authorization)),
  );
  r.post(
    '/api/agent/print/:id',
    {
      ...agentLimit,
      schema: {
        tags,
        params: idParam,
        body: z.object({ ok: z.boolean(), error: z.string().max(300).nullish() }),
      },
    },
    async (q) =>
      agentPrinted(db, await agentOf(db, q.headers.authorization), q.params.id, q.body.ok, q.body.error),
  );
  r.get('/api/agent/tally', { ...agentLimit, schema: { tags } }, async (q) =>
    agentVouchers(db, await agentOf(db, q.headers.authorization)),
  );
  r.post('/api/agent/tally', { ...agentLimit, schema: { tags, body: ackSchema } }, async (q) =>
    agentVouchersDone(db, await agentOf(db, q.headers.authorization), q.body),
  );

  await app.register(roomsPublicRoutes, { env: opts.env });

  // Webhooks from outside: the body is kept exactly as sent, because a signature is over those bytes.
  await app.register(async (hooks) => {
    hooks.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: 1_000_000 },
      (_q, body, done) => done(null, body),
    );
    const limit = { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } };
    const token = z.object({ token: z.string().min(10).max(64) });
    const h = hooks.withTypeProvider<ZodTypeProvider>();
    h.post('/api/hooks/gateway/:token', { ...limit, schema: { tags, params: token } }, async (q) =>
      gatewayWebhook(db, net, q.params.token, String(q.body ?? ''), q.headers),
    );
    h.post('/api/hooks/channel/:token', { ...limit, schema: { tags, params: token } }, async (q) => {
      const conn = await db.connection.findUnique({ where: { hookToken: q.params.token } });
      if (!conn || conn.kind !== 'CHANNEL' || !conn.active) throw notFound('Webhook');
      let json: unknown = null;
      try {
        json = JSON.parse(String(q.body ?? ''));
      } catch {
        // applyChannelBooking refuses what it can't read, and logs it.
      }
      return applyChannelBooking(db, conn, json);
    });
  });
}
