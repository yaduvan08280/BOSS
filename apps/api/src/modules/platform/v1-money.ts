import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { billInputSchema, BILL_TYPES } from '@mono/shared';
import { createBill } from '../money/bills';
import { billOut, getBill, listBills } from '../money/bills-read';
import { statement } from '../money/ledger';
import { listParties, partySchema, saveParty } from '../money/parties';
import type { Actor } from '../work/actor';

const idParam = z.object({ id: z.string().max(60) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type Kit = {
  keyed: () => {
    onRequest: ((q: FastifyRequest) => Promise<void>)[];
    config: { rateLimit: { max: number; timeWindow: string; keyGenerator: (q: FastifyRequest) => string } };
  };
  doc: <S extends object = object>(
    summary: string,
    extra?: S,
  ) => { tags: string[]; security: { apiKey: never[] }[]; summary: string } & S;
  actor: (q: FastifyRequest) => Actor;
};

/**
 * The money core in the public API (phase 12M): parties and bills. The same engine as the screens runs underneath,
 * so a key makes exactly the papers its maker may, with the same numbers, vouchers and audit rows.
 */
export function v1MoneyRoutes(app: FastifyInstance, { keyed, doc, actor }: Kit) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;

  r.get(
    '/api/v1/parties',
    { ...keyed(), schema: doc('Parties', { querystring: z.object({ q: z.string().max(80).optional() }) }) },
    async (q) => ({ parties: await listParties(db, actor(q), q.query) }),
  );
  r.post('/api/v1/parties', { ...keyed(), schema: doc('Add a party', { body: partySchema }) }, async (q) =>
    saveParty(db, actor(q), q.body),
  );
  r.get(
    '/api/v1/parties/:id/statement',
    {
      ...keyed(),
      schema: doc("A party's statement", {
        params: idParam,
        querystring: z.object({ from: day.optional(), to: day.optional() }),
      }),
    },
    async (q) => statement(db, actor(q), q.params.id, q.query),
  );
  r.get(
    '/api/v1/bills',
    {
      ...keyed(),
      schema: doc('Bills', {
        querystring: z.object({
          type: z.enum(BILL_TYPES).optional(),
          partyId: z.string().max(40).optional(),
          from: day.optional(),
          to: day.optional(),
        }),
      }),
    },
    async (q) => ({ bills: await listBills(db, actor(q), q.query) }),
  );
  r.get('/api/v1/bills/:id', { ...keyed(), schema: doc('One bill', { params: idParam }) }, async (q) =>
    getBill(db, actor(q), q.params.id),
  );
  r.post(
    '/api/v1/bills',
    {
      ...keyed(),
      schema: doc('Make a bill (issued at once unless `issue` is false)', {
        body: billInputSchema.extend({ issue: z.boolean().optional() }),
      }),
    },
    async (q) => {
      const { issue, ...input } = q.body;
      return billOut(
        await createBill(db, actor(q), input, { issue: issue ?? true, source: { type: 'api', id: 'v1' } }),
      );
    },
  );
}
