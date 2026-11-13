import type { Db, Tx } from '@mono/db';
import { DEFAULT_BRANCH_RULES, branchRulesSchema, localDate, type BranchRules } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { branchOf, hospOf, need } from '../hosp/access';
import type { Actor } from '../work/actor';

/**
 * Phase 18 — what banquets, the bar register and compliance share: a branch with its clock and its own rules,
 * and who may do what (sales and the floor: hosp.create; managers: hosp.edit; set-up: hosp.admin).
 */
export type Place = {
  companyId: string;
  branchId: string;
  name: string;
  tz: string;
  today: string;
  rules: BranchRules;
};
export const sales = (a: Actor) => need(a, 'hosp.create', "You can't do this in hospitality");
export const manager = (a: Actor) => need(a, 'hosp.edit', 'Only a manager does this');
export const admin = (a: Actor) => need(a, 'hosp.admin', 'Only hospitality admins change this set-up');
export const seer = (a: Actor) => need(a, 'hosp.view', "You can't see hospitality");

export async function placeFor(db: Db | Tx, companyId: string, branchId: string): Promise<Place> {
  const branch = await db.branch.findFirst({ where: { id: branchId, companyId, deletedAt: null } });
  if (!branch) throw notFound('Branch');
  if (!(await hospOf(db, companyId)).enabled)
    throw new AppError(409, 'CONFLICT', 'Hospitality is not switched on for this company');
  const company = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true },
  });
  const tz = branch.timezone ?? company.timezone;
  const row = await db.branchRule.findUnique({ where: { branchId } });
  const parsed = branchRulesSchema.safeParse(row?.rules ?? {});
  return {
    companyId,
    branchId,
    name: branch.name,
    tz,
    today: localDate(new Date(), tz),
    rules: parsed.success ? parsed.data : DEFAULT_BRANCH_RULES,
  };
}
/** The branch, for a signed-in person: it must be one of theirs. */
export async function placeOf(db: Db | Tx, actor: Actor, branchId: string): Promise<Place> {
  await branchOf(db, actor.companyId, branchId);
  return placeFor(db, actor.companyId, branchId);
}
export const dmy = (day: string) => day.split('-').reverse().join('/');
export const lockBranch = (tx: Tx, key: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
