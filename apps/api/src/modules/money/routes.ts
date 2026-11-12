import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { billInputSchema, BILL_TYPES } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { homeBranchOf } from '../branches/reach';
import { createBill, issueBill, updateDraft, voidBill, workOutBill } from './bills';
import { billOut, getBill, listBills, setPromise } from './bills-read';
import { closeDay, dayClose, listModes, modeSchema, saveMode } from './cash';
import { outstanding, statement } from './ledger';
import {
  deleteParty,
  listParties,
  matchVendor,
  PARTY_KINDS,
  partySchema,
  saveParty,
  typedVendors,
} from './parties';
import { saveTallyMap, tallyExport, tallyMap } from './tally';
import { deleteTaxRate, listTaxRates, saveTaxRate, taxRateSchema } from './taxes';

const idParam = z.object({ id: z.string().max(40) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Phase 12M — the money core: parties, tax rates, bills, money owed, day close, Tally. Rights are `money.*`. */
export async function moneyRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['Money'];
  // A fresh hook list per route (decision 62).
  const view = () => ({ onRequest: [app.requirePermission('money.view')] });
  const signedIn = () => ({ onRequest: [app.authenticate] });

  // Parties are read by every form that picks one (an order, a booking), so reading needs only a sign-in.
  r.get(
    '/api/money/parties',
    {
      ...signedIn(),
      schema: {
        tags,
        querystring: z.object({ q: z.string().max(80).optional(), kind: z.enum(PARTY_KINDS).optional() }),
      },
    },
    async (q) => listParties(db, actorOf(q), q.query),
  );
  r.post('/api/money/parties', { ...view(), schema: { tags, body: partySchema } }, async (q) =>
    saveParty(db, actorOf(q), q.body),
  );
  r.put(
    '/api/money/parties/:id',
    { ...view(), schema: { tags, params: idParam, body: partySchema } },
    async (q) => saveParty(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/money/parties/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteParty(db, actorOf(q), q.params.id),
  );
  r.get(
    '/api/money/parties/:id/statement',
    {
      ...view(),
      schema: { tags, params: idParam, querystring: z.object({ from: day.optional(), to: day.optional() }) },
    },
    async (q) => statement(db, actorOf(q), q.params.id, q.query),
  );
  // Vendor names typed on items and purchase orders, for a person to say which party each is.
  r.get('/api/money/vendors', { ...view(), schema: { tags } }, async (q) => typedVendors(db, actorOf(q)));
  r.post(
    '/api/money/vendors/match',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({ name: z.string().trim().min(1).max(160), partyId: z.string().max(40).nullish() }),
      },
    },
    async (q) => matchVendor(db, actorOf(q), q.body),
  );

  r.get('/api/money/tax-rates', { ...signedIn(), schema: { tags } }, async (q) =>
    listTaxRates(db, actorOf(q)),
  );
  r.put('/api/money/tax-rates', { ...view(), schema: { tags, body: taxRateSchema } }, async (q) =>
    saveTaxRate(db, actorOf(q), q.body),
  );
  r.delete('/api/money/tax-rates/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteTaxRate(db, actorOf(q), q.params.id),
  );

  r.get(
    '/api/money/bills',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({
          type: z.enum(BILL_TYPES).optional(),
          status: z.string().max(20).optional(),
          partyId: z.string().max(40).optional(),
          from: day.optional(),
          to: day.optional(),
        }),
      },
    },
    async (q) => listBills(db, actorOf(q), q.query),
  );
  r.get('/api/money/bills/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    getBill(db, actorOf(q), q.params.id),
  );
  const billBody = billInputSchema.extend({
    /** Issue at once instead of keeping a draft. */
    issue: z.boolean().optional(),
    /** A receipt or payment: the papers it is for (else the party's oldest first). */
    allocate: z
      .array(z.object({ billId: z.string().max(40), amount: z.number().int().positive() }))
      .max(100)
      .optional(),
  });
  r.post('/api/money/bills', { ...signedIn(), schema: { tags, body: billBody } }, async (q) => {
    const { issue, allocate, ...input } = q.body;
    return billOut(await createBill(db, actorOf(q), input, { issue, allocate }));
  });
  // What a paper would come to, before it is saved: the form shows this as the person types.
  r.post(
    '/api/money/bills/preview',
    { ...signedIn(), schema: { tags, body: billInputSchema } },
    async (q) => {
      const actor = actorOf(q);
      const branchId =
        q.body.branchId === undefined
          ? await homeBranchOf(db, actor.companyId, actor.userId)
          : q.body.branchId;
      const { totals, seller } = await workOutBill(db, actor.companyId, q.body, branchId);
      return { ...totals, currency: seller.head.currency, regime: seller.regime };
    },
  );
  r.put(
    '/api/money/bills/:id',
    { ...signedIn(), schema: { tags, params: idParam, body: billInputSchema } },
    async (q) => billOut(await updateDraft(db, actorOf(q), q.params.id, q.body)),
  );
  r.post('/api/money/bills/:id/issue', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    billOut(await issueBill(db, actorOf(q), q.params.id)),
  );
  r.post(
    '/api/money/bills/:id/void',
    {
      ...signedIn(),
      schema: { tags, params: idParam, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
    },
    async (q) => billOut(await voidBill(db, actorOf(q), q.params.id, q.body.reason)),
  );
  r.post(
    '/api/money/bills/:id/promise',
    { ...view(), schema: { tags, params: idParam, body: z.object({ promisedOn: day.nullable() }) } },
    async (q) => setPromise(db, actorOf(q), q.params.id, q.body.promisedOn),
  );

  r.get(
    '/api/money/outstanding',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ side: z.enum(['receivable', 'payable']).default('receivable') }),
      },
    },
    async (q) => outstanding(db, actorOf(q), q.query.side),
  );

  r.get(
    '/api/money/modes',
    { ...signedIn(), schema: { tags, querystring: z.object({ branchId: z.string().max(40).optional() }) } },
    async (q) => listModes(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/money/modes', { ...view(), schema: { tags, body: modeSchema } }, async (q) =>
    saveMode(db, actorOf(q), q.body),
  );
  r.put(
    '/api/money/modes/:id',
    { ...view(), schema: { tags, params: idParam, body: modeSchema } },
    async (q) => saveMode(db, actorOf(q), q.body, q.params.id),
  );
  r.get(
    '/api/money/day-close',
    { ...view(), schema: { tags, querystring: z.object({ branchId: z.string().max(40), date: day }) } },
    async (q) => dayClose(db, actorOf(q), q.query.branchId, q.query.date),
  );
  r.post(
    '/api/money/day-close',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({
          branchId: z.string().max(40),
          date: day,
          counts: z
            .array(
              z.object({
                modeId: z.string().max(40),
                counted: z.number().int(),
                note: z.string().trim().max(200).nullish(),
              }),
            )
            .max(40),
        }),
      },
    },
    async (q) => closeDay(db, actorOf(q), q.body),
  );

  r.get('/api/money/tally/map', { ...view(), schema: { tags } }, async (q) => tallyMap(db, actorOf(q)));
  r.put(
    '/api/money/tally/map',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({
          rows: z
            .array(z.object({ head: z.string().max(80), ledger: z.string().max(120).nullable() }))
            .max(300),
        }),
      },
    },
    async (q) => saveTallyMap(db, actorOf(q), q.body.rows),
  );
  r.get(
    '/api/money/tally/export',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ from: day, to: day, entityId: z.string().max(40).optional() }),
      },
    },
    async (q, reply) => {
      const { xml } = await tallyExport(db, actorOf(q), q.query);
      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="vouchers-${q.query.from}-${q.query.to}.xml"`)
        .send(xml);
    },
  );
}
