import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { itemSchema, moveSchema } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { readImsRules, saveImsRules } from './access';
import { countSchema, deadStockFor, listCounts, recordCount } from './audit';
import {
  createItem,
  createItemSchema,
  deleteItem,
  importItems,
  importSchema,
  itemDetail,
  listItems,
  updateItem,
} from './items';
import { decideAdjustment, listMoves, postMove, sheetQuery } from './moves';
import {
  createPo,
  fromOwsSchema,
  getPo,
  listPos,
  ordersFromOws,
  owsList,
  poAction,
  poSchema,
  receiveSchema,
  updatePo,
} from './purchase';
import { movement, periodSchema, purchaseReport, stockValue, turnsReport } from './reports';
import { applyReviews, applySchema, listReviews, reviewNow } from './review';

const idParam = z.object({ id: z.string() });

/** Inventory (CLAUDE.md §10): rules, items, stock moves, MAX review, OWS and purchase, audit, reports. */
export async function imsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['ims'];
  // A fresh hook list per route (decision 62); the services check the finer permissions.
  const view = () => ({ onRequest: [app.requirePermission('ims.view')] });
  const db = app.prisma;

  r.get('/api/ims/rules', { ...view(), schema: { tags } }, async (q) => readImsRules(db, q.auth!.companyId));
  r.put(
    '/api/ims/rules',
    { ...view(), schema: { tags, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveImsRules(db, actorOf(q), q.body),
  );

  r.get(
    '/api/ims/items',
    { ...view(), schema: { tags, querystring: z.object({ all: z.enum(['1']).optional() }) } },
    async (q) => listItems(db, actorOf(q), { includeOff: q.query.all === '1' }),
  );
  r.get('/api/ims/items/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    itemDetail(db, actorOf(q), q.params.id),
  );
  r.post('/api/ims/items', { ...view(), schema: { tags, body: createItemSchema } }, async (q) =>
    createItem(db, actorOf(q), q.body),
  );
  r.put('/api/ims/items/:id', { ...view(), schema: { tags, params: idParam, body: itemSchema } }, async (q) =>
    updateItem(db, actorOf(q), q.params.id, q.body),
  );
  r.delete('/api/ims/items/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteItem(db, actorOf(q), q.params.id),
  );
  r.post(
    '/api/ims/items/import',
    { ...view(), bodyLimit: 8 * 1024 * 1024, schema: { tags, body: importSchema } },
    async (q) => importItems(db, actorOf(q), q.body),
  );

  r.get('/api/ims/moves', { ...view(), schema: { tags, querystring: sheetQuery } }, async (q) =>
    listMoves(db, actorOf(q), q.query),
  );
  r.post('/api/ims/moves', { ...view(), schema: { tags, body: moveSchema } }, async (q) =>
    postMove(db, actorOf(q), q.body),
  );
  r.post(
    '/api/ims/moves/:id/decide',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ approve: z.boolean(), note: z.string().trim().max(500).nullish() }),
      },
    },
    async (q) => decideAdjustment(db, actorOf(q), q.params.id, q.body.approve, q.body.note),
  );

  r.get('/api/ims/reviews', { ...view(), schema: { tags } }, async (q) => listReviews(db, actorOf(q)));
  r.post('/api/ims/reviews/apply', { ...view(), schema: { tags, body: applySchema } }, async (q) =>
    applyReviews(db, actorOf(q), q.body),
  );
  r.post(
    '/api/ims/reviews/run',
    { ...view(), config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags } },
    async (q) => reviewNow(db, actorOf(q)),
  );

  r.get('/api/ims/ows', { ...view(), schema: { tags } }, async (q) => owsList(db, actorOf(q)));
  r.post('/api/ims/ows/order', { ...view(), schema: { tags, body: fromOwsSchema } }, async (q) =>
    ordersFromOws(db, actorOf(q), q.body),
  );
  r.get('/api/ims/po', { ...view(), schema: { tags } }, async (q) => listPos(db, actorOf(q)));
  r.get('/api/ims/po/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    getPo(db, actorOf(q), q.params.id),
  );
  r.post('/api/ims/po', { ...view(), schema: { tags, body: poSchema } }, async (q) =>
    createPo(db, actorOf(q), q.body),
  );
  r.put('/api/ims/po/:id', { ...view(), schema: { tags, params: idParam, body: poSchema } }, async (q) =>
    updatePo(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/ims/po/:id/:action',
    {
      ...view(),
      schema: {
        tags,
        params: z.object({ id: z.string(), action: z.enum(['send', 'receive', 'close', 'cancel']) }),
        body: receiveSchema.partial().default({}),
      },
    },
    async (q) => poAction(db, actorOf(q), q.params.id, q.params.action, q.body),
  );

  r.get('/api/ims/audit', { ...view(), schema: { tags } }, async (q) => listCounts(db, actorOf(q)));
  r.post(
    '/api/ims/audit/:id',
    { ...view(), schema: { tags, params: idParam, body: countSchema } },
    async (q) => recordCount(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/ims/dead', { ...view(), schema: { tags } }, async (q) => deadStockFor(db, actorOf(q)));

  r.get('/api/ims/reports/value', { ...view(), schema: { tags } }, async (q) => stockValue(db, actorOf(q)));
  r.get('/api/ims/reports/movement', { ...view(), schema: { tags, querystring: periodSchema } }, async (q) =>
    movement(db, actorOf(q), q.query),
  );
  r.get('/api/ims/reports/turns', { ...view(), schema: { tags } }, async (q) => turnsReport(db, actorOf(q)));
  r.get('/api/ims/reports/purchase', { ...view(), schema: { tags, querystring: periodSchema } }, async (q) =>
    purchaseReport(db, actorOf(q), q.query),
  );
}
