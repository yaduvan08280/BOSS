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
import { letterFor } from './letter';
import { copyChecklists, whatIfBase } from './whatif';
import { promises } from './promises';
import { pulse, pulsePage, ratePulse } from './pulse';
import {
  answerSpotCheck,
  askSpotCheck,
  decideSpotCheck,
  mySpotChecks,
  saveSpotRules,
  spotChecks,
} from './spot';
import { vendors } from './vendors';

/** The owner's desk: reports that look across branches, people and companies. Owner and admins only. */
export async function ownerRoutes(app: FastifyInstance, opts: { secret: string }) {
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
        select: { id: true, name: true, role: { select: { key: true } } },
      });
      if (!person) throw new AppError(404, 'NOT_FOUND', 'Person not found');
      if (person.role.key === 'OWNER' && person.id !== q.auth!.userId)
        throw new AppError(403, 'FORBIDDEN', "Another Owner's view is not open to you");
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
      return { id: person.id, name: person.name };
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
  r.get('/api/owner/letter', { ...signedIn(), schema: { tags } }, async (q) =>
    letterFor(db, actorOf(q), opts.secret),
  );
  r.get('/api/owner/what-if', { ...signedIn(), schema: { tags } }, async (q) => whatIfBase(db, actorOf(q)));
  r.post(
    '/api/owner/copy-checklists',
    {
      ...signedIn(),
      schema: { tags, body: z.object({ fromBranchId: z.string().max(40), toBranchId: z.string().max(40) }) },
    },
    async (q) => copyChecklists(db, actorOf(q), q.body),
  );
  r.get('/api/owner/pulse', { ...signedIn(), schema: { tags, querystring: span } }, async (q) =>
    pulse(db, actorOf(q), opts.secret, q.query.from, q.query.to),
  );
  // The guest's page behind the QR: no sign-in; limited per address, with a hidden field robots fill in.
  const tokenParam = z.object({ token: z.string().min(10).max(120) });
  r.get(
    '/api/public/pulse/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags, params: tokenParam } },
    async (q) => pulsePage(db, opts.secret, q.params.token),
  );
  r.post(
    '/api/public/pulse/:token',
    {
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: tokenParam,
        body: z.object({
          stars: z.number().int().min(1).max(5),
          comment: z.string().max(500).nullish(),
          billNo: z.string().max(40).nullish(),
          website: z.string().max(200).optional(),
        }),
      },
    },
    async (q) => (q.body.website ? { ok: true } : ratePulse(db, opts.secret, q.params.token, q.body)),
  );
  // Surprise checks: the rule and the results for the owner; the asking and judging for whoever it concerns.
  r.get('/api/owner/spot-checks', { ...signedIn(), schema: { tags } }, async (q) =>
    spotChecks(db, actorOf(q)),
  );
  r.put(
    '/api/owner/spot-checks',
    {
      ...signedIn(),
      schema: {
        tags,
        body: z.object({ perDay: z.number().min(0).max(20), minutes: z.number().min(5).max(120) }),
      },
    },
    async (q) => saveSpotRules(db, actorOf(q), q.body),
  );
  r.post('/api/owner/spot-checks/ask', { ...signedIn(), schema: { tags } }, async (q) => {
    await spotChecks(db, actorOf(q)); // the same right as the page
    return { asked: Boolean(await askSpotCheck(db, q.auth!.companyId)) };
  });
  r.get('/api/spot-checks/mine', { ...signedIn(), schema: { tags } }, async (q) =>
    mySpotChecks(db, actorOf(q)),
  );
  const idParam = z.object({ id: z.string().max(40) });
  r.post(
    '/api/spot-checks/:id/answer',
    {
      ...signedIn(),
      schema: { tags, params: idParam, body: z.object({ attachmentId: z.string().max(40) }) },
    },
    async (q) => answerSpotCheck(db, actorOf(q), q.params.id, q.body.attachmentId),
  );
  r.post(
    '/api/spot-checks/:id/decide',
    {
      ...signedIn(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ ok: z.boolean(), note: z.string().max(500).nullish() }),
      },
    },
    async (q) => decideSpotCheck(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/owner/bus-factor', { ...signedIn(), schema: { tags } }, async (q) => busFactor(db, actorOf(q)));
  r.get('/api/owner/vendors', { ...signedIn(), schema: { tags } }, async (q) => vendors(db, actorOf(q)));
  r.get('/api/owner/cash-flow', { ...signedIn(), schema: { tags } }, async (q) => cashFlow(db, actorOf(q)));
}
