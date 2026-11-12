import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { branchSchema, designationSchema, hhmmToMinutes, minutesToHHmm, shiftSchema } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { inCompanyTx } from '../../lib/tx';

const idParam = z.object({ id: z.string() });
const inUse = (what: string) => new AppError(409, 'CONFLICT', `This ${what} is still in use`);

/** Company Setup sub-tabs: shifts & timings, branches, designations. */
export async function setupRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('org.view')] };
  const edit = { onRequest: [app.requirePermission('org.edit')] };

  // ---- Shifts ----
  const shiftOut = (s: { startMin: number; endMin: number } & Record<string, unknown>) => ({
    ...s,
    start: minutesToHHmm(s.startMin),
    end: minutesToHHmm(s.endMin),
    overnight: s.endMin <= s.startMin,
  });

  r.get('/api/org/shifts', { ...view, schema: { tags: ['org'] } }, async (request) => {
    const rows = await request.db.shift.findMany({
      orderBy: [{ isDefault: 'desc' }, { startMin: 'asc' }],
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return rows.map((s) => shiftOut({ ...s, people: s._count.users }));
  });

  r.post('/api/org/shifts', { ...edit, schema: { tags: ['org'], body: shiftSchema } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const { start, end, isDefault, ...rest } = request.body;
      const first = (await tx.shift.count({ where: { companyId: ctx.companyId } })) === 0;
      if (isDefault)
        await tx.shift.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
      const row = await tx.shift.create({
        data: {
          ...rest,
          companyId: ctx.companyId,
          startMin: hhmmToMinutes(start),
          endMin: hhmmToMinutes(end),
          isDefault: Boolean(isDefault) || first,
        },
      });
      await recordChange(tx, ctx, {
        event: 'shift.created',
        entityType: 'shift',
        entityId: row.id,
        after: row,
      });
      return shiftOut(row);
    }),
  );

  r.patch(
    '/api/org/shifts/:id',
    { ...edit, schema: { tags: ['org'], params: idParam, body: shiftSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.shift.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Shift');
        const { start, end, isDefault, ...rest } = request.body;
        if (isDefault)
          await tx.shift.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
        const row = await tx.shift.update({
          where: { id: before.id },
          data: {
            ...rest,
            ...(start ? { startMin: hhmmToMinutes(start) } : {}),
            ...(end ? { endMin: hhmmToMinutes(end) } : {}),
            ...(isDefault ? { isDefault: true } : {}),
          },
        });
        await recordChange(tx, ctx, {
          event: 'shift.updated',
          entityType: 'shift',
          entityId: row.id,
          before,
          after: row,
        });
        return shiftOut(row);
      }),
  );

  r.delete('/api/org/shifts/:id', { ...edit, schema: { tags: ['org'], params: idParam } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const before = await tx.shift.findFirst({ where: { id: request.params.id, deletedAt: null } });
      if (!before) throw notFound('Shift');
      if (before.isDefault) throw new AppError(409, 'CONFLICT', 'Make another shift the default first');
      if (await tx.user.count({ where: { shiftId: before.id, deletedAt: null } })) throw inUse('shift');
      await tx.shift.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
      await recordChange(tx, ctx, {
        event: 'shift.deleted',
        entityType: 'shift',
        entityId: before.id,
        before,
      });
      return { ok: true };
    }),
  );

  // ---- Branches ----
  r.get('/api/org/branches', { ...view, schema: { tags: ['org'] } }, async (request) => {
    const rows = await request.db.branch.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return rows.map(({ _count, ...b }) => ({ ...b, people: _count.users }));
  });

  async function checkParent(
    tx: Parameters<Parameters<typeof inCompanyTx>[1]>[0],
    id: string | null | undefined,
    self?: string,
  ) {
    if (!id) return;
    let cursor: string | null = id;
    for (let depth = 0; cursor && depth < 50; depth++) {
      if (cursor === self) throw new AppError(400, 'BAD_REQUEST', 'A branch cannot sit under itself');
      const parent: { parentId: string | null } | null = await tx.branch.findFirst({
        where: { id: cursor, deletedAt: null },
        select: { parentId: true },
      });
      if (!parent) throw notFound('Parent branch');
      cursor = parent.parentId;
    }
  }

  /** The entity and region a branch names must be this company's (the scoped client only finds its own). */
  async function checkPlace(
    tx: Parameters<Parameters<typeof inCompanyTx>[1]>[0],
    body: { entityId?: string | null; regionId?: string | null },
  ) {
    if (body.entityId && !(await tx.legalEntity.count({ where: { id: body.entityId, deletedAt: null } })))
      throw notFound('Legal entity');
    if (body.regionId && !(await tx.region.count({ where: { id: body.regionId, deletedAt: null } })))
      throw notFound('Region');
  }

  r.post('/api/org/branches', { ...edit, schema: { tags: ['org'], body: branchSchema } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      await checkParent(tx, request.body.parentId);
      await checkPlace(tx, request.body);
      const first = (await tx.branch.count({ where: { companyId: ctx.companyId, deletedAt: null } })) === 0;
      if (request.body.isDefault)
        await tx.branch.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
      const row = await tx.branch.create({
        data: {
          ...request.body,
          companyId: ctx.companyId,
          isDefault: Boolean(request.body.isDefault) || first,
        },
      });
      await recordChange(tx, ctx, {
        event: 'branch.created',
        entityType: 'branch',
        entityId: row.id,
        after: row,
      });
      return row;
    }),
  );

  r.patch(
    '/api/org/branches/:id',
    { ...edit, schema: { tags: ['org'], params: idParam, body: branchSchema.partial() } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.branch.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Branch');
        await checkParent(tx, request.body.parentId, before.id);
        await checkPlace(tx, request.body);
        if (request.body.isDefault)
          await tx.branch.updateMany({ where: { companyId: ctx.companyId }, data: { isDefault: false } });
        const row = await tx.branch.update({ where: { id: before.id }, data: request.body });
        await recordChange(tx, ctx, {
          event: 'branch.updated',
          entityType: 'branch',
          entityId: row.id,
          before,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/org/branches/:id',
    { ...edit, schema: { tags: ['org'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.branch.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Branch');
        if (await tx.branch.count({ where: { parentId: before.id, deletedAt: null } }))
          throw new AppError(409, 'CONFLICT', 'Move or delete the branches under it first');
        if (await tx.user.count({ where: { branchId: before.id, deletedAt: null } })) throw inUse('branch');
        await tx.branch.update({
          where: { id: before.id },
          data: { deletedAt: new Date(), isDefault: false },
        });
        await recordChange(tx, ctx, {
          event: 'branch.deleted',
          entityType: 'branch',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );

  // ---- Designations ----
  r.get('/api/org/designations', { ...view, schema: { tags: ['org'] } }, async (request) => {
    const rows = await request.db.designation.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: { where: { deletedAt: null } } } } },
    });
    return rows.map(({ _count, ...d }) => ({ ...d, people: _count.users }));
  });

  r.post(
    '/api/org/designations',
    { ...edit, schema: { tags: ['org'], body: designationSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const existing = await tx.designation.findFirst({
          where: { name: { equals: request.body.name, mode: 'insensitive' } },
          select: { id: true, deletedAt: true },
        });
        if (existing && !existing.deletedAt)
          throw new AppError(409, 'CONFLICT', 'This designation already exists');
        const row = existing
          ? await tx.designation.update({
              where: { id: existing.id },
              data: { deletedAt: null, name: request.body.name, color: request.body.color },
            })
          : await tx.designation.create({ data: { ...request.body, companyId: ctx.companyId } });
        await recordChange(tx, ctx, {
          event: 'designation.created',
          entityType: 'designation',
          entityId: row.id,
          after: row,
        });
        return row;
      }),
  );

  r.delete(
    '/api/org/designations/:id',
    { ...edit, schema: { tags: ['org'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await tx.designation.findFirst({ where: { id: request.params.id, deletedAt: null } });
        if (!before) throw notFound('Designation');
        if (await tx.user.count({ where: { designationId: before.id, deletedAt: null } }))
          throw inUse('designation');
        await tx.designation.update({ where: { id: before.id }, data: { deletedAt: new Date() } });
        await recordChange(tx, ctx, {
          event: 'designation.deleted',
          entityType: 'designation',
          entityId: before.id,
          before,
        });
        return { ok: true };
      }),
  );
}
