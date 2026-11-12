import { chainFor, mayDecide } from '../branches/approvals';
import type { Db, Tx } from '@mono/db';
import { DEFAULT_IMS_RULES, imsRulesPatchSchema, imsRulesSchema, type ImsRules } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';

export async function imsRulesOf(db: Db | Tx, companyId: string): Promise<ImsRules> {
  const row = await db.imsRules.findUnique({ where: { companyId } });
  const parsed = imsRulesSchema.safeParse(row?.rules ?? {});
  return parsed.success ? parsed.data : DEFAULT_IMS_RULES;
}

export const need = (actor: Actor, key: Parameters<typeof can>[1], message: string) => {
  if (!can(actor, key)) throw new AppError(403, 'FORBIDDEN', message);
};
export const ctxOf = (actor: Actor) => ({ ...actor, actorId: actor.userId });

export async function isOwner(db: Db | Tx, actor: Actor) {
  if (actor.permissions.includes('*')) return true;
  const u = await db.user.findFirst({
    where: { id: actor.userId },
    select: { role: { select: { key: true } } },
  });
  return u?.role.key === 'OWNER';
}

export type RoutedMove = { createdById: string | null; qty: unknown; rate: bigint | null; createdAt: Date };
const routeRequest = (m: RoutedMove) => ({
  requesterId: m.createdById ?? '',
  // Rupees: the quantity at the item's rate.
  amount: (Math.abs(Number(m.qty)) * Number(m.rate ?? 0n)) / 100,
  askedAt: m.createdAt,
});

/**
 * The owner's approval route for stock adjustments (phase 12), when one is set: true / false for this person,
 * null when there is no route and the inventory rules below decide.
 */
export const routedApprove = (db: Db | Tx, actor: Actor, move: RoutedMove) =>
  mayDecide(db, actor, 'ims.adjustment', routeRequest(move));

/** The people a new adjustment is sent to under the route (null without one). */
export async function routedApprovers(db: Db | Tx, companyId: string, move: RoutedMove) {
  const chain = await chainFor(db, companyId, 'ims.adjustment', routeRequest(move));
  return chain ? chain.first : null;
}

/**
 * Who may approve a stock adjustment (§10.2): the listed approvers (anyone with ims.approve when none are
 * listed), and the owner always when the rule says so. "Never their own" is the machine's guard.
 */
export async function canApprove(db: Db | Tx, actor: Actor, rules: ImsRules, move?: RoutedMove) {
  const byRoute = move ? await routedApprove(db, actor, move) : null;
  if (byRoute !== null) return byRoute;
  const p = rules.people;
  if (p.ownerAlways && (await isOwner(db, actor))) return true;
  if (p.approverIds.length) return p.approverIds.includes(actor.userId);
  return can(actor, 'ims.approve');
}

export async function readImsRules(db: Db, companyId: string) {
  const row = await db.imsRules.findUnique({ where: { companyId } });
  return { rules: await imsRulesOf(db, companyId), saved: Boolean(row), updatedAt: row?.updatedAt ?? null };
}

/** Save one or more rule sets (only what is sent changes). People named must be active in the company. */
export async function saveImsRules(db: Db, actor: Actor, input: unknown) {
  need(actor, 'ims.admin', 'Only inventory admins change the rules');
  const patch = imsRulesPatchSchema.parse(input);
  const current = await imsRulesOf(db, actor.companyId);
  const rules = imsRulesSchema.parse({
    stock: { ...current.stock, ...patch.stock },
    max: { ...current.max, ...patch.max },
    ows: { ...current.ows, ...patch.ows },
    turns: { ...current.turns, ...patch.turns },
    audit: { ...current.audit, ...patch.audit },
    people: { ...current.people, ...patch.people },
  });
  const p = rules.people;
  const ids = [
    ...new Set([...p.storeKeeperIds, ...p.purchaseIds, ...p.reviewerIds, ...p.auditIds, ...p.approverIds]),
  ];
  if (ids.length) {
    const found = await db.user.count({
      where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null, status: 'ACTIVE' },
    });
    if (found !== ids.length)
      throw new AppError(400, 'VALIDATION_FAILED', 'Someone chosen is not an active person in the company');
  }
  await db.$transaction(async (tx) => {
    const before = await tx.imsRules.findUnique({ where: { companyId: actor.companyId } });
    await tx.imsRules.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, rules: rules as object, updatedById: actor.userId },
      update: { rules: rules as object, updatedById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.rules_saved',
      entityType: 'ims_rules',
      entityId: actor.companyId,
      before: before?.rules ?? null,
      after: rules,
    });
  });
  return readImsRules(db, actor.companyId);
}

/** Notification recipients from the rules (payload keys the rule recipients read). */
export const peoplePayload = (rules: ImsRules) => ({
  purchaseIds: rules.people.purchaseIds,
  reviewerIds: rules.people.reviewerIds,
  approverIds: rules.people.approverIds,
  storeIds: rules.people.storeKeeperIds,
  auditIds: rules.people.auditIds,
});

/**
 * A stock line of a process step waits for a decision (not enough stock, or a reversal that can't be applied):
 * tell the approvers and the store keepers, with the notice adjustments already use.
 */
export async function askApprovers(
  tx: Tx,
  ctx: { companyId: string; actorId: string | null },
  moveId: string,
  text: { item: string; qty: string; reason: string },
) {
  const people = peoplePayload(await imsRulesOf(tx, ctx.companyId));
  await emitEvent(tx, ctx, {
    name: 'ims.adjustment_approval',
    entityType: 'stock_move',
    entityId: moveId,
    payload: {
      ...people,
      approverIds: [...new Set([...people.approverIds, ...people.storeIds])],
      ...text,
      link: '/ims/stock?tab=approvals',
    },
  });
}
