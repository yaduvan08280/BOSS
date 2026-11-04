import type { Db, Tx } from '@mono/db';
import { DEFAULT_HR_RULES, hrRulesSchema, rulesFor, type HrRules, type WorkPattern } from '@mono/shared';
import { AppError } from '../../lib/errors';
import { can, teamOf, type Actor } from '../work/actor';

export async function hrRulesOf(db: Db | Tx, companyId: string): Promise<HrRules> {
  const row = await db.hrRules.findUnique({ where: { companyId } });
  const parsed = hrRulesSchema.safeParse(row?.rules ?? {});
  return parsed.success ? parsed.data : DEFAULT_HR_RULES;
}

export type HrPerson = {
  id: string;
  name: string;
  companyId: string;
  departmentId: string | null;
  branchId: string | null;
  defaultBuddyId: string | null;
  hodId: string | null;
  /** For daily / weekly hours, the whole calendar day. */
  shift: { start: number; end: number };
  pattern: WorkPattern;
  weeklyHours: number | null;
  /** Daily / weekly hours: in by this time (minutes from midnight) or absent; null = no absence check. */
  latestStartMin: number | null;
  designationId: string | null;
};

/** A person with what HR needs: their shift (or the default one), branch, department and HOD. */
export async function hrPerson(db: Db | Tx, companyId: string, userId: string): Promise<HrPerson> {
  const u = await db.user.findFirst({
    where: { id: userId, companyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      branchId: true,
      defaultBuddyId: true,
      designationId: true,
      mainDepartmentId: true,
      shift: { select: { startMin: true, endMin: true, deletedAt: true } },
      mainDepartment: { select: { hodUserId: true, parent: { select: { hodUserId: true } } } },
    },
  });
  if (!u) throw new AppError(404, 'NOT_FOUND', 'Person not found');
  const fallback =
    u.shift && !u.shift.deletedAt
      ? null
      : await db.shift.findFirst({
          where: { companyId, deletedAt: null },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        });
  const s = u.shift && !u.shift.deletedAt ? u.shift : fallback;
  const dept = u.mainDepartment;
  const hod = dept?.hodUserId && dept.hodUserId !== u.id ? dept.hodUserId : (dept?.parent?.hodUserId ?? null);
  const terms = await db.employeeTerms.findUnique({ where: { userId } });
  const kind = terms?.pattern === 'daily' || terms?.pattern === 'weekly' ? terms.pattern : 'shift';
  const pattern: WorkPattern =
    kind === 'daily'
      ? { kind, hours: Number(terms?.dailyHours ?? 8) }
      : kind === 'weekly'
        ? { kind }
        : { kind };
  const fixed = s ? { start: s.startMin, end: s.endMin } : { start: 9 * 60, end: 18 * 60 };
  return {
    id: u.id,
    name: u.name,
    companyId,
    designationId: u.designationId,
    pattern,
    weeklyHours: kind === 'weekly' ? Number(terms?.weeklyHours ?? 48) : null,
    latestStartMin: kind === 'shift' ? null : (terms?.latestStartMin ?? null),
    departmentId: u.mainDepartmentId,
    branchId: u.branchId,
    defaultBuddyId: u.defaultBuddyId,
    hodId: hod && hod !== u.id ? hod : null,
    // Daily or weekly hours: any time of the day counts.
    shift: kind === 'shift' ? fixed : { start: 0, end: 24 * 60 },
  };
}

export const personRules = (rules: HrRules, p: HrPerson) =>
  rulesFor(rules, { id: p.id, departmentId: p.departmentId });

/** HR people: anyone with hr.admin, or the HR person named in the rules. */
export async function isHr(db: Db | Tx, actor: Actor): Promise<boolean> {
  if (can(actor, 'hr.admin')) return true;
  return (await hrRulesOf(db, actor.companyId)).leave.hrUserId === actor.userId;
}

/** Whose attendance and leave someone may see and decide: HR all, an HOD their team, everyone themselves. */
export async function hrScope(db: Db | Tx, actor: Actor): Promise<{ all: boolean; team: string[] }> {
  if (await isHr(db, actor)) return { all: true, team: [] };
  return { all: false, team: await teamOf(db, actor.companyId, actor.userId) };
}

export async function canDecideFor(db: Db | Tx, actor: Actor, userId: string): Promise<boolean> {
  if (userId === actor.userId) return false;
  const s = await hrScope(db, actor);
  return s.all || (can(actor, 'hr.approve') && s.team.includes(userId));
}
