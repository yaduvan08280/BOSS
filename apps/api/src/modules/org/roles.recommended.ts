import type { FastifyInstance } from 'fastify';
import type { Tx } from '@mono/db';
import {
  RECOMMENDED_BUILT_IN,
  RECOMMENDED_PACK_ROLES,
  RECOMMENDED_WORK_ROLES,
  recommendedReach,
  type AccessPlan,
} from '@mono/shared';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';

type RoleChange = {
  id: string | null;
  name: string;
  isNew: boolean;
  people: number;
  reachFrom: string | null;
  reachTo: string;
  /** Modules this role stops seeing, and ones it starts seeing. */
  loses: string[];
  gains: string[];
  plan: AccessPlan | null;
};
type Move = { userId: string; name: string; department: string; from: string; to: string };

const modulesOf = (permissions: readonly string[]) => new Set(permissions.map((p) => p.split('.')[0]!));

/**
 * What "recommended access" would change (decision 234): built-in roles get MONO's rights and reach, the
 * company's own and pack roles keep their rights and see their branches, and a Member whose department says
 * what they do moves to the role of that work. Nothing is saved here.
 */
export async function accessPlan(tx: Tx) {
  const [roles, members] = await Promise.all([
    tx.role.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    }),
    tx.user.findMany({
      where: { deletedAt: null, role: { key: 'MEMBER' }, mainDepartmentId: { not: null } },
      select: { id: true, name: true, mainDepartment: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
  ]);
  const byName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const changes: RoleChange[] = [];
  for (const r of roles) {
    if (r.key === 'OWNER') continue;
    const work = RECOMMENDED_WORK_ROLES.find((w) => w.name.toLowerCase() === r.name.toLowerCase());
    const plan = r.key ? RECOMMENDED_BUILT_IN[r.key as keyof typeof RECOMMENDED_BUILT_IN] : work?.plan;
    const reachTo = plan?.reach ?? recommendedReach(r.permissions);
    const before = modulesOf(r.permissions);
    const after = plan ? modulesOf(plan.permissions) : before;
    const same =
      r.reach === reachTo &&
      (!plan || [...plan.permissions].sort().join() === [...r.permissions].sort().join());
    if (same) continue;
    changes.push({
      id: r.id,
      name: r.name,
      isNew: false,
      people: r._count.users,
      reachFrom: r.reach,
      reachTo,
      loses: [...before].filter((m) => !after.has(m)).sort(),
      gains: [...after].filter((m) => !before.has(m)).sort(),
      plan: plan ?? null,
    });
  }
  const moves: Move[] = [];
  for (const u of members) {
    const dept = u.mainDepartment?.name ?? '';
    const pack = RECOMMENDED_PACK_ROLES.find(
      (p) => p.departments.test(dept) && byName.has(p.name.toLowerCase()),
    );
    const work = RECOMMENDED_WORK_ROLES.find((w) => w.departments.test(dept));
    const to = pack?.name ?? work?.name;
    if (to) moves.push({ userId: u.id, name: u.name, department: dept, from: 'Member', to });
  }
  // A work role is made only when somebody moves into it.
  for (const w of RECOMMENDED_WORK_ROLES) {
    if (byName.has(w.name.toLowerCase()) || !moves.some((m) => m.to === w.name)) continue;
    changes.push({
      id: null,
      name: w.name,
      isNew: true,
      people: 0,
      reachFrom: null,
      reachTo: w.plan.reach,
      loses: [],
      gains: [...modulesOf(w.plan.permissions)].sort(),
      plan: w.plan,
    });
  }
  return { roles: changes, moves };
}

export async function recommendedRoleRoutes(app: FastifyInstance) {
  const admin = { onRequest: [app.requirePermission('core.admin')] };

  app.get('/api/org/roles/recommended', { ...admin, schema: { tags: ['org'] } }, async (request) => {
    const plan = await request.db.$transaction((tx) => accessPlan(tx as unknown as Tx));
    return { roles: plan.roles.map(({ plan: _plan, ...r }) => r), moves: plan.moves };
  });

  app.post('/api/org/roles/recommended', { ...admin, schema: { tags: ['org'] } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const plan = await accessPlan(tx);
      const idOf = new Map<string, string>();
      for (const r of await tx.role.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }))
        idOf.set(r.name.toLowerCase(), r.id);
      for (const c of plan.roles) {
        const data = {
          reach: c.reachTo,
          ...(c.plan ? { permissions: [...new Set(c.plan.permissions)].sort() } : {}),
        };
        if (c.id) {
          const before = await tx.role.findFirst({ where: { id: c.id } });
          const after = await tx.role.update({ where: { id: c.id }, data });
          await recordChange(tx, ctx, {
            event: 'role.updated',
            entityType: 'role',
            entityId: c.id,
            before,
            after,
          });
        } else {
          const row = await tx.role.create({
            data: {
              companyId: ctx.companyId,
              name: c.name,
              permissions: data.permissions ?? [],
              reach: c.reachTo,
            },
          });
          idOf.set(c.name.toLowerCase(), row.id);
          await recordChange(tx, ctx, {
            event: 'role.created',
            entityType: 'role',
            entityId: row.id,
            after: row,
          });
        }
      }
      for (const m of plan.moves) {
        const roleId = idOf.get(m.to.toLowerCase());
        if (!roleId) continue;
        await tx.user.update({ where: { id: m.userId }, data: { roleId } });
        await recordChange(tx, ctx, {
          event: 'user.updated',
          entityType: 'user',
          entityId: m.userId,
          before: { role: m.from },
          after: { role: m.to },
        });
      }
      return { roles: plan.roles.length, moved: plan.moves.length };
    }),
  );
}
