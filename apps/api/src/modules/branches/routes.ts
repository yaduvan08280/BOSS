import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  departmentHeadSchema,
  entitySchema,
  locationSchema,
  managersSchema,
  personBranchesSchema,
  regionSchema,
} from '@mono/shared';
import { actorOf } from '../delegation/routes';
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

  r.get('/api/branches/structure', { ...view(), schema: { tags } }, async (q) => structure(db, actorOf(q)));
  // The top bar's switcher: the branches this person may look at (before the switcher narrows anything).
  r.get('/api/branches/mine', { ...signedIn(), schema: { tags } }, async (q) => {
    const all = q.reachAll?.branchIds ?? null;
    return { branches: await myBranches(db, actorOf(q), all), wholeGroup: all === null };
  });

  r.post('/api/branches/entities', { ...view(), schema: { tags, body: entitySchema } }, async (q) =>
    saveEntity(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/entities/:id',
    { ...view(), schema: { tags, params: idParam, body: entitySchema } },
    async (q) => saveEntity(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/entities/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteEntity(db, actorOf(q), q.params.id),
  );

  r.post('/api/branches/regions', { ...view(), schema: { tags, body: regionSchema } }, async (q) =>
    saveRegion(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/regions/:id',
    { ...view(), schema: { tags, params: idParam, body: regionSchema } },
    async (q) => saveRegion(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/regions/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteRegion(db, actorOf(q), q.params.id),
  );

  r.post('/api/branches/locations', { ...view(), schema: { tags, body: locationSchema } }, async (q) =>
    saveLocation(db, actorOf(q), q.body),
  );
  r.patch(
    '/api/branches/locations/:id',
    { ...view(), schema: { tags, params: idParam, body: locationSchema } },
    async (q) => saveLocation(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/branches/locations/:id', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    deleteLocation(db, actorOf(q), q.params.id),
  );

  r.put('/api/branches/managers', { ...view(), schema: { tags, body: managersSchema } }, async (q) =>
    setManagers(db, actorOf(q), q.body),
  );
  r.put(
    '/api/branches/people/:id',
    { ...view(), schema: { tags, params: idParam, body: personBranchesSchema } },
    async (q) => setPersonBranches(db, actorOf(q), q.params.id, q.body),
  );
  r.put(
    '/api/branches/department-heads',
    { ...view(), schema: { tags, body: departmentHeadSchema } },
    async (q) => setDepartmentHead(db, actorOf(q), q.body),
  );
}
