import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Storage } from '../../lib/storage';
import { actorOf } from '../delegation/routes';
import { auditInputSchema, listAudits, recordAudit } from './audits';
import { archiveFranchise, exportFranchise } from './exit';
import { listRoyalties, raiseRoyalty, setRoyaltyStatus } from './royalty';

const idParam = z.object({ id: z.string().max(40) });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Phase 12, stage D (plan §3.8): royalties, brand audits and a franchise's exit. Rights are checked inside. */
export async function franchiseRoutes(app: FastifyInstance, opts: { storage: Storage }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['Franchise'];
  const signedIn = () => ({ onRequest: [app.authenticate] });

  // A franchise's own people get their own invoices; the brand team all of them.
  r.get('/api/franchise/royalties', { ...signedIn(), schema: { tags } }, async (q) =>
    listRoyalties(db, actorOf(q), q.reachAll?.franchise?.entityId),
  );
  r.post(
    '/api/franchise/royalties',
    { ...signedIn(), schema: { tags, body: z.object({ entityId: z.string().max(40), month }) } },
    async (q) => raiseRoyalty(db, actorOf(q), q.body.entityId, q.body.month),
  );
  r.post(
    '/api/franchise/royalties/:id/status',
    {
      ...signedIn(),
      schema: { tags, params: idParam, body: z.object({ status: z.enum(['PAID', 'CANCELLED']) }) },
    },
    async (q) => setRoyaltyStatus(db, actorOf(q), q.params.id, q.body.status),
  );

  r.get(
    '/api/franchise/audits',
    { ...signedIn(), schema: { tags, querystring: z.object({ branchId: z.string().max(40).optional() }) } },
    async (q) => listAudits(db, actorOf(q), q.query.branchId),
  );
  r.post('/api/franchise/audits', { ...signedIn(), schema: { tags, body: auditInputSchema } }, async (q) =>
    recordAudit(db, actorOf(q), q.body),
  );

  r.get(
    '/api/franchise/:id/export',
    { ...signedIn(), schema: { tags, params: idParam } },
    async (q, reply) => {
      const { name, zip } = await exportFranchise(db, opts.storage, actorOf(q), q.params.id);
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .send(zip);
    },
  );
  r.post('/api/franchise/:id/archive', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    archiveFranchise(db, actorOf(q), q.params.id),
  );
}
