import { currentReach, type Db, type Tx } from '@mono/db';
import { DEFAULT_HOSP_RULES, hospRulesSchema, type HospRules } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/** Phase 14 — who may do what in hospitality, and which branches a person's outlets and rooms are limited to. */
export const need = (actor: Actor, key: Parameters<typeof can>[1], message: string) => {
  if (!can(actor, key)) throw new AppError(403, 'FORBIDDEN', message);
};
export const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });

export async function hospOf(
  db: Db | Tx,
  companyId: string,
): Promise<{ enabled: boolean; rules: HospRules }> {
  const row = await db.hospSettings.findUnique({ where: { companyId } });
  const parsed = hospRulesSchema.safeParse(row?.rules ?? {});
  return { enabled: row?.enabled ?? false, rules: parsed.success ? parsed.data : DEFAULT_HOSP_RULES };
}

/** The branch condition of this person's reach: null = every branch (minus `except`). */
export function branchLimit(): { only: string[] | null; except: string[] } {
  const reach = currentReach();
  return { only: reach?.branchIds ?? null, except: reach?.exceptBranchIds ?? [] };
}
export const inReach = (branchId: string | null) => {
  const { only, except } = branchLimit();
  if (!branchId) return only === null;
  return only === null ? !except.includes(branchId) : only.includes(branchId);
};
/** A Prisma condition on `branchId` for a list read. */
export function branchWhere() {
  const { only, except } = branchLimit();
  if (only) return { branchId: { in: only } };
  return except.length ? { branchId: { notIn: except } } : {};
}

export async function branchOf(db: Db | Tx, companyId: string, branchId: string) {
  const b = await db.branch.findFirst({ where: { id: branchId, companyId, deletedAt: null } });
  if (!b) throw notFound('Branch');
  if (!inReach(b.id)) throw new AppError(403, 'FORBIDDEN', 'That branch is not one of yours');
  return b;
}
export async function outletOf(db: Db | Tx, companyId: string, outletId: string) {
  const o = await db.outlet.findFirst({ where: { id: outletId, companyId, deletedAt: null } });
  if (!o || !inReach(o.branchId)) throw notFound('Outlet');
  return o;
}
