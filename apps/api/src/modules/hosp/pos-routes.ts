import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { addItemsSchema, checkSchema, orderSchema, paymentSchema, splitSchema } from '@mono/shared';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { decideApproval, decideSchema } from './approvals';
import { makeCheck, splitOrder } from './checks';
import { listChecks, reprintCheck } from './checks-read';
import {
  closeDay,
  closeSchema,
  closeShift,
  deviceSchema,
  openShift,
  reopenDay,
  reserveForDevice,
  shift,
  zReport,
} from './day';
import { itemReady, kdsQuery, kitchenDisplay, kotAction } from './kds';
import { addItems, cancelOrder, fireOrder, fireSchema, openOrder } from './orders';
import { floorView, getOrder } from './orders-read';
import { cancelCheck, cancelSchema, payCheck } from './payments';
import { agentDone, agentJobs, failedJobs, sendQueued } from './print';
import { tableOp, tableOpSchema } from './table-ops';
import { listApprovals, voidItem, voidReport, voidSchema } from './voids';

const idParam = z.object({ id: z.string() });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cash = z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(100000));

/** The POS (phase 15): orders, kitchen tickets and display, bills, payments, shift and day close, printing. */
export async function posRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['pos'];
  // A fresh hook list per route (decision 62); the services check the finer rights and the outlet's branch.
  const view = () => ({ onRequest: [app.requirePermission('hosp.view')] });
  const db = app.prisma;
  const byId = () => ({ ...view(), schema: { tags, params: idParam } });
  const withId = <T extends z.ZodTypeAny>(schema: T) => ({
    ...view(),
    schema: { tags, params: idParam, body: schema },
  });
  // What was just queued for a network printer is sent at once (the worker retries what fails). Not under test:
  // the tests send by hand to a printer of their own.
  const printNow = <T>(companyId: string, result: T): T => {
    if (!process.env.VITEST) void sendQueued(db, companyId).catch(() => undefined);
    return result;
  };
  const dayQuery = () => ({
    ...view(),
    schema: { tags, params: idParam, querystring: z.object({ day: day.optional() }) },
  });

  r.get('/api/pos/outlets/:id/floor', byId(), async (q) => floorView(db, actorOf(q), q.params.id));
  r.post('/api/pos/orders', { ...view(), schema: { tags, body: orderSchema } }, async (q) =>
    openOrder(db, actorOf(q), q.body),
  );
  r.get('/api/pos/orders/:id', byId(), async (q) => getOrder(db, actorOf(q), q.params.id));
  r.post('/api/pos/orders/:id/items', withId(addItemsSchema), async (q) =>
    addItems(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/pos/orders/:id/fire', withId(fireSchema), async (q) =>
    fireOrder(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/pos/orders/:id/cancel', byId(), async (q) => cancelOrder(db, actorOf(q), q.params.id));
  r.post('/api/pos/orders/:id/table', withId(tableOpSchema), async (q) =>
    tableOp(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/pos/orders/:id/split', withId(splitSchema), async (q) =>
    splitOrder(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/pos/orders/:id/check', withId(checkSchema), async (q) =>
    makeCheck(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/pos/orders/:id/items/:itemId/void',
    {
      ...view(),
      schema: { tags, params: z.object({ id: z.string(), itemId: z.string() }), body: voidSchema },
    },
    async (q) => voidItem(db, actorOf(q), q.params.id, q.params.itemId, q.body),
  );

  r.get(
    '/api/pos/outlets/:id/kds',
    { ...view(), schema: { tags, params: idParam, querystring: kdsQuery } },
    async (q) => kitchenDisplay(db, actorOf(q), q.params.id, q.query),
  );
  for (const action of ['ready', 'bump', 'recall'] as const)
    r.post(`/api/pos/kots/:id/${action}`, byId(), async (q) =>
      kotAction(db, actorOf(q), q.params.id, action),
    );
  r.post('/api/pos/items/:id/ready', withId(z.object({ ready: z.boolean() })), async (q) =>
    itemReady(db, actorOf(q), q.params.id, q.body.ready),
  );

  r.get('/api/pos/outlets/:id/checks', dayQuery(), async (q) =>
    listChecks(db, actorOf(q), q.params.id, q.query.day),
  );
  r.post('/api/pos/checks/:id/pay', withId(paymentSchema), async (q) =>
    payCheck(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/pos/checks/:id/reprint', byId(), async (q) =>
    printNow(q.auth!.companyId, await reprintCheck(db, actorOf(q), q.params.id)),
  );
  r.post('/api/pos/checks/:id/cancel', withId(cancelSchema), async (q) =>
    cancelCheck(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/pos/outlets/:id/approvals', byId(), async (q) => listApprovals(db, actorOf(q), q.params.id));
  r.post('/api/pos/approvals/:id/decide', withId(decideSchema), async (q) =>
    decideApproval(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/pos/outlets/:id/voids', dayQuery(), async (q) => {
    const z0 = await zReport(db, actorOf(q), q.params.id, q.query.day);
    return voidReport(db, actorOf(q), q.params.id, z0.businessDay);
  });

  r.get('/api/pos/outlets/:id/day', dayQuery(), async (q) =>
    zReport(db, actorOf(q), q.params.id, q.query.day),
  );
  r.post('/api/pos/outlets/:id/day/close', withId(closeSchema), async (q) =>
    closeDay(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/pos/outlets/:id/day/reopen',
    withId(z.object({ businessDay: day, reason: z.string() })),
    async (q) => reopenDay(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/pos/outlets/:id/shift', byId(), async (q) => shift(db, actorOf(q), q.params.id));
  r.post(
    '/api/pos/outlets/:id/shift/open',
    withId(z.object({ float: z.number().int().min(0).max(1e10).default(0) })),
    async (q) => openShift(db, actorOf(q), q.params.id, q.body.float),
  );
  r.post('/api/pos/outlets/:id/shift/close', withId(z.object({ cash })), async (q) =>
    closeShift(db, actorOf(q), q.params.id, q.body.cash),
  );
  r.post('/api/pos/outlets/:id/device', withId(deviceSchema), async (q) =>
    reserveForDevice(db, actorOf(q), q.params.id, q.body),
  );

  r.get('/api/pos/print-jobs', { ...view(), schema: { tags } }, async (q) => failedJobs(db, actorOf(q)));
  // A branch's site agent (signed in with its own login or an API key's maker) pulls what it must print.
  r.get(
    '/api/pos/print-jobs/agent',
    { ...view(), schema: { tags, querystring: z.object({ branchId: z.string() }) } },
    async (q) => agentJobs(db, actorOf(q), q.query.branchId),
  );
  r.post(
    '/api/pos/print-jobs/:id/done',
    withId(z.object({ ok: z.boolean(), error: z.string().max(200).nullish() })),
    async (q) => agentDone(db, actorOf(q), q.params.id, q.body.ok, q.body.error),
  );
}
