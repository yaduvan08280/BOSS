import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Prisma, Tx } from '@mono/db';
import {
  bulkActionSchema,
  bulkCreateSchema,
  hasPermission,
  localDate,
  userCreateSchema,
  userUpdateSchema,
} from '@mono/shared';
import { AppError, forbidden, notFound } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { recordMove } from '../branches/history';
import { placesOf } from '../branches/people';
import { hashPassword } from '../../lib/password';
import { inCompanyTx } from '../../lib/tx';
import { assertGroupWide, assertMyPeople, myBranchFor } from './users.branch';
import { bulkCreatePeople } from './users.bulk';
import {
  assertOwnerRemains,
  assertUnique,
  cleanIdentifiers,
  nextUserCode,
  personInclude,
  revokeSessions,
  roleByKey,
  tempPassword,
  toPerson,
} from './users.service';

const idParam = z.object({ id: z.string() });
const canHr = (request: FastifyRequest) => hasPermission(request.auth!.permissions, 'hr.admin');
const isOwner = (request: FastifyRequest) => request.auth!.roleKey === 'OWNER';

async function findPerson(tx: Tx, id: string) {
  const user = await tx.user.findFirst({ where: { id, deletedAt: null }, include: personInclude });
  if (!user) throw notFound('Person');
  return user;
}

async function checkRole(tx: Tx, request: FastifyRequest, roleId: string) {
  const role = await tx.role.findFirst({ where: { id: roleId, deletedAt: null } });
  if (!role) throw notFound('Role');
  if (role.key === 'OWNER' && !isOwner(request)) throw forbidden('Only an Owner can make someone an Owner');
  return role;
}

/** Turn login on: a person without a password gets a one-time password to share with them. */
async function enableLogin(
  tx: Tx,
  user: { id: string; mobile: string | null; email: string | null; passwordHash: string | null },
) {
  if (!user.mobile && !user.email)
    throw new AppError(400, 'BAD_REQUEST', 'Add a mobile number or email first; it becomes the login ID');
  if (user.passwordHash) {
    await tx.user.update({ where: { id: user.id }, data: { loginEnabled: true } });
    return null;
  }
  const password = tempPassword();
  await tx.user.update({
    where: { id: user.id },
    data: { loginEnabled: true, passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  return password;
}

export async function userRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const view = { onRequest: [app.requirePermission('org.view')] };
  const create = { onRequest: [app.requirePermission('org.create')] };
  const edit = { onRequest: [app.requirePermission('org.edit')] };
  const admin = { onRequest: [app.requirePermission('org.admin')] };

  r.get('/api/org/users', { ...view, schema: { tags: ['org'] } }, async (request) => {
    const rows = await request.db.user.findMany({ include: personInclude, orderBy: { code: 'asc' } });
    const place = await placesOf(app.prisma, request.auth!.companyId);
    return rows.map((u) => place(toPerson(u, canHr(request))));
  });

  r.post(
    '/api/org/users',
    { ...create, schema: { tags: ['org'], body: userCreateSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const { mobile, email } = cleanIdentifiers(request.body);
        await assertUnique(tx, { mobile, email });
        if (request.body.roleId) assertGroupWide(request, 'choose a role');
        const roleId = request.body.roleId
          ? (await checkRole(tx, request, request.body.roleId)).id
          : (await roleByKey(tx, 'MEMBER')).id;
        const { loginEnabled, ...rest } = request.body;
        const user = await tx.user.create({
          data: {
            ...rest,
            branchId: myBranchFor(request, rest.branchId),
            companyId: ctx.companyId,
            mobile,
            email,
            roleId,
            code: await nextUserCode(tx, ctx.companyId),
          },
        });
        const password = loginEnabled ? await enableLogin(tx, user) : null;
        await recordChange(tx, ctx, {
          event: 'user.created',
          entityType: 'user',
          entityId: user.id,
          after: { code: user.code, name: user.name, mobile, email },
        });
        return { person: toPerson(await findPerson(tx, user.id), canHr(request)), tempPassword: password };
      }),
  );

  r.post(
    '/api/org/users/bulk',
    { ...create, schema: { tags: ['org'], body: bulkCreateSchema } },
    async (request) => {
      assertGroupWide(request, 'paste a list of people');
      return inCompanyTx(request, (tx, ctx) => bulkCreatePeople(tx, ctx, request.body));
    },
  );

  r.patch(
    '/api/org/users/:id',
    { ...edit, schema: { tags: ['org'], params: idParam, body: userUpdateSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await findPerson(tx, request.params.id);
        assertMyPeople(request, [before]);
        const { alsoWorksIn, hr, status, roleId, loginEnabled: _ignored, ...rest } = request.body;
        const data: Prisma.UserUncheckedUpdateInput = { ...rest };
        if (rest.branchId !== undefined) {
          data.branchId = myBranchFor(request, rest.branchId);
          // Changing the branch here is a move from today, kept in the person's branch history (phase 12).
          if ((data.branchId ?? null) !== before.branchId) {
            const company = await tx.company.findUniqueOrThrow({
              where: { id: ctx.companyId },
              select: { timezone: true },
            });
            await recordMove(
              tx,
              {
                companyId: ctx.companyId,
                userId: before.id,
                branchId: (data.branchId as string | null | undefined) ?? null,
                from: undefined,
                today: localDate(new Date(), company.timezone),
                actorId: ctx.actorId,
              },
              before.branchId,
            );
          }
        }
        if (rest.mobile !== undefined || rest.email !== undefined) {
          const ids = cleanIdentifiers({
            mobile: rest.mobile ?? before.mobile,
            email: rest.email ?? before.email,
          });
          await assertUnique(tx, ids, before.id);
          Object.assign(data, ids);
        }
        if (rest.reportsToId === before.id)
          throw new AppError(400, 'BAD_REQUEST', 'A person cannot report to themselves');
        if (roleId && roleId !== before.roleId) {
          if (!hasPermission(request.auth!.permissions, 'org.admin')) throw forbidden();
          assertGroupWide(request, 'choose a role');
          await checkRole(tx, request, roleId);
          if (before.role.key === 'OWNER') await assertOwnerRemains(tx, [before.id]);
          data.roleId = roleId;
        }
        if (status && status !== before.status) {
          if (!hasPermission(request.auth!.permissions, 'org.admin')) throw forbidden();
          if (status !== 'ACTIVE') {
            if (before.id === ctx.actorId)
              throw new AppError(400, 'BAD_REQUEST', "You can't mark yourself as left or inactive");
            await assertOwnerRemains(tx, [before.id]);
            await revokeSessions(tx, [before.id]);
          }
          data.status = status;
        }
        if (hr) {
          if (!canHr(request)) throw forbidden('Only HR can change HR details');
          data.hr = { ...((before.hr ?? {}) as Record<string, unknown>), ...hr };
        }
        await tx.user.update({ where: { id: before.id }, data });
        if (alsoWorksIn) {
          const main = (data.mainDepartmentId as string | null | undefined) ?? before.mainDepartmentId;
          const wanted = [...new Set(alsoWorksIn)].filter((d) => d !== main);
          const found = await tx.department.count({ where: { id: { in: wanted }, deletedAt: null } });
          if (found !== wanted.length) throw notFound('Department');
          await tx.userDepartment.deleteMany({
            where: { userId: before.id, departmentId: { notIn: wanted } },
          });
          for (const departmentId of wanted) {
            await tx.userDepartment.upsert({
              where: { userId_departmentId: { userId: before.id, departmentId } },
              create: { companyId: ctx.companyId, userId: before.id, departmentId },
              update: {},
            });
          }
        }
        const after = await findPerson(tx, before.id);
        await recordChange(tx, ctx, {
          event: 'user.updated',
          entityType: 'user',
          entityId: before.id,
          before: toPerson(before, false),
          after: toPerson(after, false),
        });
        return toPerson(after, canHr(request));
      }),
  );

  r.post(
    '/api/org/users/:id/login',
    { ...admin, schema: { tags: ['org'], params: idParam, body: z.object({ enabled: z.boolean() }) } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const before = await findPerson(tx, request.params.id);
        assertMyPeople(request, [before]);
        let password: string | null = null;
        if (request.body.enabled) {
          password = await enableLogin(tx, before);
        } else {
          if (before.id === ctx.actorId)
            throw new AppError(400, 'BAD_REQUEST', "You can't turn off your own login");
          await assertOwnerRemains(tx, [before.id]);
          await tx.user.update({ where: { id: before.id }, data: { loginEnabled: false } });
          await revokeSessions(tx, [before.id]);
        }
        await recordChange(tx, ctx, {
          event: 'user.updated',
          entityType: 'user',
          entityId: before.id,
          before: { loginEnabled: before.loginEnabled },
          after: { loginEnabled: request.body.enabled },
        });
        return { tempPassword: password };
      }),
  );

  r.post(
    '/api/org/users/:id/reset-password',
    { ...admin, schema: { tags: ['org'], params: idParam } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const user = await findPerson(tx, request.params.id);
        assertMyPeople(request, [user]);
        // A reset replaces the password with a one-time one and signs the person out: never do that to
        // yourself by accident (the sole Owner would be left with only a password shown once).
        if (user.id === ctx.actorId)
          throw new AppError(
            400,
            'BAD_REQUEST',
            "You can't reset your own password here. Use Profile → Change password.",
          );
        if (user.role.key === 'OWNER' && !isOwner(request))
          throw forbidden("Only an Owner can reset an Owner's password");
        if (!user.mobile && !user.email)
          throw new AppError(
            400,
            'BAD_REQUEST',
            'Add a mobile number or email first; it becomes the login ID',
          );
        const password = tempPassword();
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password), mustChangePassword: true, loginEnabled: true },
        });
        await revokeSessions(tx, [user.id]);
        await recordChange(tx, ctx, { event: 'user.password_reset', entityType: 'user', entityId: user.id });
        return { tempPassword: password };
      }),
  );

  r.delete('/api/org/users/:id', { ...admin, schema: { tags: ['org'], params: idParam } }, async (request) =>
    inCompanyTx(request, async (tx, ctx) => {
      const user = await findPerson(tx, request.params.id);
      assertMyPeople(request, [user]);
      if (user.id === ctx.actorId) throw new AppError(400, 'BAD_REQUEST', "You can't delete yourself");
      await assertOwnerRemains(tx, [user.id]);
      await tx.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date(), status: 'LEFT', loginEnabled: false },
      });
      await tx.department.updateMany({ where: { hodUserId: user.id }, data: { hodUserId: null } });
      await revokeSessions(tx, [user.id]);
      await recordChange(tx, ctx, {
        event: 'user.deleted',
        entityType: 'user',
        entityId: user.id,
        before: toPerson(user, false),
      });
      return { ok: true };
    }),
  );

  r.post(
    '/api/org/users/bulk-action',
    { ...admin, schema: { tags: ['org'], body: bulkActionSchema } },
    async (request) =>
      inCompanyTx(request, async (tx, ctx) => {
        const body = request.body;
        const users = await tx.user.findMany({ where: { id: { in: body.userIds }, deletedAt: null } });
        if (users.length !== new Set(body.userIds).size) throw notFound('Person');
        assertMyPeople(request, users);
        if (body.action === 'setRole') assertGroupWide(request, 'choose a role');
        const passwords: { id: string; code: string; name: string; tempPassword: string }[] = [];
        if (body.action === 'moveDepartment') {
          if (
            body.departmentId &&
            !(await tx.department.count({ where: { id: body.departmentId, deletedAt: null } }))
          )
            throw notFound('Department');
          await tx.user.updateMany({
            where: { id: { in: body.userIds } },
            data: { mainDepartmentId: body.departmentId },
          });
          if (body.departmentId)
            await tx.userDepartment.deleteMany({
              where: { userId: { in: body.userIds }, departmentId: body.departmentId },
            });
        } else if (body.action === 'setRole') {
          const role = await checkRole(tx, request, body.roleId);
          if (role.key !== 'OWNER') await assertOwnerRemains(tx, body.userIds);
          await tx.user.updateMany({ where: { id: { in: body.userIds } }, data: { roleId: role.id } });
        } else if (body.enabled) {
          for (const u of users) {
            if (!u.mobile && !u.email) continue;
            const password = await enableLogin(tx, u);
            if (password) passwords.push({ id: u.id, code: u.code, name: u.name, tempPassword: password });
          }
        } else {
          if (body.userIds.includes(ctx.actorId))
            throw new AppError(400, 'BAD_REQUEST', "You can't turn off your own login");
          await assertOwnerRemains(tx, body.userIds);
          await tx.user.updateMany({ where: { id: { in: body.userIds } }, data: { loginEnabled: false } });
          await revokeSessions(tx, body.userIds);
        }
        for (const u of users) {
          await recordChange(tx, ctx, {
            event: 'user.updated',
            entityType: 'user',
            entityId: u.id,
            payload: { bulk: body.action },
          });
        }
        return {
          updated: users.length,
          passwords,
          skipped: users.filter((u) => !u.mobile && !u.email && body.action === 'enableLogin').length,
        };
      }),
  );
}
