import type { Db } from '@mono/db';
import type { leaveTypeSchema } from '@mono/shared';
import { hrRulesSchema, type HrRules } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { ensureLeaveTypes } from './balance';
import { decidable, hrRulesOf } from './people';

const needAdmin = (actor: Actor) => {
  if (!can(actor, 'hr.admin')) throw new AppError(403, 'FORBIDDEN', 'Only HR admins change this');
};

export async function readHrRules(db: Db, companyId: string) {
  const row = await db.hrRules.findUnique({ where: { companyId } });
  return { rules: await hrRulesOf(db, companyId), saved: Boolean(row), updatedAt: row?.updatedAt ?? null };
}

/** Check & save (§9.1 step 7). People named in overrides and the HR person must be real. */
export async function saveHrRules(db: Db, actor: Actor, input: unknown) {
  needAdmin(actor);
  const rules: HrRules = hrRulesSchema.parse(input);
  const ids = [
    rules.leave.hrUserId,
    ...rules.overrides.filter((o) => o.scope === 'person').map((o) => o.id),
  ].filter((x): x is string => Boolean(x));
  if (ids.length) {
    const found = await db.user.count({
      where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null },
    });
    if (found !== new Set(ids).size)
      throw new AppError(400, 'VALIDATION_FAILED', 'A person in the rules is not in the company');
  }
  const depts = rules.overrides.filter((o) => o.scope === 'department').map((o) => o.id);
  if (
    depts.length &&
    (await db.department.count({
      where: { companyId: actor.companyId, id: { in: depts }, deletedAt: null },
    })) !== new Set(depts).size
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A team in the rules is not a department');
  await db.$transaction(async (tx) => {
    const before = await tx.hrRules.findUnique({ where: { companyId: actor.companyId } });
    await tx.hrRules.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, rules: rules as object, updatedById: actor.userId },
      update: { rules: rules as object, updatedById: actor.userId },
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'hr.rules_saved',
        entityType: 'hr_rules',
        entityId: actor.companyId,
        before: before?.rules ?? null,
        after: rules,
      },
    );
  });
  return readHrRules(db, actor.companyId);
}

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(2).max(80),
  type: z.enum(['FESTIVAL', 'NATIONAL', 'OPTIONAL']).default('FESTIVAL'),
  halfDay: z.boolean().default(false),
  branchId: z.string().nullish(),
});

/** Holidays of a year (FY or calendar) and the weekly offs: everyone reads them; HR changes them. */
export async function readCalendar(db: Db, companyId: string, from: string, to: string) {
  const [holidays, weeklyOffs, branches] = await Promise.all([
    db.holiday.findMany({
      where: { companyId, deletedAt: null, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    }),
    db.weeklyOff.findMany({ where: { companyId }, orderBy: { weekday: 'asc' } }),
    db.branch.findMany({ where: { companyId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  return { holidays, weeklyOffs, branches };
}

export async function saveHoliday(db: Db, actor: Actor, input: z.infer<typeof holidaySchema>, id?: string) {
  needAdmin(actor);
  return db.$transaction(async (tx) => {
    if (id && !(await tx.holiday.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } })))
      throw notFound('Holiday');
    const clash = await tx.holiday.findFirst({
      where: {
        companyId: actor.companyId,
        deletedAt: null,
        date: input.date,
        branchId: input.branchId ?? null,
        NOT: id ? { id } : undefined,
      },
    });
    if (clash) throw new AppError(409, 'CONFLICT', `${clash.name} is already on that day`);
    const data = {
      date: input.date,
      name: input.name,
      type: input.type,
      halfDay: input.halfDay,
      branchId: input.branchId ?? null,
    };
    const row = id
      ? await tx.holiday.update({ where: { id }, data })
      : await tx.holiday.create({ data: { ...data, companyId: actor.companyId } });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: id ? 'holiday.edited' : 'holiday.added',
        entityType: 'holiday',
        entityId: row.id,
        after: row,
      },
    );
    return row;
  });
}

export async function deleteHoliday(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const row = await db.holiday.findFirst({ where: { id, companyId: actor.companyId, deletedAt: null } });
  if (!row) throw notFound('Holiday');
  await db.$transaction(async (tx) => {
    await tx.holiday.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'holiday.deleted', entityType: 'holiday', entityId: id, before: row },
    );
  });
  return { ok: true };
}

export const weeklyOffSchema = z.object({
  branchId: z.string().nullish(),
  days: z
    .array(z.object({ weekday: z.number().int().min(1).max(7), kind: z.enum(['WORKING', 'HALF', 'OFF']) }))
    .length(7),
});

export async function saveWeeklyOffs(db: Db, actor: Actor, input: z.infer<typeof weeklyOffSchema>) {
  needAdmin(actor);
  if (new Set(input.days.map((d) => d.weekday)).size !== 7)
    throw new AppError(400, 'VALIDATION_FAILED', 'Give each weekday once');
  if (input.days.every((d) => d.kind === 'OFF'))
    throw new AppError(400, 'VALIDATION_FAILED', 'At least one day must be worked');
  await db.$transaction(async (tx) => {
    await tx.weeklyOff.deleteMany({
      where: { companyId: actor.companyId, branchId: input.branchId ?? null },
    });
    await tx.weeklyOff.createMany({
      data: input.days.map((d) => ({ ...d, companyId: actor.companyId, branchId: input.branchId ?? null })),
    });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      {
        action: 'weekly_off.saved',
        entityType: 'weekly_off',
        entityId: input.branchId ?? actor.companyId,
        after: input,
      },
    );
  });
  return { ok: true };
}

export async function listLeaveTypes(db: Db, companyId: string) {
  await ensureLeaveTypes(db, companyId);
  return db.leaveType.findMany({ where: { companyId, deletedAt: null }, orderBy: { code: 'asc' } });
}

export async function saveLeaveType(
  db: Db,
  actor: Actor,
  input: z.infer<typeof leaveTypeSchema>,
  id?: string,
) {
  needAdmin(actor);
  return db.$transaction(async (tx) => {
    const clash = await tx.leaveType.findFirst({
      where: { companyId: actor.companyId, code: input.code, NOT: id ? { id } : undefined },
    });
    if (clash) throw new AppError(409, 'CONFLICT', `There is already a ${input.code}`);
    const row = id
      ? await tx.leaveType.update({ where: { id }, data: input })
      : await tx.leaveType.create({ data: { ...input, companyId: actor.companyId } });
    await writeAudit(
      tx,
      { ...actor, actorId: actor.userId },
      { action: 'leave_type.saved', entityType: 'leave_type', entityId: row.id, after: row },
    );
    return row;
  });
}

/** The leave screen's lists: my requests, those I decide, and Buddy requests waiting on me. */
export async function leaveLists(db: Db, actor: Actor) {
  const [mine, toDecide, asks] = await Promise.all([
    db.leaveRequest.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    decidable(db, actor, 'hr.leave', (userId) =>
      db.leaveRequest.findMany({
        where: { companyId: actor.companyId, status: 'PENDING', userId },
        orderBy: { from: 'asc' },
      }),
    ),
    db.buddyRequest.findMany({ where: { buddyId: actor.userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
  ]);
  const ids = [...mine, ...toDecide].map((l) => l.id);
  const buddies = await db.buddyRequest.findMany({
    where: { leaveRequestId: { in: ids } },
    orderBy: { createdAt: 'asc' },
  });
  const types = new Map(
    (await db.leaveType.findMany({ where: { companyId: actor.companyId } })).map((t) => [t.id, t]),
  );
  const shape = (l: (typeof mine)[number]) => {
    const own = buddies.filter((b) => b.leaveRequestId === l.id);
    const accepted = new Set(
      own
        .filter((b) => b.status === 'ACCEPTED')
        .flatMap((b) => (b.items as { key: string }[]).map((i) => i.key)),
    );
    const work = l.work as { key: string; title: string }[];
    return {
      ...l,
      days: Number(l.days),
      type: types.get(l.leaveTypeId)?.name ?? '',
      buddies: own.map((b) => ({
        id: b.id,
        buddyId: b.buddyId,
        status: b.status,
        items: b.items,
        note: b.note,
      })),
      uncovered: work.filter((w) => !accepted.has(w.key)),
    };
  };
  return { mine: mine.map(shape), toDecide: toDecide.map(shape), asks };
}
