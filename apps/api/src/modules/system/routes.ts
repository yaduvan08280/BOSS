import type { ScopedDb } from '@mono/db';
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
      // Looking at some branches only (a manager's reach, or the top bar's switcher): the people cards and the
      // health check are about those branches (phase 12).
      const mine = request.reach?.branchIds ?? null;
      const here = mine ? { branchId: { in: mine } } : {};
      const active = { deletedAt: null, status: 'ACTIVE' as const, ...here };
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
        db.branch.count({ where: { deletedAt: null, ...(mine ? { id: { in: mine } } : {}) } }),
        db.designation.count({ where: { deletedAt: null } }),
        db.companyContact.count({ where: { deletedAt: null } }),
        db.role.count({ where: { deletedAt: null } }),
        db.user.count({ where: { deletedAt: null, ...here } }),
      ]);
      // Branches nobody manages (asked only once the company has more than one).
      const managed = await app.prisma.branchManager.findMany({
        where: { companyId: company.id, role: 'MANAGER', branchId: { not: null } },
        select: { branchId: true },
      });
      const live = await db.branch.findMany({
        where: { deletedAt: null, ...(mine ? { id: { in: mine } } : {}) },
        select: { id: true },
      });
      const allBranches = mine ? await db.branch.count({ where: { deletedAt: null } }) : live.length;
      const unmanaged = live.filter((b) => !managed.some((m) => m.branchId === b.id)).length;
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
        ...(allBranches > 1
          ? [{ key: 'branchesWithoutManager', ok: unmanaged === 0, count: unmanaged }]
          : []),
      ];
      const ready = checks.filter((c) => c.ok).length;
      const summary: SystemSummary = {
        company: { stepsDone: steps.filter(Boolean).length, stepsTotal: steps.length, people, departments },
        engine: { modules: 5 },
        processes: await processSummary(db),
        people: await loadSummary(db, people, here),
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

/** Processes card: live (published), being built (a draft with steps), not started (no steps yet). */
async function processSummary(db: ScopedDb) {
  const flows = await db.flow.findMany({
    where: { deletedAt: null, status: { not: 'ARCHIVED' } },
    select: { status: true, draft: true },
  });
  const steps = (f: (typeof flows)[number]) =>
    ((f.draft as { steps?: unknown[] } | null)?.steps ?? []).length;
  return {
    total: flows.length,
    live: flows.filter((f) => f.status === 'PUBLISHED').length,
    building: flows.filter((f) => f.status === 'DRAFT' && steps(f) > 0).length,
    notStarted: flows.filter((f) => f.status === 'DRAFT' && steps(f) === 0).length,
  };
}

/**
 * People view: open work per person (tasks, FMS steps, tickets to fix, checklists due today) —
 * heavy 10+, balanced 4–9, light 1–3, free 0 — and how many are doers in a live process.
 */
async function loadSummary(db: ScopedDb, total: number, here: { branchId?: { in: string[] } }) {
  const [people, tasks, steps, tickets, runs, versions] = await Promise.all([
    db.user.findMany({ where: { deletedAt: null, status: 'ACTIVE', ...here }, select: { id: true } }),
    db.task.groupBy({
      by: ['doerId'],
      where: { deletedAt: null, status: { in: ['OPEN', 'AWAITING_ACCEPTANCE'] } },
      _count: true,
    }),
    db.fmsRecordStep.groupBy({
      by: ['doerId'],
      where: { status: 'OPEN', record: { status: 'RUNNING' } },
      _count: true,
    }),
    db.ticket.groupBy({
      by: ['solverId'],
      where: { deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      _count: true,
    }),
    db.checklistRun.groupBy({
      by: ['doerId'],
      where: { status: 'OPEN', plannedAt: { lt: new Date(Date.now() + 86_400_000) } },
      _count: true,
    }),
    db.flowVersion.findMany({
      where: { flow: { status: 'PUBLISHED', deletedAt: null } },
      select: { flowId: true, version: true, definition: true },
      orderBy: { version: 'desc' },
    }),
  ]);
  const load = new Map<string, number>();
  const add = (id: string | null, n: number) => id && load.set(id, (load.get(id) ?? 0) + n);
  for (const x of tasks) add(x.doerId, x._count);
  for (const x of steps) add(x.doerId, x._count);
  for (const x of tickets) add(x.solverId, x._count);
  for (const x of runs) add(x.doerId, x._count);
  const latest = new Map<string, unknown>();
  for (const v of versions) if (!latest.has(v.flowId)) latest.set(v.flowId, v.definition);
  const doers = new Set(
    [...latest.values()].flatMap((d) =>
      ((d as { steps?: { doerIds?: string[] }[] }).steps ?? []).flatMap((s) => s.doerIds ?? []),
    ),
  );
  const n = (p: (x: number) => boolean) => people.filter((x) => p(load.get(x.id) ?? 0)).length;
  return {
    heavy: n((x) => x >= 10),
    balanced: n((x) => x >= 4 && x < 10),
    light: n((x) => x >= 1 && x < 4),
    free: n((x) => x === 0),
    inProcess: people.filter((x) => doers.has(x.id)).length,
    total,
  };
}
