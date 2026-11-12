import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { reportDefinitionSchema, reportInputSchema } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { backfillState } from './backfill';
import {
  deleteReport,
  exportReport,
  getReport,
  listReports,
  previewReport,
  reportFields,
  reportSources,
  runSaved,
  saveReport,
} from './service';

const ownerRef = z.string().regex(/^(flow|recordType):[A-Za-z0-9_-]{1,40}$/);
const idParam = z.object({ id: z.string().max(40) });

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

  // ---- The builder
  r.get('/api/reports/sources', { ...signedIn(), schema: { tags } }, async (q) =>
    reportSources(db, actorOf(q)),
  );
  r.get(
    '/api/reports/fields',
    { ...signedIn(), schema: { tags, querystring: z.object({ source: ownerRef }) } },
    async (q) => {
      const [kind, id] = q.query.source.split(':') as ['flow' | 'recordType', string];
      return reportFields(db, actorOf(q), { kind, id });
    },
  );
  r.post(
    '/api/reports/run',
    {
      ...signedIn(),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags, body: z.object({ definition: reportDefinitionSchema }) },
    },
    async (q) => previewReport(db, actorOf(q), q.body.definition),
  );

  // ---- Saved reports
  r.get('/api/reports', { ...signedIn(), schema: { tags } }, async (q) => listReports(db, actorOf(q)));
  r.post('/api/reports', { ...signedIn(), schema: { tags, body: reportInputSchema } }, async (q) =>
    saveReport(db, actorOf(q), q.body),
  );
  r.get('/api/reports/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    getReport(db, actorOf(q), q.params.id),
  );
  r.put(
    '/api/reports/:id',
    { ...signedIn(), schema: { tags, params: idParam, body: reportInputSchema } },
    async (q) => saveReport(db, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/reports/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    deleteReport(db, actorOf(q), q.params.id),
  );
  r.get(
    '/api/reports/:id/run',
    {
      ...signedIn(),
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags, params: idParam },
    },
    async (q) => runSaved(db, actorOf(q), q.params.id),
  );
  r.get(
    '/api/reports/:id/export',
    {
      ...signedIn(),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: idParam,
        querystring: z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx') }),
      },
    },
    async (q, reply) => {
      const file = await exportReport(db, actorOf(q), q.params.id, q.query.format);
      reply.header('Content-Type', file.mime);
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'no-store');
      return reply.send(file.body);
    },
  );
}
