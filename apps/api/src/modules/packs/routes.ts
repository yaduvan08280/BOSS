import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../delegation/routes';
import { exportPack, exportSchema } from './export';
import { installLibraryPack, installPack } from './install';
import { listPacks, removePack } from './manage';

/** Industry packs (phase 20): what is on offer, install / upgrade, export this company's set-up, remove. */
export async function packRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['packs'];
  const db = app.prisma;
  // A fresh hook list per route (decision 62); the services ask for the admin right.
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const key = z.object({ key: z.string().min(1).max(40) });

  r.get('/api/packs', { ...signedIn(), schema: { tags } }, async (q) => listPacks(db, actorOf(q)));
  r.post('/api/packs/library/:key', { ...signedIn(), schema: { tags, params: key } }, async (q) =>
    installLibraryPack(db, actorOf(q), q.params.key),
  );
  // A pack file from another company (or an older export of this one).
  r.post(
    '/api/packs/install',
    { ...signedIn(), bodyLimit: 8_000_000, schema: { tags, body: z.record(z.string(), z.unknown()) } },
    async (q) => installPack(db, actorOf(q), q.body),
  );
  r.post('/api/packs/export', { ...signedIn(), schema: { tags, body: exportSchema } }, async (q) =>
    exportPack(db, actorOf(q), q.body),
  );
  r.delete('/api/packs/:key', { ...signedIn(), schema: { tags, params: key } }, async (q) =>
    removePack(db, actorOf(q), q.params.key),
  );
}
