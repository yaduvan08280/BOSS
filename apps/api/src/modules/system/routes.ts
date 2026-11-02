import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { SystemSummary } from '@mono/shared';

/** System Master header cards, health check and tab badges, computed live. */
export async function systemRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/api/system/summary',
    { onRequest: [app.requirePermission('core.admin')], schema: { tags: ['system'] } },
    async (request) => {
      const db = request.db;
      const company = await app.prisma.company.findUniqueOrThrow({ where: { id: request.auth!.companyId } });
      const active = { deletedAt: null, status: 'ACTIVE' as const };
      const [
        people,
        departments,
        withLogin,
        telegram,
        withDept,
        withDesig,
        noHod,
        shifts,
        branches,
        designations,
        contacts,
        roles,
        users,
      ] = await Promise.all([
        db.user.count({ where: active }),
        db.department.count({ where: { deletedAt: null } }),
        db.user.count({ where: { ...active, loginEnabled: true } }),
        db.user.count({ where: { ...active, telegramChatId: { not: null } } }),
        db.user.count({
          where: { ...active, OR: [{ mainDepartmentId: { not: null } }, { departments: { some: {} } }] },
        }),
        db.user.count({ where: { ...active, designationId: { not: null } } }),
        db.department.count({ where: { deletedAt: null, parentId: null, hodUserId: null } }),
        db.shift.count({ where: { deletedAt: null } }),
        db.branch.count({ where: { deletedAt: null } }),
        db.designation.count({ where: { deletedAt: null } }),
        db.companyContact.count({ where: { deletedAt: null } }),
        db.role.count({ where: { deletedAt: null } }),
        db.user.count({ where: { deletedAt: null } }),
      ]);
      const profileDone = Boolean(
        company.name && company.city && company.state && company.ownerName && company.mobile,
      );
      const steps = [profileDone, shifts > 0, branches > 0, designations > 0, departments > 0];

      const checks = [
        { key: 'profile', ok: profileDone, count: profileDone ? 0 : 1 },
        { key: 'departmentsWithoutHod', ok: departments > 0 && noHod === 0, count: noHod },
        { key: 'peopleWithoutDepartment', ok: people > 0 && withDept === people, count: people - withDept },
        { key: 'peopleWithoutLogin', ok: people > 0 && withLogin === people, count: people - withLogin },
        {
          key: 'peopleWithoutDesignation',
          ok: people > 0 && withDesig === people,
          count: people - withDesig,
        },
        { key: 'noBranch', ok: branches > 0, count: branches > 0 ? 0 : 1 },
        { key: 'noShift', ok: shifts > 0, count: shifts > 0 ? 0 : 1 },
        { key: 'telegramNotLinked', ok: people > 0 && telegram === people, count: people - telegram },
      ];
      const ready = checks.filter((c) => c.ok).length;
      const summary: SystemSummary = {
        company: { stepsDone: steps.filter(Boolean).length, stepsTotal: steps.length, people, departments },
        engine: { modules: 5 },
        // Processes and work load arrive with phases 3–5.
        processes: { total: 0, live: 0, building: 0, notStarted: 0 },
        people: { heavy: 0, balanced: 0, light: 0, free: people, inProcess: 0, total: people },
        health: {
          percent: Math.round((ready / checks.length) * 100),
          ready,
          checks: checks.length,
          gaps: checks.filter((c) => !c.ok).map(({ key, count }) => ({ key, count })),
        },
        counts: { departments, users, roles, designations, shifts, branches, contacts },
      };
      return summary;
    },
  );

  /** People and departments for the Ctrl+K search. Screens are searched in the browser. */
  r.get(
    '/api/search',
    {
      onRequest: [app.requirePermission('org.view')],
      schema: { tags: ['system'], querystring: z.object({ q: z.string().trim().min(1).max(80) }) },
    },
    async (request) => {
      const q = request.query.q;
      const contains = { contains: q, mode: 'insensitive' as const };
      const digits = q.replace(/\D/g, '');
      const [people, departments] = await Promise.all([
        request.db.user.findMany({
          where: {
            deletedAt: null,
            OR: [
              { name: contains },
              { code: contains },
              { email: contains },
              ...(digits.length >= 4 ? [{ mobile: { contains: digits } }] : []),
            ],
          },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            designation: { select: { name: true } },
            mainDepartment: { select: { name: true } },
          },
          take: 8,
          orderBy: { name: 'asc' },
        }),
        request.db.department.findMany({
          where: { deletedAt: null, name: contains },
          select: { id: true, name: true },
          take: 5,
        }),
      ]);
      return {
        people: people.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          status: p.status,
          designation: p.designation?.name ?? null,
          department: p.mainDepartment?.name ?? null,
        })),
        departments,
      };
    },
  );
}
