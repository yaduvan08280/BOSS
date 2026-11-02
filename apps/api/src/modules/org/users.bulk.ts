import type { Tx } from '@mono/db';
import { normalizeMobile, type PastedPerson } from '@mono/shared';
import type { ActorContext } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { recordChange } from '../../lib/events';
import { nextUserCode, roleByKey } from './users.service';

type Input = { people: Omit<PastedPerson, 'line' | 'errors'>[]; createMissing: boolean };

/** Create everyone from a pasted list in one go, or nobody: every problem is reported per line. */
export async function bulkCreatePeople(tx: Tx, ctx: ActorContext, input: Input) {
  const people = input.people.map((p) => ({
    ...p,
    mobile: p.mobile ? normalizeMobile(p.mobile) : null,
    email: p.email ? p.email.trim().toLowerCase() : null,
  }));
  const errors: { index: number; message: string }[] = [];
  const existing = await tx.user.findMany({
    where: {
      OR: [
        { mobile: { in: people.flatMap((p) => (p.mobile ? [p.mobile] : [])) } },
        { email: { in: people.flatMap((p) => (p.email ? [p.email] : [])) } },
      ],
    },
    select: { name: true, mobile: true, email: true },
  });
  people.forEach((p, index) => {
    const clash = existing.find(
      (e) => (p.mobile && e.mobile === p.mobile) || (p.email && e.email === p.email),
    );
    if (clash)
      errors.push({
        index,
        message: `${clash.name} already uses this ${p.mobile && clash.mobile === p.mobile ? 'mobile' : 'email'}`,
      });
  });

  const departments = await tx.department.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const designations = await tx.designation.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const key = (s: string) => s.trim().toLowerCase();
  const deptByName = new Map(departments.map((d) => [key(d.name), d.id]));
  const desigByName = new Map(designations.map((d) => [key(d.name), d.id]));
  if (!input.createMissing) {
    people.forEach((p, index) => {
      if (p.department && !deptByName.has(key(p.department)))
        errors.push({ index, message: `No department called ${p.department}` });
      if (p.designation && !desigByName.has(key(p.designation)))
        errors.push({ index, message: `No designation called ${p.designation}` });
    });
  }
  if (errors.length) throw new AppError(409, 'CONFLICT', 'Some lines need attention', { lines: errors });

  const created = { departments: [] as string[], designations: [] as string[] };
  let order = await tx.department.count({ where: { companyId: ctx.companyId } });
  for (const p of people) {
    if (p.department && !deptByName.has(key(p.department))) {
      const d = await tx.department.create({
        data: { companyId: ctx.companyId, name: p.department.trim(), sortOrder: order++ },
      });
      deptByName.set(key(d.name), d.id);
      created.departments.push(d.name);
      await recordChange(tx, ctx, {
        event: 'department.created',
        entityType: 'department',
        entityId: d.id,
        after: d,
      });
    }
    if (p.designation && !desigByName.has(key(p.designation))) {
      const d = await tx.designation.create({
        data: { companyId: ctx.companyId, name: p.designation.trim() },
      });
      desigByName.set(key(d.name), d.id);
      created.designations.push(d.name);
      await recordChange(tx, ctx, {
        event: 'designation.created',
        entityType: 'designation',
        entityId: d.id,
        after: d,
      });
    }
  }

  const member = await roleByKey(tx, 'MEMBER');
  const ids: string[] = [];
  for (const p of people) {
    const user = await tx.user.create({
      data: {
        companyId: ctx.companyId,
        code: await nextUserCode(tx, ctx.companyId),
        name: p.name.trim(),
        mobile: p.mobile,
        email: p.email,
        roleId: member.id,
        mainDepartmentId: p.department ? (deptByName.get(key(p.department)) ?? null) : null,
        designationId: p.designation ? (desigByName.get(key(p.designation)) ?? null) : null,
      },
    });
    ids.push(user.id);
    await recordChange(tx, ctx, {
      event: 'user.created',
      entityType: 'user',
      entityId: user.id,
      after: { code: user.code, name: user.name },
      payload: { bulk: true },
    });
  }
  return {
    created: ids.length,
    ids,
    newDepartments: created.departments,
    newDesignations: created.designations,
  };
}
