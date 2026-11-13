import { nextCounter, type Db, type Tx } from '@mono/db';
import { businessDay, localDate, type HospRules, type OutletCharges } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { hospOf, outletOf } from './access';

/**
 * Phase 15 — what every POS service needs: the outlet with its clock and business day, the day's numbering,
 * who counts as an approver, and whether a day is still open.
 */
export type PosOutlet = Awaited<ReturnType<typeof outletOf>> & {
  tz: string;
  rules: HospRules;
  charges: OutletCharges;
};

export async function posOutlet(db: Db | Tx, actor: Actor, outletId: string): Promise<PosOutlet> {
  const outlet = await outletOf(db, actor.companyId, outletId);
  const h = await hospOf(db, actor.companyId);
  if (!h.enabled) throw new AppError(409, 'CONFLICT', 'Hospitality is not switched on for this company');
  const [branch, company] = await Promise.all([
    db.branch.findFirst({ where: { id: outlet.branchId }, select: { timezone: true } }),
    db.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } }),
  ]);
  return {
    ...outlet,
    tz: branch?.timezone ?? company.timezone,
    rules: h.rules,
    charges: outlet.charges as OutletCharges,
  };
}

/** The business day an instant belongs to at an outlet (before the cut-off it is still the day before). */
export function dayAt(outlet: PosOutlet, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: outlet.tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return businessDay(
    localDate(at, outlet.tz),
    (get('hour') % 24) * 60 + get('minute'),
    outlet.rules.dayClose.cutoffMin,
  );
}
/** A closed day takes nothing more: no order, bill or payment can be dated into it (reopening needs the owner). */
export async function needOpenDay(db: Db | Tx, outlet: PosOutlet, day: string) {
  const closed = await db.posDay.findUnique({
    where: { outletId_businessDay: { outletId: outlet.id, businessDay: day } },
  });
  if (closed && closed.status === 'CLOSED')
    throw new AppError(
      409,
      'CONFLICT',
      `${outlet.name}'s day ${day.split('-').reverse().join('/')} is closed`,
    );
}
/** The next number of a kind (order, ticket) at an outlet that business day. */
export const dayNumber = (tx: Tx, companyId: string, kind: 'order' | 'kot', outletId: string, day: string) =>
  nextCounter(tx, companyId, `pos.${kind}:${outletId}`, day);

export async function isOwner(db: Db | Tx, actor: Actor) {
  if (actor.permissions.includes('*')) return true;
  const u = await db.user.findFirst({
    where: { id: actor.userId },
    select: { role: { select: { key: true } } },
  });
  return u?.role.key === 'OWNER';
}
/** People who approve what is above someone's limit: the listed approvers, anyone with hosp.approve, the owner. */
export async function isApprover(db: Db | Tx, actor: Actor, rules: HospRules) {
  return rules.approverIds.includes(actor.userId) || can(actor, 'hosp.approve') || (await isOwner(db, actor));
}
export async function roleIdOf(db: Db | Tx, actor: Actor) {
  return (await db.user.findFirstOrThrow({ where: { id: actor.userId }, select: { roleId: true } })).roleId;
}

/** The guest nobody named: one "Walk-in" party a company, made the first time it is needed. */
export async function walkIn(tx: Tx, companyId: string) {
  const id = `walkin_${companyId}`;
  return (
    (await tx.party.findUnique({ where: { id } })) ??
    (await tx.party.create({
      data: { id, companyId, code: 'WALK-IN', name: 'Walk-in guest', kinds: ['guest'] },
    }))
  );
}

export async function loadOrder(db: Db | Tx, actor: Actor, orderId: string) {
  const order = await db.posOrder.findFirst({
    where: { id: orderId, companyId: actor.companyId },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  if (!order) throw notFound('Order');
  const outlet = await posOutlet(db, actor, order.outletId);
  return { order, outlet };
}
export type LoadedOrder = Awaited<ReturnType<typeof loadOrder>>['order'];
/** Items that count: not voided. `fired` = sent to the kitchen at some point. */
export const live = (o: LoadedOrder) => o.items.filter((i) => i.status !== 'VOID');
export const firedCount = (o: LoadedOrder) => live(o).filter((i) => i.status !== 'HELD').length;
