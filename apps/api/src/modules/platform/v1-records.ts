import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { plainValues, refsOf } from '@mono/shared';
import { notFound } from '../../lib/errors';
import { recordDetail } from '../records/detail';
import { scopeOf } from '../records/list';
import { queryRecords } from '../records/query';
import { changeStatus, createRecord, updateRecord } from '../records/records';
import { listTypes } from '../records/types';
import { loadType } from '../records/access';
import type { Actor } from '../work/actor';

const idParam = z.object({ id: z.string().max(60) });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const recordBody = z.object({
  data: z.record(z.string(), z.unknown()),
  /** Child lines by table key; a table left out stays as it is. */
  lines: z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(500)).optional(),
});

type Kit = {
  /** A fresh hook list and rate limit per route (decision 62). */
  keyed: () => {
    onRequest: ((q: FastifyRequest) => Promise<void>)[];
    config: { rateLimit: { max: number; timeWindow: string; keyGenerator: (q: FastifyRequest) => string } };
  };
  doc: <S extends object = object>(
    summary: string,
    extra?: S,
  ) => { tags: string[]; security: { apiKey: never[] }[]; summary: string } & S;
  actor: (q: FastifyRequest) => Actor;
};

/**
 * Custom record types in the public API (plan §2.6, row U7). The same services as the screens run underneath, so
 * a key reads and changes exactly what its maker may: the type's own view / create / edit / approve rights, the
 * shared `transition()` for moves, audit rows and `record.*` events (which webhooks carry).
 * A type is named by its id or by its short code (`site_visit`).
 */
export function v1RecordRoutes(app: FastifyInstance, { keyed, doc, actor }: Kit) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = app.prisma;

  /** The type's id from an id or a code, inside the key's company. */
  const typeId = async (a: Actor, idOrCode: string) => {
    const t = await db.recordType.findFirst({
      where: { companyId: a.companyId, deletedAt: null, OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: { id: true },
    });
    if (!t) throw notFound('Record type');
    return t.id;
  };

  r.get(
    '/api/v1/record-types',
    { ...keyed(), schema: doc('Your record types, with their fields and moves') },
    async (q) => {
      const { types } = await listTypes(db, actor(q));
      return types.map((t) => ({
        id: t.id,
        code: t.code,
        name: t.name,
        pluralName: t.pluralName,
        prefix: t.prefix,
        status: t.status,
        records: t.records,
        fields: t.definition.fields,
        tables: t.definition.tables,
        statuses: t.definition.statuses,
        start: t.definition.start,
        moves: t.definition.moves.map((m) => ({ from: m.from, action: m.action, label: m.label, to: m.to })),
      }));
    },
  );

  r.get(
    '/api/v1/record-types/:id/records',
    {
      ...keyed(),
      schema: doc('Records of a type (newest first)', {
        params: idParam,
        querystring: z.object({
          q: z.string().max(80).optional(),
          status: z.string().max(400).optional().describe('Status keys, comma-separated'),
          from: day.optional(),
          to: day.optional(),
          page: z.coerce.number().int().min(1).max(100_000).optional(),
          pageSize: z.coerce.number().int().min(1).max(200).optional(),
        }),
      }),
    },
    async (q) => {
      const a = actor(q);
      const t = await loadType(db, a, await typeId(a, q.params.id), 'view');
      const pageSize = q.query.pageSize ?? 50;
      const page = q.query.page ?? 1;
      const status = q.query.status
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const { rows, total } = await queryRecords(
        db,
        await scopeOf(db, a, t),
        t.def,
        { q: q.query.q, status: status?.length ? status : undefined, from: q.query.from, to: q.query.to },
        { skip: (page - 1) * pageSize, take: pageSize },
      );
      return {
        total,
        page,
        pageSize,
        records: rows.map((x) => ({
          id: x.id,
          code: x.code,
          title: x.title,
          status: x.status,
          createdAt: x.createdAt,
          updatedAt: x.updatedAt,
          createdBy: x.createdBy,
          data: plainValues(x.data),
          links: refsOf(x.data),
        })),
      };
    },
  );

  r.post(
    '/api/v1/record-types/:id/records',
    {
      ...keyed(),
      schema: doc('Add a record (links go under data._refs)', { params: idParam, body: recordBody }),
    },
    async (q) => {
      const a = actor(q);
      return createRecord(db, a, await typeId(a, q.params.id), q.body);
    },
  );

  r.get(
    '/api/v1/entries/:id',
    {
      ...keyed(),
      schema: doc('One record: values, lines, the moves this key may make, history', { params: idParam }),
    },
    async (q) => {
      const d = await recordDetail(db, actor(q), q.params.id);
      return {
        type: { id: d.type.id, code: d.type.code, name: d.type.name },
        record: { ...d.record, data: plainValues(d.record.data), links: refsOf(d.record.data) },
        moves: d.moves,
        events: d.events,
      };
    },
  );

  r.patch(
    '/api/v1/entries/:id',
    {
      ...keyed(),
      schema: doc("Change a record's values (send every field; lines are optional)", {
        params: idParam,
        body: recordBody,
      }),
    },
    async (q) => updateRecord(db, actor(q), q.params.id, q.body),
  );

  r.post(
    '/api/v1/entries/:id/move',
    {
      ...keyed(),
      schema: doc("Make a move (change the record's status)", {
        params: idParam,
        body: z.object({ action: z.string().max(40), note: z.string().max(2000).nullish() }),
      }),
    },
    async (q) => changeStatus(db, actor(q), q.params.id, q.body),
  );
}
