import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  recordFilterSchema,
  recordTypeInputSchema,
  recordTypePatchSchema,
  recordViewInputSchema,
} from '@mono/shared';
import { AppError } from '../../lib/errors';
import { actorOf } from '../delegation/routes';
import { addFiles, addNote, recordDetail, removeFile } from './detail';
import { exportRecords, importRecords, IMPORT_MAX_ROWS } from './io';
import { deleteView, listRecords, listViews, saveView, type ListQuery } from './list';
import { changeStatus, createRecord, deleteRecord, updateRecord } from './records';
import {
  createType,
  deleteType,
  flowsToStart,
  listTypes,
  menuEntries,
  readType,
  setTypeStatus,
  updateType,
} from './types';

const idParam = z.object({ id: z.string().max(40) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recordBody = z.object({
  data: z.record(z.string(), z.unknown()),
  /** Child lines by table key; a table left out stays as it is. */
  lines: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(500)).optional(),
  /** The branch a new record belongs to (null = the whole group). Left out = the maker's own branch. */
  branchId: z.string().max(40).nullable().optional(),
});

/** The list's query string: lists are comma-separated, the field filters travel as JSON. */
const listQuery = z.object({
  q: z.string().max(80).optional(),
  status: z.string().max(900).optional(),
  from: day.optional(),
  to: day.optional(),
  filters: z.string().max(4000).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  columns: z.string().max(600).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
const list = (s?: string) =>
  s
    ?.split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function toListQuery(q: z.infer<typeof listQuery>): ListQuery {
  let filters: unknown = [];
  if (q.filters) {
    try {
      filters = JSON.parse(q.filters);
    } catch {
      throw new AppError(400, 'VALIDATION_FAILED', 'The filters could not be read');
    }
  }
  return {
    q: q.q,
    status: list(q.status),
    from: q.from,
    to: q.to,
    filters: z.array(recordFilterSchema).max(10).parse(filters),
    sort: q.sort,
    dir: q.dir,
    columns: list(q.columns),
    page: q.page,
    pageSize: q.pageSize,
  };
}

/**
 * Custom record types (plan §2.6). Every route needs a sign-in; what a person may do is decided per record type
 * inside the services (U6), so nothing here trusts the screen.
 */
export async function recordRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['records'];
  // A fresh hook list per route (decision 62).
  const signedIn = () => ({ onRequest: [app.authenticate] });
  const db = app.prisma;

  r.get('/api/records/menu', { ...signedIn(), schema: { tags } }, async (q) => menuEntries(db, actorOf(q)));

  // Published processes a move may start (type editor → Statuses & moves → "Start a process").
  r.get('/api/records/flows', { ...signedIn(), schema: { tags } }, async (q) => flowsToStart(db, actorOf(q)));

  // ---- Record types
  r.get('/api/records/types', { ...signedIn(), schema: { tags } }, async (q) => listTypes(db, actorOf(q)));
  r.post('/api/records/types', { ...signedIn(), schema: { tags, body: recordTypeInputSchema } }, async (q) =>
    createType(db, actorOf(q), q.body),
  );
  r.get('/api/records/types/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    readType(db, actorOf(q), q.params.id),
  );
  r.patch(
    '/api/records/types/:id',
    { ...signedIn(), schema: { tags, params: idParam, body: recordTypePatchSchema } },
    async (q) => updateType(db, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/records/types/:id/archive', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    setTypeStatus(db, actorOf(q), q.params.id, 'archive'),
  );
  r.post('/api/records/types/:id/restore', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    setTypeStatus(db, actorOf(q), q.params.id, 'restore'),
  );
  r.delete('/api/records/types/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    deleteType(db, actorOf(q), q.params.id),
  );

  // ---- A type's list, export, import and saved views
  r.get(
    '/api/records/types/:id/records',
    { ...signedIn(), schema: { tags, params: idParam, querystring: listQuery } },
    async (q) => listRecords(db, actorOf(q), q.params.id, toListQuery(q.query)),
  );
  r.get(
    '/api/records/types/:id/export',
    {
      ...signedIn(),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        params: idParam,
        querystring: listQuery.extend({
          format: z.enum(['csv', 'xlsx']).default('csv'),
          all: z.enum(['0', '1']).optional(),
        }),
      },
    },
    async (q, reply) => {
      const file = await exportRecords(db, actorOf(q), q.params.id, {
        ...toListQuery(q.query),
        format: q.query.format,
        all: q.query.all === '1',
      });
      reply.header('Content-Type', file.mime);
      reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header('Cache-Control', 'no-store');
      return reply.send(file.body);
    },
  );
  r.post(
    '/api/records/types/:id/import',
    {
      ...signedIn(),
      bodyLimit: 8 * 1024 * 1024,
      schema: {
        tags,
        params: idParam,
        body: z.object({ table: z.array(z.array(z.string().max(2000)).max(80)).max(IMPORT_MAX_ROWS + 500) }),
      },
    },
    async (q) => importRecords(db, actorOf(q), q.params.id, q.body.table),
  );
  r.post(
    '/api/records/types/:id/records',
    { ...signedIn(), schema: { tags, params: idParam, body: recordBody } },
    async (q) => createRecord(db, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/records/types/:id/views', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    listViews(db, actorOf(q), q.params.id),
  );
  r.post(
    '/api/records/types/:id/views',
    { ...signedIn(), schema: { tags, params: idParam, body: recordViewInputSchema } },
    async (q) => saveView(db, actorOf(q), q.params.id, q.body),
  );
  const viewParams = z.object({ id: z.string().max(40), viewId: z.string().max(40) });
  r.put(
    '/api/records/types/:id/views/:viewId',
    { ...signedIn(), schema: { tags, params: viewParams, body: recordViewInputSchema } },
    async (q) => saveView(db, actorOf(q), q.params.id, q.body, q.params.viewId),
  );
  r.delete(
    '/api/records/types/:id/views/:viewId',
    { ...signedIn(), schema: { tags, params: viewParams } },
    async (q) => deleteView(db, actorOf(q), q.params.id, q.params.viewId),
  );

  // ---- One record
  r.get('/api/records/entries/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    recordDetail(db, actorOf(q), q.params.id),
  );
  r.patch(
    '/api/records/entries/:id',
    { ...signedIn(), schema: { tags, params: idParam, body: recordBody } },
    async (q) => updateRecord(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/records/entries/:id/move',
    {
      ...signedIn(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ action: z.string().max(40), note: z.string().max(2000).nullish() }),
      },
    },
    async (q) => changeStatus(db, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/records/entries/:id/notes',
    { ...signedIn(), schema: { tags, params: idParam, body: z.object({ note: z.string().max(2000) }) } },
    async (q) => addNote(db, actorOf(q), q.params.id, q.body.note),
  );
  r.post(
    '/api/records/entries/:id/files',
    {
      ...signedIn(),
      schema: { tags, params: idParam, body: z.object({ ids: z.array(z.string().max(40)).min(1).max(20) }) },
    },
    async (q) => addFiles(db, actorOf(q), q.params.id, q.body.ids),
  );
  r.delete(
    '/api/records/entries/:id/files/:fileId',
    {
      ...signedIn(),
      schema: { tags, params: z.object({ id: z.string().max(40), fileId: z.string().max(40) }) },
    },
    async (q) => removeFile(db, actorOf(q), q.params.id, q.params.fileId),
  );
  r.delete('/api/records/entries/:id', { ...signedIn(), schema: { tags, params: idParam } }, async (q) =>
    deleteRecord(db, actorOf(q), q.params.id),
  );
}
