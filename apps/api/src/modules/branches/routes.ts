import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  APPROVAL_KINDS,
  approvalRouteSchema,
  departmentHeadSchema,
  entitySchema,
  locationSchema,
  managersSchema,
  personBranchesSchema,
  regionSchema,
} from '@mono/shared';
import { hasPermission } from '@mono/shared';
import { forbidden, notFound } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { chainFor, deleteRoute, listRoutes, saveRoute } from './approvals';
import { compareOutlets } from './compare';
import { lendPerson } from './history';
import { closeBranch, closePreview, copyBranch } from './lifecycle';
import { listRates, saveRate } from './money';
import {
  deleteEntity,
  deleteLocation,
  deleteRegion,
  myBranches,
  saveEntity,
  saveLocation,
  saveRegion,
  setDepartmentHead,
  setManagers,
  setPersonBranches,
  structure,
} from './structure';

const idParam = z.object({ id: z.string().max(40) });

/** Phase 12 (plan §3): the group's structure — entities, regions, branches, locations — and who runs what. */
export async function branchRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;
  const tags = ['Branches'];
  // A fresh hook list per route (decision 62).
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const view = () => ({ onRequest: [app.requirePermission('org.view')] });
  // The structure is the group's: someone whose role reaches only their branches can't change it.
  const groupWide = () => ({
    onRequest: [
      app.requirePermission('org.view'),
      async (q: FastifyRequest) => {
        if (q.reachAll?.branchIds) throw forbidden("Only the group's admins change the structure");
      },
    ],
  });

  r.get('/api/branches/structure', { ...view(), schema: { tags } }, async (q) => structure(db, actorOf(q)));
  // The top bar's switcher: the branches this person may look at (before the switcher narrows anything).
  r.get('/api/branches/mine', { ...signedIn(), schema: { tags } }, async (q) => {
    const all = q.reachAll?.branchIds ?? null;
    return { ...(await myBranches(db, actorOf(q), all)), wholeGroup: all === null };
  });

  r.post('/api/branches/entities', { ...groupWide(), schema: { tags, body: entitySchema } }, async (q) =>
    saveEntity(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/entities/:id',
    { ...groupWide(), schema: { tags, params: idParam, body: entitySchema } },
    async (q) => saveEntity(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/entities/:id', { ...groupWide(), schema: { tags, params: idParam } }, async (q) =>
    deleteEntity(db, actorOf(q), q.params.id),
  );

  r.post('/api/branches/regions', { ...groupWide(), schema: { tags, body: regionSchema } }, async (q) =>
    saveRegion(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/regions/:id',
    { ...groupWide(), schema: { tags, params: idParam, body: regionSchema } },
    async (q) => saveRegion(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/regions/:id', { ...groupWide(), schema: { tags, params: idParam } }, async (q) =>
    deleteRegion(db, actorOf(q), q.params.id),
  );

  r.post('/api/branches/locations', { ...groupWide(), schema: { tags, body: locationSchema } }, async (q) =>
    saveLocation(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/locations/:id',
    { ...groupWide(), schema: { tags, params: idParam, body: locationSchema } },
    async (q) => saveLocation(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/locations/:id', { ...groupWide(), schema: { tags, params: idParam } }, async (q) =>
    deleteLocation(db, actorOf(q), q.params.id),
  );

  r.put('/api/branches/managers', { ...groupWide(), schema: { tags, body: managersSchema } }, async (q) =>
    setManagers(db, actorOf(q), q.body),
  );
  r.put(
    '/api/branches/people/:id',
    { ...groupWide(), schema: { tags, params: idParam, body: personBranchesSchema } },
    async (q) => setPersonBranches(db, actorOf(q), q.params.id, q.body),
  );
  r.put(
    '/api/branches/department-heads',
    { ...groupWide(), schema: { tags, body: departmentHeadSchema } },
    async (q) => setDepartmentHead(db, actorOf(q), q.body),
  );
  // Approval routing (decision 14): the owner sets who approves what, for the group, an entity or a branch.
  r.get('/api/branches/approvals', { ...view(), schema: { tags } }, async (q) => listRoutes(db, actorOf(q)));
  r.put(
    '/api/branches/approvals',
    { ...signedIn(), schema: { tags, body: approvalRouteSchema } },
    async (q) => saveRoute(db, actorOf(q), q.body),
  );
  r.delete('/api/branches/approvals/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    deleteRoute(db, actorOf(q), q.params.id),
  );
  /** "Who would decide?" — the ladder for one person's request, to check a route before relying on it. */
  r.get(
    '/api/branches/approvals/preview',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({
          kind: z.enum(APPROVAL_KINDS),
          userId: z.string().max(40),
          amount: z.coerce.number().min(0).optional(),
        }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      const chain = await chainFor(db, actor.companyId, q.query.kind, {
        requesterId: q.query.userId,
        amount: q.query.amount,
      });
      return { chain };
    },
  );
  /** Outlets side by side: attendance, checklist misses, ticket times and on-time work for a period. */
  r.get(
    '/api/branches/compare',
    {
      onRequest: [app.requirePermission('reports.view')],
      schema: {
        tags,
        querystring: z
          .object({ from: z.coerce.date(), to: z.coerce.date() })
          .refine((q) => q.from < q.to, 'Pick a period'),
      },
    },
    async (q) => ({ rows: await compareOutlets(db, actorOf(q), q.query.from, q.query.to) }),
  );
  // Opening an outlet by copying another, and closing one once its people and open work have a new home.
  r.post(
    '/api/branches/:id/copy',
    {
      ...groupWide(),
      schema: {
        tags,
        params: idParam,
        body: z.object({
          name: z.string().trim().min(1, 'Enter a name').max(120),
          code: z.string().trim().max(20).nullish(),
          city: z.string().trim().max(80).nullish(),
          regionId: z.string().max(40).nullish(),
        }),
      },
    },
    async (q) => copyBranch(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/branches/:id/close', { ...groupWide(), schema: { tags, params: idParam } }, async (q) =>
    closePreview(db, actorOf(q), q.params.id),
  );
  r.post(
    '/api/branches/:id/close',
    {
      ...groupWide(),
      schema: { tags, params: idParam, body: z.object({ moveToBranchId: z.string().max(40).nullish() }) },
    },
    async (q) => closeBranch(db, actorOf(q), q.params.id, q.body.moveToBranchId),
  );
  // Lending staff (plan §3.4): a person works at another branch for some days.
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  r.get('/api/branches/loans', { ...view(), schema: { tags } }, async (q) =>
    db.branchLoan.findMany({
      where: { companyId: actorOf(q).companyId },
      orderBy: { from: 'desc' },
      take: 200,
    }),
  );
  r.post(
    '/api/branches/loans',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({
          userId: z.string().max(40),
          branchId: z.string().max(40),
          from: day,
          to: day,
          note: z.string().trim().max(200).nullish(),
        }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      await mayLend(q, q.body.userId);
      return lendPerson(db, { companyId: actor.companyId, actorId: actor.userId }, q.body);
    },
  );
  r.delete('/api/branches/loans/:id', { ...view(), schema: { tags, params: idParam } }, async (q) => {
    const actor = actorOf(q);
    const loan = await db.branchLoan.findFirst({ where: { id: q.params.id, companyId: actor.companyId } });
    if (!loan) throw notFound('Loan');
    await mayLend(q, loan.userId);
    await db.branchLoan.delete({ where: { id: loan.id } });
    return { ok: true };
  });
  /** Lending is for whoever may change people — and, below the group, only for people of their own branches. */
  async function mayLend(q: FastifyRequest, userId: string) {
    const actor = actorOf(q);
    if (!actor.permissions.includes('*') && !hasPermission(actor.permissions, 'org.edit')) throw forbidden();
    const mine = q.reachAll?.branchIds;
    if (!mine) return;
    const person = await db.user.findFirst({ where: { id: userId, companyId: actor.companyId } });
    if (!person?.branchId || !mine.includes(person.branchId))
      throw forbidden('You lend only the people of your own branches');
  }
  // Exchange rates (decision 11): one per currency per month, typed by an accountant; group totals use them.
  r.get(
    '/api/branches/rates',
    {
      ...signedIn(),
      schema: {
        tags,
        querystring: z.object({
          year: z
            .string()
            .regex(/^\d{4}$/)
            .optional(),
        }),
      },
    },
    async (q) => listRates(db, actorOf(q), q.query.year),
  );
  r.put(
    '/api/branches/rates',
    {
      ...signedIn(),
      schema: {
        tags,
        body: z.object({
          currency: z.string().regex(/^[A-Z]{3}$/, 'Three capital letters, like AED'),
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          rate: z.number().min(0).max(1_000_000),
        }),
      },
    },
    async (q) => saveRate(db, actorOf(q), q.body),
  );
}
