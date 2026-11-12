import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { backfillState } from './backfill';

const ownerRef = z.string().regex(/^(flow|recordType):[A-Za-z0-9_-]{1,40}$/);

/** Reportable fields and the report builder (plan §2.7). */
export async function reportRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['Reports'];
  // A fresh hook list per route (decision 62).
  const signedIn = () => ({ onRequest: [app.authenticate] });

  // How far the copy of each reportable field is, for the form editor ("Copying 1,240 of 8,000").
  r.get(
    '/api/reports/backfills',
    { ...signedIn(), schema: { tags, querystring: z.object({ owner: ownerRef }) } },
    async (q) => {
      const [kind, id] = q.query.owner.split(':') as ['flow' | 'recordType', string];
      return backfillState(db, actorOf(q).companyId, { kind, id });
    },
  );
}
