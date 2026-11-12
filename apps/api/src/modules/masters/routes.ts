import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { sourceColumns } from './columns';
import { fieldOptions } from './field-options';
import { masterOptions } from './options';
import { resolveLinks } from './resolve';
import { deleteRow, importRows, importSheet, library, listRows, saveRow, useLibrary } from './rows';

const idParam = z.object({ id: z.string() });

/** Masters (CLAUDE.md §8): the library, rows, import, and the options "from a master" fields offer. */
export async function masterRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['masters'];
  // A fresh hook list per route (decision 62). Reading needs a sign-in; changes need core.edit (checked inside).
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const db = app.prisma;

  r.get('/api/masters/library', { ...signedIn(), schema: { tags } }, async (q) => library(db, actorOf(q)));
  r.post(
    '/api/masters/library/:key',
    { ...signedIn(), schema: { tags, params: z.object({ key: z.string().max(40) }) } },
    async (q) => useLibrary(db, actorOf(q), q.params.key),
  );
  // Choices of a "from a master" field. A saved form sends its owner + field: what the field may show (source,
  // record filter, dependent choice) is then read from the field itself, and the browser can only narrow it.
  // `source` alone lists a whole source (the editor, pickers outside forms).
  r.get(
    '/api/masters/options',
    {
      ...signedIn(),
      schema: {
        tags,
        querystring: z.object({
          source: z.string().max(90).optional(),
          q: z.string().max(80).optional(),
          owner: z
            .string()
            .regex(/^(flow|master|recordType):[A-Za-z0-9_-]{1,40}$/)
            .optional(),
          field: z.string().max(40).optional(),
          step: z.string().max(40).optional(),
          record: z.string().max(40).optional(),
          parent: z.string().max(300).optional(),
          parentRef: z.string().max(60).optional(),
        }),
      },
    },
    async (q) => {
      const { source, owner, field, step, record, parent, parentRef } = q.query;
      if (owner && field) {
        const [kind, id] = owner.split(':') as ['flow' | 'master' | 'recordType', string];
        return fieldOptions(db, actorOf(q), { owner: { kind, id }, field, step, record }, q.query.q, {
          value: parent,
          ref: parentRef,
        });
      }
      if (!source)
        throw new AppError(400, 'VALIDATION_FAILED', 'Say which list (source, or owner and field)');
      return masterOptions(db, actorOf(q), source, q.query.q);
    },
  );
  // The columns a source's rows carry: what the editor offers for auto-fill and "depends on".
  r.get(
    '/api/masters/columns',
    { ...signedIn(), schema: { tags, querystring: z.object({ source: z.string().max(90) }) } },
    async (q) => sourceColumns(db, actorOf(q), q.query.source),
  );
  // Links kept on saved values → each one's current name and where it opens (a record's drawer asks in bulk).
  r.post(
    '/api/masters/links',
    { ...signedIn(), schema: { tags, body: z.object({ refs: z.array(z.string().max(60)).max(300) }) } },
    async (q) => resolveLinks(db, actorOf(q), q.body.refs),
  );
  r.get(
    '/api/masters/:id/rows',
    {
      ...signedIn(),
      schema: { tags, params: idParam, querystring: z.object({ q: z.string().max(80).optional() }) },
    },
    async (q) => listRows(db, actorOf(q), q.params.id, q.query.q),
  );
  r.post(
    '/api/masters/:id/rows',
    { ...signedIn(), schema: { tags, params: idParam, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveRow(db, actorOf(q), q.params.id, q.body),
  );
  r.put(
    '/api/masters/:id/rows/:rowId',
    {
      ...signedIn(),
      schema: {
        tags,
        params: z.object({ id: z.string(), rowId: z.string() }),
        body: z.record(z.string(), z.unknown()),
      },
    },
    async (q) => saveRow(db, actorOf(q), q.params.id, q.body, q.params.rowId),
  );
  r.delete(
    '/api/masters/:id/rows/:rowId',
    { ...signedIn(), schema: { tags, params: z.object({ id: z.string(), rowId: z.string() }) } },
    async (q) => deleteRow(db, actorOf(q), q.params.id, q.params.rowId),
  );
  r.post(
    '/api/masters/:id/import',
    {
      ...signedIn(),
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags,
        params: idParam,
        body: z.object({ table: z.array(z.array(z.string().max(2000)).max(80)).max(10_001) }),
      },
    },
    async (q) => importRows(db, actorOf(q), q.params.id, q.body.table),
  );
  r.post(
    '/api/masters/:id/import-sheet',
    {
      ...signedIn(),
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { tags, params: idParam, body: z.object({ url: z.string().url().max(500) }) },
    },
    async (q) => importSheet(db, actorOf(q), q.params.id, q.body.url),
  );
}
