import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma } from '@mono/db';
import {
  checklistMasterSchema,
  localDate,
  runActionSchema,
  runItemUpdateSchema,
  zonedToUtc,
  addDays,
} from '@mono/shared';
import { actorOf } from '../delegation/routes';
import { can } from '../work/actor';
import { sweepChecklists } from './jobs';
import {
  createMaster,
  deleteMaster,
  masterOut,
  runAction,
  runDetail,
  runWhere,
  tickItem,
  updateMaster,
} from './service';

const idParam = z.object({ id: z.string() });

/** Checklists (CLAUDE.md §5.2): masters, runs, ticking, verifying, master changes. */
export async function checklistRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('checklist.view')] };

  r.get('/api/checklists/masters', { ...view, schema: { tags: ['checklist'] } }, async (request) => {
    const rows = await request.db.checklistMaster.findMany({ orderBy: { code: 'asc' } });
    return rows.map(masterOut);
  });

  // After saving a master, create its due runs right away instead of waiting for the 5-minute sweep.
  r.post(
    '/api/checklists/masters',
    { ...view, schema: { tags: ['checklist'], body: checklistMasterSchema } },
    async (request) => {
      const m = await app.prisma.$transaction((tx) => createMaster(tx, actorOf(request), request.body));
      await sweepChecklists(app.prisma, new Date(), m.id);
      return m;
    },
  );

  r.patch(
    '/api/checklists/masters/:id',
    { ...view, schema: { tags: ['checklist'], params: idParam, body: checklistMasterSchema.partial() } },
    async (request) => {
      const m = await app.prisma.$transaction((tx) =>
        updateMaster(tx, actorOf(request), request.params.id, request.body),
      );
      await sweepChecklists(app.prisma, new Date(), m.id);
      return m;
    },
  );

  r.delete(
    '/api/checklists/masters/:id',
    { ...view, schema: { tags: ['checklist'], params: idParam } },
    async (request) => app.prisma.$transaction((tx) => deleteMaster(tx, actorOf(request), request.params.id)),
  );

  r.get('/api/checklists/master-changes', { ...view, schema: { tags: ['checklist'] } }, async (request) => {
    const rows = await request.db.auditLog.findMany({
      where: { entityType: 'checklist_master' },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const names = new Map(
      (
        await request.db.user.findMany({
          where: { id: { in: rows.map((x) => x.actorId).filter((x): x is string => Boolean(x)) } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    return rows.map((x) => ({ ...x, actorName: x.actorId ? (names.get(x.actorId) ?? '?') : null }));
  });

  r.get(
    '/api/checklists/runs',
    {
      ...view,
      schema: {
        tags: ['checklist'],
        querystring: z.object({
          scope: z.enum(['mine', 'all']).default('mine'),
          status: z.enum(['OPEN', 'PENDING_VERIFY', 'DONE', 'MISSED']).optional(),
          days: z.coerce.number().int().min(1).max(90).default(14),
        }),
      },
    },
    async (request) => {
      const actor = actorOf(request);
      const company = await app.prisma.company.findUniqueOrThrow({
        where: { id: actor.companyId },
        select: { timezone: true },
      });
      const since = zonedToUtc(
        addDays(localDate(new Date(), company.timezone), -request.query.days),
        0,
        company.timezone,
      );
      const where: Prisma.ChecklistRunWhereInput = {
        AND: [
          await runWhere(app.prisma, actor, request.query.scope),
          { OR: [{ plannedAt: { gte: since } }, { status: { in: ['OPEN', 'PENDING_VERIFY'] } }] },
          ...(request.query.status ? [{ status: request.query.status }] : []),
        ],
      };
      const runs = await app.prisma.checklistRun.findMany({
        where,
        orderBy: { plannedAt: 'desc' },
        take: 500,
        include: { master: { select: { name: true, code: true, departmentId: true } } },
      });
      // Tiles count today's work (company time zone).
      const today = localDate(new Date(), company.timezone);
      const dayStart = zonedToUtc(today, 0, company.timezone);
      const dayEnd = zonedToUtc(addDays(today, 1), 0, company.timezone);
      const now = new Date();
      const dueToday = runs.filter((x) => x.plannedAt >= dayStart && x.plannedAt < dayEnd);
      return {
        runs,
        tiles: {
          all: runs.filter((x) => x.status === 'OPEN' || x.status === 'PENDING_VERIFY').length,
          dueToday: dueToday.length,
          doneToday: dueToday.filter((x) => x.status === 'DONE' || x.status === 'PENDING_VERIFY').length,
          overdue: runs.filter((x) => x.status === 'OPEN' && x.plannedAt < now).length,
          toVerify: runs.filter((x) => x.status === 'PENDING_VERIFY' && x.verifierId === actor.userId).length,
          missed: runs.filter((x) => x.status === 'MISSED').length,
        },
        canManage: can(actor, 'checklist.edit'),
      };
    },
  );

  r.get(
    '/api/checklists/runs/:id',
    { ...view, schema: { tags: ['checklist'], params: idParam } },
    async (request) => runDetail(app.prisma, actorOf(request), request.params.id),
  );

  r.post(
    '/api/checklists/runs/:id/items',
    { ...view, schema: { tags: ['checklist'], params: idParam, body: runItemUpdateSchema } },
    async (request) => tickItem(app.prisma, actorOf(request), request.params.id, request.body),
  );

  r.post(
    '/api/checklists/runs/:id/actions',
    { ...view, schema: { tags: ['checklist'], params: idParam, body: runActionSchema } },
    async (request) => runAction(app.prisma, actorOf(request), request.params.id, request.body),
  );
}
