import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { recipeSchema } from '@mono/shared';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import {
  countLinesSchema,
  decideCount,
  getCount,
  listCountsV2,
  openCount,
  openCountSchema,
  saveCountLines,
  submitCount,
} from './closing';
import { createGrn, grnSchema, listGrns, returnSchema, returnToVendor } from './grn';
import { parSchema, reorderList, savePar } from './par';
import {
  deletePriceList,
  listPriceLists,
  priceListSchema,
  quote,
  quoteSchema,
  rateBoard,
  rateSchema,
  savePriceList,
  setRate,
} from './prices';
import {
  cancelProduction,
  finishProduction,
  finishSchema,
  listProduction,
  planProduction,
  productionSchema,
} from './production';
import { listRecipes, saveRecipe } from './recipes';
import { sell, sellSchema } from './sell';
import { attributesSchema, listAttributes, saveAttributes } from './stock-attrs';
import { postStock, stockEntrySchema } from './stock-entry';
import {
  batchHistory,
  expiryList,
  itemExtrasSchema,
  saveItemExtras,
  scan,
  stockByLocation,
  stockQuery,
} from './stock-items';
import { registerQuery, stockRegister, valuation, varianceQuery, varianceReport } from './stock-reports';
import {
  dispatchSchema,
  dispatchTransfer,
  receiveTransfer,
  receiveTransferSchema,
  settleTransfer,
} from './transfer-flow';
import { listTransfers, transferQuery } from './transfer-list';
import {
  approveSchema,
  createTransfer,
  decideTransfer,
  deleteRoute,
  listRoutes,
  routeSchema,
  saveRoute,
  transferSchema,
} from './transfers';
import { recordWaste, wasteQuery, wasteRegister, wasteSchema } from './wastage';

const idParam = z.object({ id: z.string() });
const noteBody = z.object({ note: z.string().trim().max(500).nullish() });

/** Inventory v2 (phase 13): stock per location, batches and pieces, transfers, recipes, production, GRN, counts, prices. */
export async function stockRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['ims'];
  // A fresh hook list per route (decision 62); the services check the finer rights and the person's reach.
  const view = () => ({ onRequest: [app.requirePermission('ims.view')] });
  const db = app.prisma;
  const body = <T extends z.ZodTypeAny>(schema: T) => ({ ...view(), schema: { tags, body: schema } });
  const withId = <T extends z.ZodTypeAny>(schema: T) => ({
    ...view(),
    schema: { tags, params: idParam, body: schema },
  });
  const byId = () => ({ ...view(), schema: { tags, params: idParam } });

  r.get('/api/ims/stock', { ...view(), schema: { tags, querystring: stockQuery } }, async (q) =>
    stockByLocation(db, actorOf(q), q.query),
  );
  r.post('/api/ims/stock/entry', body(stockEntrySchema), async (q) => postStock(db, actorOf(q), q.body));
  r.put('/api/ims/items/:id/extras', withId(itemExtrasSchema), async (q) =>
    saveItemExtras(db, actorOf(q), q.params.id, q.body),
  );
  r.get(
    '/api/ims/scan',
    { ...view(), schema: { tags, querystring: z.object({ code: z.string() }) } },
    async (q) => scan(db, actorOf(q), q.query.code),
  );
  r.get(
    '/api/ims/expiry',
    {
      ...view(),
      schema: { tags, querystring: z.object({ days: z.coerce.number().int().min(0).max(365).optional() }) },
    },
    async (q) => expiryList(db, actorOf(q), q.query.days),
  );
  r.get('/api/ims/batches/:id', byId(), async (q) => batchHistory(db, actorOf(q), q.params.id));
  r.get('/api/ims/attributes', { ...view(), schema: { tags } }, async (q) => listAttributes(db, actorOf(q)));
  r.put('/api/ims/attributes', body(attributesSchema), async (q) => saveAttributes(db, actorOf(q), q.body));

  r.get('/api/ims/routes', { ...view(), schema: { tags } }, async (q) => listRoutes(db, actorOf(q)));
  r.put('/api/ims/routes', body(routeSchema), async (q) => saveRoute(db, actorOf(q), q.body));
  r.delete('/api/ims/routes/:id', byId(), async (q) => deleteRoute(db, actorOf(q), q.params.id));
  r.get('/api/ims/transfers', { ...view(), schema: { tags, querystring: transferQuery } }, async (q) =>
    listTransfers(db, actorOf(q), q.query),
  );
  r.post('/api/ims/transfers', body(transferSchema), async (q) => createTransfer(db, actorOf(q), q.body));
  for (const action of ['approve', 'reject', 'cancel'] as const)
    r.post(`/api/ims/transfers/:id/${action}`, withId(approveSchema), async (q) =>
      decideTransfer(db, actorOf(q), q.params.id, action, q.body),
    );
  r.post('/api/ims/transfers/:id/dispatch', withId(dispatchSchema), async (q) =>
    dispatchTransfer(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/ims/transfers/:id/receive', withId(receiveTransferSchema), async (q) =>
    receiveTransfer(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/ims/transfers/:id/settle', withId(noteBody), async (q) =>
    settleTransfer(db, actorOf(q), q.params.id, q.body.note),
  );

  r.get(
    '/api/ims/recipes',
    { ...view(), schema: { tags, querystring: z.object({ itemId: z.string().optional() }) } },
    async (q) => listRecipes(db, actorOf(q), q.query.itemId),
  );
  r.put('/api/ims/recipes', body(recipeSchema), async (q) => saveRecipe(db, actorOf(q), q.body));
  r.get('/api/ims/production', { ...view(), schema: { tags } }, async (q) => listProduction(db, actorOf(q)));
  r.post('/api/ims/production', body(productionSchema), async (q) => planProduction(db, actorOf(q), q.body));
  r.post('/api/ims/production/:id/finish', withId(finishSchema), async (q) =>
    finishProduction(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/ims/production/:id/cancel', byId(), async (q) =>
    cancelProduction(db, actorOf(q), q.params.id),
  );

  r.get('/api/ims/grn', { ...view(), schema: { tags } }, async (q) => listGrns(db, actorOf(q)));
  r.post('/api/ims/grn', body(grnSchema), async (q) => createGrn(db, actorOf(q), q.body));
  r.post('/api/ims/grn/:id/return', withId(returnSchema), async (q) =>
    returnToVendor(db, actorOf(q), q.params.id, q.body),
  );

  r.get(
    '/api/ims/par',
    { ...view(), schema: { tags, querystring: z.object({ locationId: z.string().default('') }) } },
    async (q) => reorderList(db, actorOf(q), q.query.locationId),
  );
  r.put('/api/ims/par', body(parSchema), async (q) => savePar(db, actorOf(q), q.body));

  r.get('/api/ims/wastage', { ...view(), schema: { tags, querystring: wasteQuery } }, async (q) =>
    wasteRegister(db, actorOf(q), q.query),
  );
  r.post('/api/ims/wastage', body(wasteSchema), async (q) => recordWaste(db, actorOf(q), q.body));

  r.get('/api/ims/closing', { ...view(), schema: { tags } }, async (q) => listCountsV2(db, actorOf(q)));
  r.post('/api/ims/closing', body(openCountSchema), async (q) => openCount(db, actorOf(q), q.body));
  r.get('/api/ims/closing/:id', byId(), async (q) => getCount(db, actorOf(q), q.params.id));
  r.put('/api/ims/closing/:id', withId(countLinesSchema), async (q) =>
    saveCountLines(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/ims/closing/:id/submit', byId(), async (q) => submitCount(db, actorOf(q), q.params.id));
  for (const action of ['approve', 'reject'] as const)
    r.post(`/api/ims/closing/:id/${action}`, withId(noteBody), async (q) =>
      decideCount(db, actorOf(q), q.params.id, action, q.body.note),
    );

  r.get('/api/ims/price-lists', { ...view(), schema: { tags } }, async (q) => listPriceLists(db, actorOf(q)));
  r.post('/api/ims/price-lists', body(priceListSchema), async (q) => savePriceList(db, actorOf(q), q.body));
  r.put('/api/ims/price-lists/:id', withId(priceListSchema), async (q) =>
    savePriceList(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/ims/price-lists/:id', byId(), async (q) => deletePriceList(db, actorOf(q), q.params.id));
  r.get('/api/ims/rate-board', { ...view(), schema: { tags } }, async (q) => rateBoard(db, actorOf(q)));
  r.put('/api/ims/rate-board', body(rateSchema), async (q) => setRate(db, actorOf(q), q.body));
  r.post('/api/ims/quote', body(quoteSchema), async (q) => quote(db, actorOf(q), q.body));
  r.post('/api/ims/sell', body(sellSchema), async (q) => sell(db, actorOf(q), q.body));

  r.get('/api/ims/valuation', { ...view(), schema: { tags } }, async (q) => valuation(db, actorOf(q)));
  r.get('/api/ims/variance', { ...view(), schema: { tags, querystring: varianceQuery } }, async (q) =>
    varianceReport(db, actorOf(q), q.query),
  );
  r.get('/api/ims/register', { ...view(), schema: { tags, querystring: registerQuery } }, async (q) =>
    stockRegister(db, actorOf(q), q.query),
  );
}
