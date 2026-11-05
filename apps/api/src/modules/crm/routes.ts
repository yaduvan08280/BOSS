import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SEATS, SETUP_PAGES } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { crmConfigOf } from './access';
import { answerCall, answerSchema, scotSheet, todaysCalls } from './calls';
import {
  addNote,
  collectionLog,
  collections,
  noteSchema,
  paymentSchema,
  recordPayment,
  sendStatement,
} from './collections';
import {
  customerDetail,
  customerSchema,
  importCustomers,
  importCustomersSchema,
  listCustomers,
  saveCustomer,
  setTags,
} from './customers';
import { dashboard } from './dashboard';
import { createEnquiry, enquirySchema, funnel, leadAction, leadActionSchema } from './leads';
import { meca, mecaQuery } from './meca';
import { cancelOrder, createOrder, orderSchema, ordersBoard } from './orders';
import { editMonth, getPlan, monthEditSchema, planAction, planPatchSchema, savePlanInput } from './plan';
import { markPage, pageSchema, progress, saveFields, saveSetupPage, saveTagDefs } from './setup';

const idParam = z.object({ id: z.string() });
const fyQuery = z.object({ fy: z.coerce.number().int().min(2020).max(2100).optional() });

/** Sales CRM (CLAUDE.md §11): the year plan and setup journey, and the daily screens. */
export async function crmRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['crm'];
  // A fresh hook list per route (decision 62); the services check the finer permissions.
  const view = () => ({ onRequest: [app.requirePermission('crm.view')] });
  const db = app.prisma;

  r.get('/api/crm/plan', { ...view(), schema: { tags, querystring: fyQuery } }, async (q) =>
    getPlan(db, actorOf(q), q.query.fy),
  );
  r.put('/api/crm/plan', { ...view(), schema: { tags, body: planPatchSchema } }, async (q) =>
    savePlanInput(db, actorOf(q), q.body),
  );
  r.post('/api/crm/plan/month', { ...view(), schema: { tags, body: monthEditSchema } }, async (q) =>
    editMonth(db, actorOf(q), q.body),
  );
  r.post(
    '/api/crm/plan/:action',
    {
      ...view(),
      schema: {
        tags,
        params: z.object({ action: z.enum(['submit', 'approve', 'reject', 'withdraw', 'unlock']) }),
        body: z
          .object({ fy: z.number().int().optional(), note: z.string().trim().max(300).optional() })
          .default({}),
      },
    },
    async (q) => planAction(db, actorOf(q), q.params.action, q.body.fy, q.body.note),
  );

  r.get('/api/crm/setup', { ...view(), schema: { tags } }, async (q) => progress(db, q.auth!.companyId));
  r.put('/api/crm/setup', { ...view(), schema: { tags, body: pageSchema } }, async (q) =>
    saveSetupPage(db, actorOf(q), q.body),
  );
  r.post(
    '/api/crm/setup/done',
    { ...view(), schema: { tags, body: z.object({ page: z.enum(SETUP_PAGES) }) } },
    async (q) => markPage(db, actorOf(q), q.body.page),
  );
  r.put('/api/crm/tags', { ...view(), schema: { tags, body: z.array(z.unknown()).max(30) } }, async (q) =>
    saveTagDefs(db, actorOf(q), q.body),
  );
  r.put(
    '/api/crm/fields',
    { ...view(), schema: { tags, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveFields(db, actorOf(q), q.body),
  );

  r.get(
    '/api/crm/dashboard',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ seat: z.enum(SEATS).optional(), userId: z.string().optional() }),
      },
    },
    async (q) => dashboard(db, actorOf(q), q.query),
  );

  r.get('/api/crm/customers', { ...view(), schema: { tags } }, async (q) => listCustomers(db, actorOf(q)));
  r.get('/api/crm/customers/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    customerDetail(db, actorOf(q), q.params.id),
  );
  r.post('/api/crm/customers', { ...view(), schema: { tags, body: customerSchema } }, async (q) =>
    saveCustomer(db, actorOf(q), q.body),
  );
  r.put(
    '/api/crm/customers/:id',
    { ...view(), schema: { tags, params: idParam, body: customerSchema } },
    async (q) => saveCustomer(db, actorOf(q), q.body, q.params.id),
  );
  r.put(
    '/api/crm/customers/:id/tags',
    {
      ...view(),
      schema: { tags, params: idParam, body: z.object({ tags: z.array(z.string().max(30)).max(30) }) },
    },
    async (q) =>
      setTags(
        db,
        actorOf(q),
        q.params.id,
        q.body.tags,
        (await crmConfigOf(db, q.auth!.companyId)).tags.map((t) => t.key),
      ),
  );
  r.post(
    '/api/crm/customers/import',
    { ...view(), bodyLimit: 4 * 1024 * 1024, schema: { tags, body: importCustomersSchema } },
    async (q) => importCustomers(db, actorOf(q), q.body.text),
  );

  r.get('/api/crm/scot', { ...view(), schema: { tags } }, async (q) => scotSheet(db, actorOf(q)));
  r.get(
    '/api/crm/calls',
    { ...view(), schema: { tags, querystring: z.object({ scId: z.string().optional() }) } },
    async (q) => todaysCalls(db, actorOf(q), q.query.scId),
  );
  r.post(
    '/api/crm/calls/:id/answer',
    { ...view(), schema: { tags, params: idParam, body: answerSchema } },
    async (q) => answerCall(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/crm/orders', { ...view(), schema: { tags } }, async (q) => ordersBoard(db, actorOf(q)));
  r.post('/api/crm/orders', { ...view(), schema: { tags, body: orderSchema } }, async (q) =>
    createOrder(db, actorOf(q), q.body),
  );
  r.post(
    '/api/crm/orders/:id/cancel',
    {
      ...view(),
      schema: { tags, params: idParam, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
    },
    async (q) => cancelOrder(db, actorOf(q), q.params.id, q.body.reason),
  );

  r.get('/api/crm/collections', { ...view(), schema: { tags } }, async (q) => collections(db, actorOf(q)));
  r.get('/api/crm/collections/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    collectionLog(db, actorOf(q), q.params.id),
  );
  r.post('/api/crm/payments', { ...view(), schema: { tags, body: paymentSchema } }, async (q) =>
    recordPayment(db, actorOf(q), q.body),
  );
  r.post('/api/crm/collections/notes', { ...view(), schema: { tags, body: noteSchema } }, async (q) =>
    addNote(db, actorOf(q), q.body),
  );
  r.post(
    '/api/crm/collections/:id/statement',
    {
      ...view(),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { tags, params: idParam },
    },
    async (q) => sendStatement(db, actorOf(q), q.params.id),
  );

  r.get(
    '/api/crm/leads',
    { ...view(), schema: { tags, querystring: z.object({ ownerId: z.string().optional() }) } },
    async (q) => funnel(db, actorOf(q), q.query.ownerId),
  );
  r.post('/api/crm/leads', { ...view(), schema: { tags, body: enquirySchema } }, async (q) =>
    createEnquiry(db, actorOf(q), q.body),
  );
  r.post(
    '/api/crm/leads/:id/action',
    { ...view(), schema: { tags, params: idParam, body: leadActionSchema } },
    async (q) => leadAction(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/crm/meca', { ...view(), schema: { tags, querystring: mecaQuery } }, async (q) =>
    meca(db, actorOf(q), q.query),
  );
}
