import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ACTIONS, MODULES, roleSchema } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';

const idParam = z.object({ id: z.string() });
const VALID = new Set(['*', ...MODULES.flatMap((m) => ACTIONS.map((a) => `${m}.${a}`))]);

function cleanPermissions(list: string[]) {
  const bad = list.filter((p) => !VALID.has(p));
  if (bad.length) throw new AppError(400, 'VALIDATION_FAILED', `Unknown permissions: ${bad.join(', ')}`);
  return [...new Set(list)].sort();
}

export async function roleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('org.view')] };
  const admin = { onRequest: [app.requirePermission('core.admin')] };

  r.get('/api/org/roles', { ...view, schema: { tags: ['org'] } }, async (request) => {
    const rows = await request.db.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return {
      roles: rows.map(({ _count, ...role }) => ({
        ...role,
        people: _count.users,
        builtIn: role.key !== null,
      })),
      modules: MODULES,
      actions: ACTIONS,
    };
  });

  r.post('/api/org/roles', { ...admin, schema: { tags: ['org'], body: roleSchema } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      if (
        await tx.role.findFirst({
          where: { name: { equals: request.body.name, mode: 'insensitive' }, deletedAt: null },
        })
      ) {
        throw new AppError(409, 'CONFLICT', 'A role with this name already exists');
      }
      const row = await tx.role.create({
        data: {
          companyId: ctx.companyId,
          name: request.body.name,
          permissions: cleanPermissions(request.body.permissions),
        },
      });
      await recordChange(tx, ctx, {
        event: 'role.created',
        entityType: 'role',
        entityId: row.id,
        after: row,
      });
      return row;
    }),
  );

  r.patch(
    '/api/org/roles/:id',
    { ...admin, schema: { tags: ['org'], params: idParam, body: roleSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.role.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Role');
        if (before.key === 'OWNER')
          throw new AppError(409, 'CONFLICT', 'The Owner role always has every permission');
        if (before.key && request.body.name && request.body.name !== before.name) {
          throw new AppError(409, 'CONFLICT', 'Built-in roles keep their name');
        }
        const row = await tx.role.update({
          where: { id: before.id },
          data: {
            ...(request.body.name ? { name: request.body.name } : {}),
            ...(request.body.permissions ? { permissions: cleanPermissions(request.body.permissions) } : {}),
          },
        });
        await recordChange(tx, ctx, {
          event: 'role.updated',
          entityType: 'role',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete('/api/org/roles/:id', { ...admin, schema: { tags: ['org'], params: idParam } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const before = await tx.role.findFirst({ where: { id: request.params.id, deletedAt: null } });
      if (!before) throw notFound('Role');
      if (before.key) throw new AppError(409, 'CONFLICT', "Built-in roles can't be deleted");
      if (await tx.user.count({ where: { roleId: before.id, deletedAt: null } })) {
        throw new AppError(409, 'CONFLICT', 'Give these people another role first');
      }
      await tx.role.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
      await recordChange(tx, ctx, { event: 'role.deleted', entityType: 'role', entityId: before.id, before });
      return { ok: true };
    }),
  );
}
