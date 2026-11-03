import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { flowMetaSchema, formatDateTime } from '@mono/shared';
import type { Env } from '../../env';
import { renderPdf } from '../../lib/pdf';
import { actorOf } from '../delegation/routes';
import {
  archiveFlow,
  createFlow,
  documentTypeSchema,
  duplicateFlow,
  getFlow,
  kpiCardSchema,
  listFlows,
  publishFlow,
  saveDocumentType,
  saveFlow,
  setKpiCards,
  setPublicForm,
} from './builder';
import { documentPdf } from './documents';
import { completeStep, startRecord } from './engine';
import { publicFormRoutes } from './public';
import { flowReport, kpiValues, LIVE_TABS, liveFms, myFms, recordDetail } from './queries';
import { reassignStep, recordAction } from './records';

const idParam = z.object({ id: z.string() });
const values = z.record(z.string(), z.unknown());

/** Processes / FMS (CLAUDE.md §6): builder, records, Live FMS, My steps, documents, KPI cards. */
export async function fmsRoutes(app: FastifyInstance, opts: { env: Env }) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('fms.view')] };
  const tags = ['fms'];

  // ---- Builder
  r.get('/api/fms/flows', { ...view, schema: { tags } }, async (q) => listFlows(app.prisma, actorOf(q)));
  r.post(
    '/api/fms/flows',
    {
      ...view,
      schema: { tags, body: z.object({ meta: flowMetaSchema, definition: z.unknown().optional() }) },
    },
    async (q) => createFlow(app.prisma, actorOf(q), q.body.meta, q.body.definition),
  );
  r.get('/api/fms/flows/:id', { ...view, schema: { tags, params: idParam } }, async (q) =>
    getFlow(app.prisma, actorOf(q), q.params.id),
  );
  r.put(
    '/api/fms/flows/:id',
    {
      ...view,
      schema: {
        tags,
        params: idParam,
        body: z.object({ meta: flowMetaSchema.partial().optional(), definition: z.unknown().optional() }),
      },
    },
    async (q) => saveFlow(app.prisma, actorOf(q), q.params.id, q.body),
  );
  r.post('/api/fms/flows/:id/publish', { ...view, schema: { tags, params: idParam } }, async (q) =>
    publishFlow(app.prisma, actorOf(q), q.params.id),
  );
  r.post('/api/fms/flows/:id/duplicate', { ...view, schema: { tags, params: idParam } }, async (q) =>
    duplicateFlow(app.prisma, actorOf(q), q.params.id),
  );
  r.post(
    '/api/fms/flows/:id/archive',
    { ...view, schema: { tags, params: idParam, body: z.object({ archive: z.boolean() }) } },
    async (q) => archiveFlow(app.prisma, actorOf(q), q.params.id, q.body.archive),
  );
  r.post(
    '/api/fms/flows/:id/public',
    { ...view, schema: { tags, params: idParam, body: z.object({ enabled: z.boolean() }) } },
    async (q) => setPublicForm(app.prisma, actorOf(q), q.params.id, q.body.enabled),
  );
  r.get('/api/fms/flows/:id/kpis', { ...view, schema: { tags, params: idParam } }, async (q) =>
    kpiValues(app.prisma, actorOf(q), q.params.id),
  );
  r.put(
    '/api/fms/flows/:id/kpis',
    { ...view, schema: { tags, params: idParam, body: z.array(kpiCardSchema).max(12) } },
    async (q) => setKpiCards(app.prisma, actorOf(q), q.params.id, q.body),
  );
  r.get(
    '/api/fms/flows/:id/report',
    {
      ...view,
      schema: {
        tags,
        params: idParam,
        querystring: z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }),
      },
    },
    async (q) => flowReport(app.prisma, actorOf(q), q.params.id, q.query.days),
  );

  // ---- Records
  r.get(
    '/api/fms/live',
    {
      ...view,
      schema: {
        tags,
        querystring: z.object({ flowId: z.string().optional(), tab: z.enum(LIVE_TABS).default('running') }),
      },
    },
    async (q) => liveFms(app.prisma, actorOf(q), q.query.flowId, q.query.tab),
  );
  r.get('/api/fms/my', { ...view, schema: { tags } }, async (q) => myFms(app.prisma, actorOf(q)));
  r.post(
    '/api/fms/flows/:id/records',
    {
      onRequest: [app.requirePermission('fms.create')],
      schema: {
        tags,
        params: idParam,
        body: z.object({ data: values, attachmentIds: z.array(z.string()).max(20).default([]) }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      return startRecord(app.prisma, {
        companyId: actor.companyId,
        flowId: q.params.id,
        data: q.body.data,
        startedById: actor.userId,
        source: 'web',
        attachmentIds: q.body.attachmentIds,
      });
    },
  );
  r.get('/api/fms/records/:id', { ...view, schema: { tags, params: idParam } }, async (q) =>
    recordDetail(app.prisma, actorOf(q), q.params.id),
  );
  r.post(
    '/api/fms/steps/:id/complete',
    {
      ...view,
      schema: {
        tags,
        params: idParam,
        body: z.object({
          data: values.default({}),
          checklistDone: z.array(z.string()).max(60).default([]),
          decision: z.enum(['yes', 'no', 'approved', 'rejected']).optional(),
          note: z.string().max(2000).optional(),
          attachmentIds: z.array(z.string()).max(20).default([]),
        }),
      },
    },
    async (q) => completeStep(app.prisma, actorOf(q), q.params.id, q.body),
  );
  r.post(
    '/api/fms/steps/:id/reassign',
    {
      ...view,
      schema: {
        tags,
        params: idParam,
        body: z.object({ doerId: z.string(), reason: z.string().max(500).optional() }),
      },
    },
    async (q) => reassignStep(app.prisma, actorOf(q), q.params.id, q.body.doerId, q.body.reason),
  );
  r.post(
    '/api/fms/records/:id/actions',
    {
      ...view,
      schema: {
        tags,
        params: idParam,
        body: z.object({
          action: z.enum(['hold', 'resume', 'close', 'cancel']),
          reason: z.string().max(500).optional(),
        }),
      },
    },
    async (q) => recordAction(app.prisma, actorOf(q), q.params.id, q.body.action, q.body.reason),
  );
  // "Step timeline PDF": every step, its doer, planned and actual time.
  r.get(
    '/api/fms/records/:id/timeline.pdf',
    { ...view, schema: { tags, params: idParam } },
    async (q, reply) => {
      const actor = actorOf(q);
      const rec = await recordDetail(app.prisma, actor, q.params.id);
      const tz = (
        await app.prisma.company.findUniqueOrThrow({
          where: { id: actor.companyId },
          select: { timezone: true },
        })
      ).timezone;
      const names = new Map(
        (
          await app.prisma.user.findMany({
            where: { companyId: actor.companyId },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name]),
      );
      const pdf = await renderPdf({
        pageSize: 'A4',
        content: [
          { text: `${rec.flow.name} · ${rec.title} (#${rec.number})`, fontSize: 14, bold: true },
          {
            text: `Started ${formatDateTime(rec.startedAt, tz)} · ${rec.status}`,
            color: '#666',
            margin: [0, 2, 0, 12],
          },
          {
            table: {
              headerRows: 1,
              widths: ['*', 90, 80, 80, 50],
              body: [
                ['Step', 'Doer', 'Planned', 'Done', 'On time'].map((h) => ({
                  text: h,
                  bold: true,
                  fillColor: '#f2efe7',
                })),
                ...rec.steps.map((s) => [
                  s.stepName,
                  s.doerId ? (names.get(s.doerId) ?? '') : 'System',
                  formatDateTime(s.plannedAt, tz),
                  s.doneAt
                    ? formatDateTime(s.doneAt, tz)
                    : s.status === 'OPEN'
                      ? 'open'
                      : s.status.toLowerCase(),
                  s.doneAt ? (s.doneAt <= s.plannedAt ? 'yes' : 'late') : '',
                ]),
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
      });
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="record-${rec.number}.pdf"`)
        .send(pdf);
    },
  );

  // ---- Documents
  r.get(
    '/api/documents',
    {
      onRequest: [app.requirePermission('docs.view')],
      schema: {
        tags,
        querystring: z.object({ typeId: z.string().optional(), q: z.string().max(80).optional() }),
      },
    },
    async (q) => {
      const actor = actorOf(q);
      const [types, docs] = await Promise.all([
        app.prisma.documentType.findMany({
          where: { companyId: actor.companyId, deletedAt: null },
          orderBy: { name: 'asc' },
        }),
        app.prisma.document.findMany({
          where: {
            companyId: actor.companyId,
            ...(q.query.typeId ? { typeId: q.query.typeId } : {}),
            ...(q.query.q
              ? {
                  OR: [
                    { number: { contains: q.query.q, mode: 'insensitive' } },
                    { party: { contains: q.query.q, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { date: 'desc' },
          take: 300,
        }),
      ]);
      const recordIds = docs.map((d) => d.recordId).filter((x): x is string => Boolean(x));
      const records = await app.prisma.fmsRecord.findMany({
        where: { id: { in: recordIds } },
        select: { id: true, number: true, flow: { select: { name: true } } },
      });
      const rec = new Map(records.map((x) => [x.id, x]));
      return {
        types,
        documents: docs.map((d) => ({
          ...d,
          total: d.total === null ? null : Number(d.total),
          record: d.recordId ? (rec.get(d.recordId) ?? null) : null,
        })),
      };
    },
  );
  r.put(
    '/api/document-types',
    { onRequest: [app.requirePermission('docs.view')], schema: { tags, body: documentTypeSchema } },
    async (q) => saveDocumentType(app.prisma, actorOf(q), q.body),
  );
  r.get(
    '/api/documents/:id/pdf',
    { onRequest: [app.requirePermission('docs.view')], schema: { tags, params: idParam } },
    async (q, reply) => {
      const { pdf, number } = await documentPdf(app.prisma, actorOf(q).companyId, q.params.id);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${number.replace(/\//g, '-')}.pdf"`)
        .send(pdf);
    },
  );
  r.post(
    '/api/documents/:id/cancel',
    { onRequest: [app.requirePermission('docs.edit')], schema: { tags, params: idParam } },
    async (q) => {
      const actor = actorOf(q);
      const res = await app.prisma.document.updateMany({
        where: { id: q.params.id, companyId: actor.companyId },
        data: { status: 'CANCELLED' },
      });
      return { ok: res.count === 1 };
    },
  );

  await app.register(publicFormRoutes, { env: opts.env });
}
