import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '@mono/db';
import {
  departmentCreateSchema,
  departmentUpdateSchema,
  moveInDepartmentSchema,
  type OrgDepartment,
} from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';

const idParam = z.object({ id: z.string() });
const PALETTE = [
  '#E9A23B',
  '#2F5BD3',
  '#0F7B6C',
  '#B23A48',
  '#6E4BB8',
  '#5C8A2E',
  '#1695A3',
  '#D9822B',
  '#9C4F96',
  '#7A5C43',
];

export async function listDepartments(db: Tx): Promise<OrgDepartment[]> {
  const rows = await db.department.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: {
      mainMembers: {
        where: { deletedAt: null, status: { not: 'LEFT' } },
        select: { id: true, loginEnabled: true },
      },
      members: {
        where: { user: { deletedAt: null, status: { not: 'LEFT' } } },
        select: { user: { select: { id: true, loginEnabled: true } } },
      },
    },
  });
  return rows.map(({ mainMembers, members, ...d }) => {
    const people = new Map<string, boolean>();
    for (const u of mainMembers) people.set(u.id, u.loginEnabled);
    for (const m of members) people.set(m.user.id, m.user.loginEnabled);
    return {
      id: d.id,
      name: d.name,
      parentId: d.parentId,
      color: d.color,
      hodUserId: d.hodUserId,
      peopleCount: people.size,
      withLogin: [...people.values()].filter(Boolean).length,
    };
  });
}

/** Refuse a parent that is the department itself or one of its descendants. */
async function checkParent(tx: Tx, parentId: string | null | undefined, self?: string) {
  let cursor = parentId ?? null;
  for (let depth = 0; cursor && depth < 50; depth++) {
    if (cursor === self) throw new AppError(400, 'BAD_REQUEST', 'A department cannot sit under itself');
    const parent: { parentId: string | null } | null = await tx.department.findFirst({
      where: { id: cursor, deletedAt: null },
      select: { parentId: true },
    });
    if (!parent) throw notFound('Parent department');
    cursor = parent.parentId;
  }
}

async function activeUser(tx: Tx, id: string) {
  const user = await tx.user.findFirst({
    where: { id, deletedAt: null, status: { not: 'LEFT' } },
    select: { id: true, mainDepartmentId: true },
  });
  if (!user) throw notFound('Person');
  return user;
}

/** Make sure the person counts as a member (main department if they have none, else "also works in"). */
async function ensureMember(
  tx: Tx,
  companyId: string,
  user: { id: string; mainDepartmentId: string | null },
  departmentId: string,
) {
  if (user.mainDepartmentId === departmentId) return;
  if (!user.mainDepartmentId) {
    await tx.user.update({ where: { id: user.id }, data: { mainDepartmentId: departmentId } });
    return;
  }
  await tx.userDepartment.upsert({
    where: { userId_departmentId: { userId: user.id, departmentId } },
    create: { companyId, userId: user.id, departmentId },
    update: {},
  });
}

export async function departmentRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('org.view')] };
  const edit = { onRequest: [app.requirePermission('org.edit')] };

  r.get('/api/org/departments', { ...view, schema: { tags: ['org'] } }, async (request) =>
    listDepartments(request.db as unknown as Tx),
  );

  r.post(
    '/api/org/departments',
    {
      onRequest: [app.requirePermission('org.create')],
      schema: { tags: ['org'], body: departmentCreateSchema },
    },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        await checkParent(tx, request.body.parentId);
        const dup = await tx.department.findFirst({
          where: {
            deletedAt: null,
            parentId: request.body.parentId ?? null,
            name: { equals: request.body.name, mode: 'insensitive' },
          },
        });
        if (dup) throw new AppError(409, 'CONFLICT', `${dup.name} already exists here`);
        const count = await tx.department.count({ where: { companyId: ctx.companyId } });
        const row = await tx.department.create({
          data: {
            companyId: ctx.companyId,
            name: request.body.name,
            parentId: request.body.parentId ?? null,
            color: PALETTE[count % PALETTE.length],
            sortOrder: count,
          },
        });
        await recordChange(tx, ctx, {
          event: 'department.created',
          entityType: 'department',
          entityId: row.id,
          after: row,
        });
        return row;
      }),
  );

  r.patch(
    '/api/org/departments/:id',
    { ...edit, schema: { tags: ['org'], params: idParam, body: departmentUpdateSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.department.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Department');
        if (request.body.parentId !== undefined) await checkParent(tx, request.body.parentId, before.id);
        if (request.body.hodUserId)
          await ensureMember(tx, ctx.companyId, await activeUser(tx, request.body.hodUserId), before.id);
        const row = await tx.department.update({ where: { id: before.id }, data: request.body });
        await recordChange(tx, ctx, {
          event: 'department.updated',
          entityType: 'department',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/org/departments/:id',
    { ...edit, schema: { tags: ['org'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.department.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Department');
        if (await tx.department.count({ where: { parentId: before.id, deletedAt: null } })) {
          throw new AppError(409, 'CONFLICT', 'Delete or move its sub-departments first');
        }
        const people =
          (await tx.user.count({ where: { mainDepartmentId: before.id, deletedAt: null } })) +
          (await tx.userDepartment.count({ where: { departmentId: before.id, user: { deletedAt: null } } }));
        if (people) throw new AppError(409, 'CONFLICT', 'Move the people out of this department first');
        await tx.department.update({
          where: { id: before.id },
          data: { deletedAt: new Date(), hodUserId: null },
        });
        await recordChange(tx, ctx, {
          event: 'department.deleted',
          entityType: 'department',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  /** Org chart drag & drop: "Also add to IT", "Move to IT", or drop on the head slot to make HOD. */
  r.post(
    '/api/org/chart/move',
    { ...edit, schema: { tags: ['org'], body: moveInDepartmentSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const { userId, toDepartmentId, mode, fromDepartmentId } = request.body;
        const user = await activeUser(tx, userId);
        const to = await tx.department.findFirst({ where: { id: toDepartmentId, deletedAt: null } });
        if (!to) throw notFound('Department');
        const before = {
          mainDepartmentId: user.mainDepartmentId,
          alsoWorksIn: (await tx.userDepartment.findMany({ where: { userId } })).map((d) => d.departmentId),
        };

        if (mode === 'move' && fromDepartmentId && fromDepartmentId !== toDepartmentId) {
          if (user.mainDepartmentId === fromDepartmentId) {
            await tx.user.update({ where: { id: userId }, data: { mainDepartmentId: toDepartmentId } });
            await tx.userDepartment.deleteMany({ where: { userId, departmentId: toDepartmentId } });
          } else {
            await tx.userDepartment.deleteMany({ where: { userId, departmentId: fromDepartmentId } });
            await ensureMember(tx, ctx.companyId, user, toDepartmentId);
          }
          await tx.department.updateMany({
            where: { id: fromDepartmentId, hodUserId: userId },
            data: { hodUserId: null },
          });
        } else {
          await ensureMember(tx, ctx.companyId, user, toDepartmentId);
        }
        if (mode === 'hod')
          await tx.department.update({ where: { id: toDepartmentId }, data: { hodUserId: userId } });

        const after = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { mainDepartmentId: true, departments: { select: { departmentId: true } } },
        });
        await recordChange(tx, ctx, {
          event: mode === 'hod' ? 'department.updated' : 'user.updated',
          entityType: mode === 'hod' ? 'department' : 'user',
          entityId: mode === 'hod' ? toDepartmentId : userId,
          before,
          after: {
            mainDepartmentId: after.mainDepartmentId,
            alsoWorksIn: after.departments.map((d) => d.departmentId),
            ...(mode === 'hod' ? { hodUserId: userId } : {}),
          },
          payload: { mode, userId, toDepartmentId, fromDepartmentId },
        });
        return { ok: true };
      }),
  );
}
