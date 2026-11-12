import type { Db, Tx } from '@mono/db';
import {
  DEFAULT_PAY_RULES,
  employeeTermsSchema,
  leaveQuotasSchema,
  payRulesSchema,
  type EmployeeTerms,
  type PayRules,
} from '@mono/shared';
import type { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { isHr } from './people';

/** Pay is HR's: hr.admin or the HR person. Nobody changes their own pay but the owner. */
export async function needHr(db: Db | Tx, actor: Actor, forUserId?: string) {
  if (!(await isHr(db, actor))) throw new AppError(403, 'FORBIDDEN', 'Only HR sees and changes pay');
  if (forUserId === actor.userId && !actor.permissions.includes('*'))
    throw new AppError(403, 'FORBIDDEN', "You can't change your own pay");
}
const ctx = (actor: Actor) => ({ ...actor, actorId: actor.userId });

export async function payRulesOf(db: Db | Tx, companyId: string): Promise<PayRules> {
  const row = await db.payRules.findUnique({ where: { companyId } });
  const parsed = payRulesSchema.safeParse(row?.rules ?? {});
  return parsed.success ? parsed.data : DEFAULT_PAY_RULES;
}

/** Everyone's work pattern and pay. Without terms, the salary in their HR details is a monthly rate. */
export async function listTerms(db: Db, actor: Actor) {
  await needHr(db, actor);
  const [people, terms] = await Promise.all([
    db.user.findMany({
      where: { companyId: actor.companyId, deletedAt: null, status: { not: 'LEFT' } },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        hr: true,
        mainDepartment: { select: { name: true } },
        designation: { select: { name: true } },
        shift: { select: { name: true } },
      },
    }),
    db.employeeTerms.findMany({ where: { companyId: actor.companyId } }),
  ]);
  const byUser = new Map(terms.map((t) => [t.userId, t]));
  return people.map((p) => {
    const t = byUser.get(p.id);
    const salary = Number((p.hr as { salary?: number } | null)?.salary ?? 0);
    return {
      user: {
        id: p.id,
        code: p.code,
        name: p.name,
        department: p.mainDepartment?.name ?? null,
        designation: p.designation?.name ?? null,
        shift: p.shift?.name ?? null,
      },
      saved: Boolean(t),
      terms: termsView(t ?? null, salary),
    };
  });
}

type TermsRow = Awaited<ReturnType<Db['employeeTerms']['findUnique']>>;
function termsView(t: TermsRow, salaryRupees: number): EmployeeTerms {
  return t
    ? {
        pattern: t.pattern as EmployeeTerms['pattern'],
        dailyHours: t.dailyHours === null ? null : Number(t.dailyHours),
        weeklyHours: t.weeklyHours === null ? null : Number(t.weeklyHours),
        latestStartMin: t.latestStartMin,
        payBasis: t.payBasis as EmployeeTerms['payBasis'],
        ratePaise: Number(t.rate),
      }
    : {
        pattern: 'shift',
        dailyHours: null,
        weeklyHours: null,
        latestStartMin: null,
        payBasis: 'monthly',
        ratePaise: salaryRupees * 100,
      };
}

export async function saveTerms(db: Db, actor: Actor, userId: string, input: unknown) {
  await needHr(db, actor, userId);
  const t = employeeTermsSchema.parse(input);
  const user = await db.user.findFirst({
    where: { id: userId, companyId: actor.companyId, deletedAt: null },
    select: { id: true },
  });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'Person not found');
  const data = {
    pattern: t.pattern,
    dailyHours: t.pattern === 'daily' ? t.dailyHours! : null,
    weeklyHours: t.pattern === 'weekly' ? t.weeklyHours! : null,
    latestStartMin: t.pattern === 'shift' ? null : (t.latestStartMin ?? null),
    payBasis: t.payBasis,
    rate: BigInt(t.ratePaise),
    updatedById: actor.userId,
  };
  return db.$transaction(async (tx) => {
    const before = await tx.employeeTerms.findUnique({ where: { userId } });
    const row = await tx.employeeTerms.upsert({
      where: { userId },
      create: { companyId: actor.companyId, userId, ...data },
      update: data,
    });
    await writeAudit(tx, ctx(actor), {
      action: 'hr.terms_saved',
      entityType: 'user',
      entityId: userId,
      before: before ? termsView(before, 0) : null,
      after: t,
    });
    return termsView(row, 0);
  });
}

export async function readPayRules(db: Db, actor: Actor) {
  await needHr(db, actor);
  const row = await db.payRules.findUnique({ where: { companyId: actor.companyId } });
  return { rules: await payRulesOf(db, actor.companyId), saved: Boolean(row) };
}

/** Overrides must name a real department, designation or person of the company. */
export async function savePayRules(db: Db, actor: Actor, input: unknown) {
  await needHr(db, actor);
  const rules = payRulesSchema.parse(input);
  const companyId = actor.companyId;
  const ids = (scope: string) => [
    ...new Set(rules.overrides.filter((o) => o.scope === scope).map((o) => o.id)),
  ];
  const [d, g, p] = [ids('department'), ids('designation'), ids('person')];
  const [dn, gn, pn] = await Promise.all([
    d.length ? db.department.count({ where: { companyId, id: { in: d }, deletedAt: null } }) : 0,
    g.length ? db.designation.count({ where: { companyId, id: { in: g }, deletedAt: null } }) : 0,
    p.length ? db.user.count({ where: { companyId, id: { in: p }, deletedAt: null } }) : 0,
  ]);
  if (dn !== d.length || gn !== g.length || pn !== p.length)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'A team, designation or person in the pay rules is not in the company',
    );
  await db.$transaction(async (tx) => {
    const before = await tx.payRules.findUnique({ where: { companyId } });
    await tx.payRules.upsert({
      where: { companyId },
      create: { companyId, rules: rules as object, updatedById: actor.userId },
      update: { rules: rules as object, updatedById: actor.userId },
    });
    await writeAudit(tx, ctx(actor), {
      action: 'hr.pay_rules_saved',
      entityType: 'pay_rules',
      entityId: companyId,
      before: before?.rules ?? null,
      after: rules,
    });
  });
  return readPayRules(db, actor);
}

/**
 * Days of a leave type for one person a year: their own number, else their designation's, else their legal
 * entity's, else the type's.
 */
export async function quotaFor(
  db: Db | Tx,
  leaveType: { id: string; yearlyQuota: unknown },
  p: { id: string; designationId: string | null; entityId?: string | null },
) {
  const rows = await db.leaveQuota.findMany({
    where: {
      leaveTypeId: leaveType.id,
      OR: [
        { scope: 'person', refId: p.id },
        ...(p.designationId ? [{ scope: 'designation', refId: p.designationId }] : []),
        ...(p.entityId ? [{ scope: 'entity', refId: p.entityId }] : []),
      ],
    },
  });
  const own =
    rows.find((r) => r.scope === 'person') ??
    rows.find((r) => r.scope === 'designation') ??
    rows.find((r) => r.scope === 'entity');
  return Number(own?.yearlyQuota ?? leaveType.yearlyQuota);
}

export async function listQuotas(db: Db, actor: Actor) {
  await needHr(db, actor);
  const rows = await db.leaveQuota.findMany({ where: { companyId: actor.companyId } });
  return rows.map((r) => ({
    leaveTypeId: r.leaveTypeId,
    scope: r.scope as 'entity' | 'designation' | 'person',
    refId: r.refId,
    yearlyQuota: Number(r.yearlyQuota),
  }));
}

/** Replaces a leave type's designation and person numbers. This year's balances follow at once. */
export async function saveQuotas(
  db: Db,
  actor: Actor,
  leaveTypeId: string,
  input: z.input<typeof leaveQuotasSchema>,
) {
  await needHr(db, actor);
  const { quotas } = leaveQuotasSchema.parse(input);
  const companyId = actor.companyId;
  const type = await db.leaveType.findFirst({ where: { id: leaveTypeId, companyId, deletedAt: null } });
  if (!type) throw new AppError(404, 'NOT_FOUND', 'Leave type not found');
  const keys = quotas.map((q) => `${q.scope}:${q.refId}`);
  if (new Set(keys).size !== keys.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'The same designation or person is in the list twice');
  const g = quotas.filter((q) => q.scope === 'designation').map((q) => q.refId);
  const p = quotas.filter((q) => q.scope === 'person').map((q) => q.refId);
  const e = quotas.filter((q) => q.scope === 'entity').map((q) => q.refId);
  if (
    e.length &&
    (await db.legalEntity.count({ where: { companyId, id: { in: e }, deletedAt: null } })) !== e.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A legal entity in the list is not in the company');
  const [gn, pn] = await Promise.all([
    g.length ? db.designation.count({ where: { companyId, id: { in: g }, deletedAt: null } }) : 0,
    p.length ? db.user.count({ where: { companyId, id: { in: p }, deletedAt: null } }) : 0,
  ]);
  if (gn !== g.length || pn !== p.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'A designation or person in the list is not in the company');
  await db.$transaction(async (tx) => {
    const before = await tx.leaveQuota.findMany({ where: { leaveTypeId } });
    await tx.leaveQuota.deleteMany({ where: { leaveTypeId } });
    if (quotas.length)
      await tx.leaveQuota.createMany({ data: quotas.map((q) => ({ ...q, companyId, leaveTypeId })) });
    await writeAudit(tx, ctx(actor), {
      action: 'hr.leave_quotas_saved',
      entityType: 'leave_type',
      entityId: leaveTypeId,
      before: before.map((b) => ({ scope: b.scope, refId: b.refId, yearlyQuota: Number(b.yearlyQuota) })),
      after: quotas,
    });
  });
  return listQuotas(db, actor);
}
