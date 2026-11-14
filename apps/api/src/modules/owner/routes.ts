import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { exceptions, league, RANGE_KEYS, saveRanges } from './branches';
import { busFactor } from './busfactor';
import { cashFlow } from './cashflow';
import { costOfDelay, saveDelayValue } from './delay';
import { linkCompany, morning, unlinkCompany } from './group';
import { leaks } from './leaks';
import { promises } from './promises';
import { vendors } from './vendors';

/** The owner's desk: reports that look across branches, people and companies. Owner and admins only. */
export async function ownerRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['owner'];
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const span = z.object({ from: day.optional(), to: day.optional() });
  // A fresh hook list per route (decision 62).
  const signedIn = () => ({ onRequest: [app.authenticate] });

  r.get('/api/owner/morning', { ...signedIn(), schema: { tags } }, async (q) => morning(db, actorOf(q)));
  r.post(
    '/api/owner/companies',
    {
      ...signedIn(),
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags,
        body: z.object({
          identifier: z.string().min(3).max(200),
          password: z.string().min(1).max(200),
          companyId: z.string().max(40).optional(),
        }),
      },
    },
    async (q) => linkCompany(db, actorOf(q), q.body),
  );
  r.delete(
    '/api/owner/companies/:id',
    { ...signedIn(), schema: { tags, params: z.object({ id: z.string() }) } },
    async (q) => unlinkCompany(db, actorOf(q), q.params.id),
  );
  // Shadow mode starts here (and is written in the audit log); the looking itself is the `x-mono-view-as` header.
  r.post(
    '/api/owner/view-as',
    { ...signedIn(), schema: { tags, body: z.object({ userId: z.string().max(40) }) } },
    async (q) => {
      if (q.auth!.roleKey !== 'OWNER')
        throw new AppError(403, 'FORBIDDEN', 'Only an Owner can look as someone else');
      const person = await db.user.findFirst({
        where: { id: q.body.userId, companyId: q.auth!.companyId, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!person) throw new AppError(404, 'NOT_FOUND', 'Person not found');
      await db.auditLog.create({
        data: {
          companyId: q.auth!.companyId,
          actorId: q.auth!.userId,
          action: 'owner.viewed_as',
          entityType: 'user',
          entityId: person.id,
          after: { name: person.name },
        },
      });
      return person;
    },
  );
  r.get('/api/owner/exceptions', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    exceptions(db, actorOf(q), q.query.from, q.query.to),
  );
  r.put(
    '/api/owner/ranges',
    {
      ...signedIn(),
      schema: {
        tags,
        body: z.object({
          branchId: z.string().max(40).nullish(),
          ranges: z.object(
            Object.fromEntries(RANGE_KEYS.map((k) => [k, z.number().min(0).max(1_000_000).optional()])),
          ),
        }),
      },
    },
    async (q) => saveRanges(db, actorOf(q), q.body),
  );
  r.get('/api/owner/league', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    league(db, actorOf(q), q.query.from, q.query.to),
  );
  r.get('/api/owner/leaks', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    leaks(db, actorOf(q), q.query.from, q.query.to),
  );
  r.get('/api/owner/promises', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    promises(db, actorOf(q), q.query.from, q.query.to),
  );
  r.get('/api/owner/delay', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    costOfDelay(db, actorOf(q), q.query.from, q.query.to),
  );
  r.put(
    '/api/owner/delay',
    {
      ...signedIn(),
      schema: {
        tags,
        body: z.object({ flowId: z.string().max(40), rupeesPerDay: z.number().min(0).max(100_000_000) }),
      },
    },
    async (q) => saveDelayValue(db, actorOf(q), q.body),
  );
  r.get('/api/owner/bus-factor', { ...signedIn(), schema: { tags } }, async (q) => busFactor(db, actorOf(q)));
  r.get('/api/owner/vendors', { ...signedIn(), schema: { tags } }, async (q) => vendors(db, actorOf(q)));
  r.get('/api/owner/cash-flow', { ...signedIn(), schema: { tags } }, async (q) => cashFlow(db, actorOf(q)));
}
