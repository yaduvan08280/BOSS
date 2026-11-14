import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { leaveQuotasSchema, leaveRequestSchema, leaveTypeSchema, payMonthSchema } from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { assignCover, coverBoard } from './absence';
import { punch } from './attendance';
import { musterMonth } from './muster';
import { recalcMonth } from './recalc';
import { musterFile, musterPdf } from './muster-export';
import { balancesOf } from './balance';
import { answerBuddy, askAnotherBuddy } from './buddy';
import {
  decideCorrection,
  importPunches,
  listCorrections,
  myMonth,
  requestCorrection,
  teamDay,
} from './days';
import { applyLeave, cancelLeave, decideLeave, previewLeave } from './leave';
import { closePayRun, payrollMonth, reopenPayRun } from './payroll';
import {
  deleteHoliday,
  holidaySchema,
  leaveLists,
  listLeaveTypes,
  readCalendar,
  readHrRules,
  saveHoliday,
  saveHrRules,
  saveLeaveType,
  saveWeeklyOffs,
  weeklyOffSchema,
} from './setup';
import { listQuotas, listTerms, readPayRules, savePayRules, saveQuotas, saveTerms } from './terms';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idParam = z.object({ id: z.string() });

/** HR (CLAUDE.md §9): rules, calendar, punches and attendance, corrections, leave, Buddy and the cover board. */
export async function hrRoutes(app: FastifyInstance, opts: { appName?: string } = {}) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const tags = ['hr'];
  // A fresh hook list per route (decision 62).
  const view = () => ({ onRequest: [app.requirePermission('hr.view')] });
  const admin = () => ({ onRequest: [app.requirePermission('hr.admin')] });

  r.get('/api/hr/rules', { ...admin(), schema: { tags } }, async (q) =>
    readHrRules(app.prisma, q.auth!.companyId),
  );
  r.put(
    '/api/hr/rules',
    { ...admin(), schema: { tags, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveHrRules(app.prisma, actorOf(q), q.body),
  );

  r.get(
    '/api/hr/calendar',
    { ...view(), schema: { tags, querystring: z.object({ from: date, to: date }) } },
    async (q) => readCalendar(app.prisma, q.auth!.companyId, q.query.from, q.query.to),
  );
  r.post('/api/hr/holidays', { ...admin(), schema: { tags, body: holidaySchema } }, async (q) =>
    saveHoliday(app.prisma, actorOf(q), q.body),
  );
  r.put(
    '/api/hr/holidays/:id',
    { ...admin(), schema: { tags, params: idParam, body: holidaySchema } },
    async (q) => saveHoliday(app.prisma, actorOf(q), q.body, q.params.id),
  );
  r.delete('/api/hr/holidays/:id', { ...admin(), schema: { tags, params: idParam } }, async (q) =>
    deleteHoliday(app.prisma, actorOf(q), q.params.id),
  );
  r.put('/api/hr/weekly-offs', { ...admin(), schema: { tags, body: weeklyOffSchema } }, async (q) =>
    saveWeeklyOffs(app.prisma, actorOf(q), q.body),
  );

  r.post(
    '/api/hr/punch',
    {
      ...view(),
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags,
        body: z.object({
          type: z.enum(['IN', 'OUT']),
          lat: z.number().min(-90).max(90).nullish(),
          lng: z.number().min(-180).max(180).nullish(),
          accuracy: z.number().min(0).max(100_000).nullish(),
          selfieId: z.string().nullish(),
          deviceId: z.string().max(100).nullish(),
          at: z.iso.datetime({ offset: true }).nullish(),
        }),
      },
    },
    async (q) => punch(app.prisma, actorOf(q), q.body),
  );
  r.get(
    '/api/hr/attendance/month',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), userId: z.string().optional() }),
      },
    },
    async (q) => myMonth(app.prisma, actorOf(q), q.query.month, q.query.userId),
  );
  // The month for many people: the muster register and the daily punches behind it (screen and downloads).
  const musterQuery = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    departmentId: z.string().max(40).optional(),
    branchId: z.string().max(40).optional(),
  });
  // After a rule changes: the month's settled days worked out again (HR; not a month whose pay is closed).
  r.post(
    '/api/hr/attendance/recalculate',
    { ...view(), schema: { tags, body: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }) } },
    async (q) => recalcMonth(app.prisma, actorOf(q), q.body.month),
  );
  r.get('/api/hr/attendance/muster', { ...view(), schema: { tags, querystring: musterQuery } }, async (q) =>
    musterMonth(app.prisma, actorOf(q), q.query),
  );
  r.get(
    '/api/hr/attendance/muster/export',
    {
      ...view(),
      schema: {
        tags,
        querystring: musterQuery.extend({
          kind: z.enum(['muster', 'punches']).default('muster'),
          format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
        }),
      },
    },
    async (q, reply) => {
      const { kind, format, ...rest } = q.query;
      const data = await musterMonth(app.prisma, actorOf(q), rest);
      if (format === 'pdf') {
        const pdf = await musterPdf(data, opts.appName ?? 'MONO');
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="muster-${data.month}.pdf"`)
          .send(pdf);
      }
      const f = musterFile(data, kind, format);
      return reply
        .header('Content-Type', f.type)
        .header('Content-Disposition', `attachment; filename="${f.name}"`)
        .send(f.body);
    },
  );
  r.get(
    '/api/hr/attendance/team',
    { ...view(), schema: { tags, querystring: z.object({ date }) } },
    async (q) => teamDay(app.prisma, actorOf(q), q.query.date),
  );
  r.post(
    '/api/hr/attendance/import',
    { ...view(), schema: { tags, body: z.object({ csv: z.string().min(1).max(2_000_000) }) } },
    async (q) => importPunches(app.prisma, actorOf(q), q.body.csv),
  );
  r.get('/api/hr/corrections', { ...view(), schema: { tags } }, async (q) =>
    listCorrections(app.prisma, actorOf(q)),
  );
  r.post(
    '/api/hr/corrections',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({
          date,
          inAt: z.iso.datetime({ offset: true }).nullish(),
          outAt: z.iso.datetime({ offset: true }).nullish(),
          reason: z.string().trim().min(3, 'Say what happened').max(300),
        }),
      },
    },
    async (q) => requestCorrection(app.prisma, actorOf(q), q.body),
  );
  r.post(
    '/api/hr/corrections/:id/decide',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ approve: z.boolean(), note: z.string().max(300).nullish() }),
      },
    },
    async (q) =>
      decideCorrection(app.prisma, actorOf(q), q.params.id, q.body.approve, q.body.note ?? undefined),
  );

  r.get('/api/hr/leave/types', { ...view(), schema: { tags } }, async (q) =>
    listLeaveTypes(app.prisma, q.auth!.companyId),
  );
  r.post('/api/hr/leave/types', { ...admin(), schema: { tags, body: leaveTypeSchema } }, async (q) =>
    saveLeaveType(app.prisma, actorOf(q), q.body),
  );
  r.put(
    '/api/hr/leave/types/:id',
    { ...admin(), schema: { tags, params: idParam, body: leaveTypeSchema } },
    async (q) => saveLeaveType(app.prisma, actorOf(q), q.body, q.params.id),
  );
  r.get(
    '/api/hr/leave/balances',
    { ...view(), schema: { tags, querystring: z.object({ date }) } },
    async (q) => balancesOf(app.prisma, q.auth!.companyId, q.auth!.userId, q.query.date),
  );
  r.get(
    '/api/hr/leave/preview',
    {
      ...view(),
      schema: {
        tags,
        querystring: z.object({ from: date, to: date, half: z.enum(['FIRST', 'SECOND']).optional() }),
      },
    },
    async (q) => previewLeave(app.prisma, actorOf(q), q.query),
  );
  r.get('/api/hr/leave', { ...view(), schema: { tags } }, async (q) => leaveLists(app.prisma, actorOf(q)));
  r.post('/api/hr/leave', { ...view(), schema: { tags, body: leaveRequestSchema } }, async (q) =>
    applyLeave(app.prisma, actorOf(q), q.body),
  );
  r.post(
    '/api/hr/leave/:id/decide',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ approve: z.boolean(), note: z.string().max(500).nullish() }),
      },
    },
    async (q) => decideLeave(app.prisma, actorOf(q), q.params.id, q.body.approve, q.body.note),
  );
  r.post('/api/hr/leave/:id/cancel', { ...view(), schema: { tags, params: idParam } }, async (q) =>
    cancelLeave(app.prisma, actorOf(q), q.params.id),
  );
  r.post(
    '/api/hr/leave/:id/buddy',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ keys: z.array(z.string()).min(1).max(100), buddyId: z.string() }),
      },
    },
    async (q) => askAnotherBuddy(app.prisma, actorOf(q), q.params.id, q.body.keys, q.body.buddyId),
  );
  r.post(
    '/api/hr/buddy/:id/answer',
    {
      ...view(),
      schema: {
        tags,
        params: idParam,
        body: z.object({ accept: z.boolean(), note: z.string().max(300).nullish() }),
      },
    },
    async (q) => answerBuddy(app.prisma, actorOf(q), q.params.id, q.body.accept, q.body.note),
  );

  r.get('/api/hr/cover', { ...view(), schema: { tags, querystring: z.object({ date }) } }, async (q) =>
    coverBoard(app.prisma, actorOf(q), q.query.date),
  );
  r.post(
    '/api/hr/cover',
    {
      ...view(),
      schema: {
        tags,
        body: z.object({
          userId: z.string(),
          keys: z.array(z.string()).min(1).max(100),
          buddyId: z.string(),
          date,
        }),
      },
    },
    async (q) => assignCover(app.prisma, actorOf(q), { companyId: q.auth!.companyId, ...q.body }),
  );

  // Pay (HR only, checked in the services: hr.admin or the HR person).
  const monthParam = z.object({ month: payMonthSchema });
  r.get('/api/hr/terms', { ...view(), schema: { tags } }, async (q) => listTerms(app.prisma, actorOf(q)));
  r.put(
    '/api/hr/terms/:id',
    { ...view(), schema: { tags, params: idParam, body: z.record(z.string(), z.unknown()) } },
    async (q) => saveTerms(app.prisma, actorOf(q), q.params.id, q.body),
  );
  r.get('/api/hr/pay-rules', { ...view(), schema: { tags } }, async (q) =>
    readPayRules(app.prisma, actorOf(q)),
  );
  r.put(
    '/api/hr/pay-rules',
    { ...view(), schema: { tags, body: z.record(z.string(), z.unknown()) } },
    async (q) => savePayRules(app.prisma, actorOf(q), q.body),
  );
  r.get('/api/hr/leave-quotas', { ...view(), schema: { tags } }, async (q) =>
    listQuotas(app.prisma, actorOf(q)),
  );
  r.put(
    '/api/hr/leave-quotas/:id',
    { ...view(), schema: { tags, params: idParam, body: leaveQuotasSchema } },
    async (q) => saveQuotas(app.prisma, actorOf(q), q.params.id, q.body),
  );
  // Payroll for the whole company, or for one legal entity (?entityId=…) once the company has entities.
  const forEntity = z.object({ entityId: z.string().max(40).optional() });
  r.get(
    '/api/hr/payroll/:month',
    { ...view(), schema: { tags, params: monthParam, querystring: forEntity } },
    async (q) => payrollMonth(app.prisma, actorOf(q), q.params.month, new Date(), q.query.entityId),
  );
  r.post(
    '/api/hr/payroll/:month/close',
    { ...view(), schema: { tags, params: monthParam, querystring: forEntity } },
    async (q) => closePayRun(app.prisma, actorOf(q), q.params.month, new Date(), q.query.entityId),
  );
  r.post(
    '/api/hr/payroll/:month/reopen',
    {
      ...view(),
      schema: {
        tags,
        params: monthParam,
        querystring: forEntity,
        body: z.object({ reason: z.string().trim().min(3).max(300) }),
      },
    },
    async (q) =>
      reopenPayRun(app.prisma, actorOf(q), q.params.month, q.body.reason, new Date(), q.query.entityId),
  );
}
