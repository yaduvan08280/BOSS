import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { forCompany } from '@mono/db';
import { moveSchema } from '@mono/shared';
import { unauthenticated } from '../../lib/errors';
import { listCustomers, saveCustomer, customerSchema } from '../crm/customers';
import { createOrder, orderSchema } from '../crm/orders';
import { need } from '../crm/access';
import { actorOf } from '../delegation/routes';
import { completeStep, startRecord } from '../fms/engine';
import { recordDetail } from '../fms/queries';
import { listItems } from '../ims/items';
import { postMove } from '../ims/moves';
import { listRows, saveRow } from '../masters/rows';
import { resolveApiKey } from './keys';

const idParam = z.object({ id: z.string().max(40) });
const values = z.record(z.string(), z.unknown());
/** The key from `Authorization: Bearer mono_…` or `X-Api-Key: mono_…`. */
const rawKey = (q: FastifyRequest) => {
  const h = q.headers.authorization;
  if (h?.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  const x = q.headers['x-api-key'];
  return typeof x === 'string' ? x.trim() : undefined;
};

/**
 * The public API (CLAUDE.md §12) under /api/v1: an API key instead of a sign-in. The key acts as the person who
 * made it, with that person's permissions, so every service check, audit row and event works as on the web.
 * 120 calls a minute per key.
 */
export async function v1Routes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['Public API v1'];
  const security = [{ apiKey: [] }];
  const keyAuth = async (q: FastifyRequest) => {
    const k = await resolveApiKey(db, rawKey(q));
    if (!k) throw unauthenticated('A valid API key is needed (Authorization: Bearer mono_…)');
    q.auth = {
      userId: k.userId,
      companyId: k.companyId,
      sessionId: `api:${k.keyId}`,
      roleKey: k.roleKey,
      permissions: k.permissions,
    };
    q.db = forCompany(db, k.companyId);
  };
  // A fresh hook list and rate-limit config per route (decision 62).
  const keyed = () => ({
    onRequest: [keyAuth],
    config: {
      rateLimit: {
        max: 120,
        timeWindow: '1 minute',
        keyGenerator: (q: FastifyRequest) => `v1:${(rawKey(q) ?? q.ip).slice(0, 18)}`,
      },
    },
  });
  const doc = <S extends object = object>(summary: string, extra?: S) => ({
    tags,
    security,
    summary,
    ...(extra as S),
  });
  const actor = (q: FastifyRequest) => ({
    ...actorOf(q),
    userAgent: `api-key ${q.auth!.sessionId.slice(4)} · ${q.headers['user-agent'] ?? ''}`.slice(0, 300),
  });

  r.get('/api/v1/me', { ...keyed(), schema: doc('Who this key acts as') }, async (q) => {
    const u = await db.user.findUniqueOrThrow({
      where: { id: q.auth!.userId },
      select: { name: true, company: { select: { name: true } } },
    });
    return {
      company: u.company.name,
      actsAs: u.name,
      role: q.auth!.roleKey,
      permissions: q.auth!.permissions,
    };
  });

  // ---- Customers
  r.get(
    '/api/v1/customers',
    { ...keyed(), schema: doc('List customers (with 12-month sales, GP and tags)') },
    async (q) => (await listCustomers(db, actor(q))).customers,
  );
  r.post(
    '/api/v1/customers',
    { ...keyed(), schema: doc('Add a customer', { body: customerSchema }) },
    async (q) => saveCustomer(db, actor(q), q.body),
  );
  r.put(
    '/api/v1/customers/:id',
    { ...keyed(), schema: doc('Change a customer', { params: idParam, body: customerSchema }) },
    async (q) => saveCustomer(db, actor(q), q.body, q.params.id),
  );

  // ---- Items and stock
  r.get(
    '/api/v1/items',
    { ...keyed(), schema: doc('List items with stock, MAX and band (money in paise, as strings)') },
    async (q) => (await listItems(db, actor(q))).items,
  );
  r.post(
    '/api/v1/stock-moves',
    {
      ...keyed(),
      schema: doc('Post a stock move (IN, OUT, TRANSFER; ADJUST waits for approval)', { body: moveSchema }),
    },
    async (q) => postMove(db, actor(q), q.body),
  );

  // ---- Orders
  r.get(
    '/api/v1/orders',
    {
      ...keyed(),
      schema: doc('List sales orders, newest first', {
        querystring: z.object({
          from: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          status: z.enum(['OPEN', 'DONE', 'CANCELLED']).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
      }),
    },
    async (q) => {
      const a = actor(q);
      need(a, 'crm.view', "You can't see orders");
      const rows = await db.salesOrder.findMany({
        where: {
          companyId: a.companyId,
          ...(q.query.from ? { orderDate: { gte: q.query.from } } : {}),
          ...(q.query.status ? { status: q.query.status } : {}),
        },
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        take: q.query.limit,
        include: { customer: { select: { id: true, name: true } } },
      });
      return rows.map((o) => ({
        id: o.id,
        number: o.number,
        customer: o.customer,
        orderDate: o.orderDate,
        amountPaise: o.amount.toString(),
        gpPaise: o.gp.toString(),
        items: o.items,
        promisedOn: o.promisedOn,
        dueOn: o.dueOn,
        status: o.status,
        recordId: o.recordId,
        note: o.note,
      }));
    },
  );
  r.post(
    '/api/v1/orders',
    { ...keyed(), schema: doc('Take an order (starts the after-order process)', { body: orderSchema }) },
    async (q) => {
      const o = await createOrder(db, actor(q), q.body);
      return { id: o.id, number: o.number };
    },
  );

  // ---- Processes (FMS)
  r.get(
    '/api/v1/flows',
    { ...keyed(), schema: doc('Published processes and their start-form fields') },
    async (q) => {
      need(actor(q), 'fms.view', "You can't see processes");
      const flows = await db.flow.findMany({
        where: { companyId: q.auth!.companyId, status: 'PUBLISHED', deletedAt: null },
        orderBy: { name: 'asc' },
      });
      const versions = await db.flowVersion.findMany({
        where: { id: { in: flows.map((f) => f.currentVersionId).filter((x): x is string => Boolean(x)) } },
        select: { id: true, definition: true },
      });
      const defOf = new Map(versions.map((v) => [v.id, v.definition as { startFields?: unknown }]));
      return flows.map((f) => ({
        id: f.id,
        name: f.name,
        runName: f.runName,
        version: f.version,
        startFields: (f.currentVersionId && defOf.get(f.currentVersionId)?.startFields) || [],
      }));
    },
  );
  r.post(
    '/api/v1/flows/:id/records',
    {
      ...keyed(),
      schema: doc('Start a record from the start form', {
        params: idParam,
        body: z.object({ data: values }),
      }),
    },
    async (q) => {
      const a = actor(q);
      need(a, 'fms.create', "You can't start records");
      return startRecord(db, {
        companyId: a.companyId,
        flowId: q.params.id,
        data: q.body.data,
        startedById: a.userId,
        source: 'api',
      });
    },
  );
  r.get(
    '/api/v1/records/:id',
    { ...keyed(), schema: doc('A record with its steps', { params: idParam }) },
    async (q) => recordDetail(db, actor(q), q.params.id),
  );
  r.post(
    '/api/v1/steps/:id/complete',
    {
      ...keyed(),
      schema: doc('Mark a step done', {
        params: idParam,
        body: z.object({
          data: values.default({}),
          checklistDone: z.array(z.string()).max(60).default([]),
          decision: z.enum(['yes', 'no', 'approved', 'rejected']).optional(),
          note: z.string().max(2000).optional(),
        }),
      }),
    },
    async (q) => {
      need(actor(q), 'fms.view', "You can't do process steps");
      return completeStep(db, actor(q), q.params.id, q.body);
    },
  );

  // ---- Masters
  r.get(
    '/api/v1/masters',
    { ...keyed(), schema: doc('Your masters and their fields') },
    async (q) =>
      await db.masterDef.findMany({
        where: { companyId: q.auth!.companyId, deletedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, fields: true, keyField: true, displayField: true },
      }),
  );
  r.get(
    '/api/v1/masters/:id/rows',
    { ...keyed(), schema: doc("A master's rows", { params: idParam }) },
    async (q) => {
      const { rows, total } = await listRows(db, actor(q), q.params.id);
      return { rows, total };
    },
  );
  r.post(
    '/api/v1/masters/:id/rows',
    { ...keyed(), schema: doc('Add a row to a master', { params: idParam, body: values }) },
    async (q) => saveRow(db, actor(q), q.params.id, q.body),
  );
}
