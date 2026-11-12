import { hasRoute, mayDecide } from '../branches/approvals';
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
  /** The legal entity of their branch (phase 12): HR and pay rules can differ by entity. */
  entityId: string | null;
};

/** A person with what HR needs: their shift (or the default one), branch, department and HOD. */
export async function hrPerson(db: Db | Tx, companyId: string, userId: string): Promise<HrPerson> {
  const u = await db.user.findFirst({
    where: { id: userId, companyId, deletedAt: null },
    select: {
      id: true,
      name: true,
      branchId: true,
      branch: { select: { entityId: true } },
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
    entityId: u.branch?.entityId ?? null,
    defaultBuddyId: u.defaultBuddyId,
    hodId: hod && hod !== u.id ? hod : null,
    // Daily or weekly hours: any time of the day counts.
    shift: kind === 'shift' ? fixed : { start: 0, end: 24 * 60 },
  };
}

export const personRules = (rules: HrRules, p: HrPerson) =>
  rulesFor(rules, { id: p.id, departmentId: p.departmentId, branchId: p.branchId, entityId: p.entityId });

/** HR people: anyone with hr.admin, or the HR person named in the rules. */
export async function isHr(db: Db | Tx, actor: Actor): Promise<boolean> {
  if (can(actor, 'hr.admin')) return true;
  return (await hrRulesOf(db, actor.companyId)).leave.hrUserId === actor.userId;
}

/**
 * Whose attendance and leave someone may see and decide: HR all, an HOD their team, everyone themselves. The HR
 * person of a branch (phase 12) sees and decides for the people of that branch.
 */
export async function hrScope(
  db: Db | Tx,
  actor: Actor,
): Promise<{ all: boolean; team: string[]; branchPeople: string[] }> {
  if (await isHr(db, actor)) return { all: true, team: [], branchPeople: [] };
  const hrOf = await db.branchManager.findMany({
    where: { companyId: actor.companyId, userId: actor.userId, role: 'HR', branchId: { not: null } },
    select: { branchId: true },
  });
  const branchPeople = hrOf.length
    ? (
        await db.user.findMany({
          where: {
            companyId: actor.companyId,
            deletedAt: null,
            branchId: { in: hrOf.map((b) => b.branchId!) },
            NOT: { id: actor.userId },
          },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];
  const team = await teamOf(db, actor.companyId, actor.userId);
  return { all: false, team: [...new Set([...team, ...branchPeople])], branchPeople };
}

type Routed = { kind: 'hr.leave' | 'hr.correction'; askedAt: Date };

/**
 * May this person decide that person's request? With an approval route set by the owner (phase 12) the route
 * decides; without one, HR decides any and an HOD their team's.
 */
export async function canDecideFor(
  db: Db | Tx,
  actor: Actor,
  userId: string,
  routed?: Routed,
): Promise<boolean> {
  if (userId === actor.userId) return false;
  if (routed) {
    const byRoute = await mayDecide(db, actor, routed.kind, { requesterId: userId, askedAt: routed.askedAt });
    if (byRoute !== null) return byRoute;
  }
  const s = await hrScope(db, actor);
  return s.all || s.branchPeople.includes(userId) || (can(actor, 'hr.approve') && s.team.includes(userId));
}

/** The waiting requests of a kind this person may decide (never their own). */
export async function decidable<T extends { userId: string; createdAt: Date }>(
  db: Db | Tx,
  actor: Actor,
  kind: Routed['kind'],
  pending: (where: { not: string; in?: string[] }) => Promise<T[]>,
): Promise<T[]> {
  if (await hasRoute(db, actor.companyId, kind)) {
    const out: T[] = [];
    for (const row of await pending({ not: actor.userId }))
      if (await canDecideFor(db, actor, row.userId, { kind, askedAt: row.createdAt })) out.push(row);
    return out;
  }
  const s = await hrScope(db, actor);
  if (!s.all && !s.team.length) return [];
  return pending({ not: actor.userId, ...(s.all ? {} : { in: s.team }) });
}
