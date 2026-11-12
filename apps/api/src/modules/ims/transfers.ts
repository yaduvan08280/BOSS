import type { Db, Tx } from '@mono/db';
import { transferMachine, transition, type TransferStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { ctxOf, imsRulesOf, isOwner, need } from './access';
import { places, type Place } from './ledger';
import { toStockQtyOr400 } from './stock-entry';
import { itemsOf, num, paperNumber, r3, reachPlaces } from './v2';

/**
 * Phase 13 — indents and transfers (plan §3.6). An outlet asks a kitchen or store (an INDENT), another outlet
 * in an emergency (EMERGENCY), or a store moves stock to another branch itself (DIRECT). The supplying side
 * approves in full, in part or with a substitute; dispatch puts the goods in transit; the asker receives.
 */
export type TransferLine = {
  itemId: string;
  /** The batch or piece that travels, when the asker names one (a serial-numbered piece always does). */
  batchId?: string | null;
  /** Asked, in the stock unit, and as it was typed. */
  asked: number;
  unit: string | null;
  unitQty: number;
  approved: number | null;
  substituteItemId: string | null;
  dispatched: number;
  picks: { batchId: string; qty: number; value: number }[];
  received: number;
  damaged: number;
  short: number;
  excess: number;
  /** Transfer price per stock unit and the cost that left the supplier. */
  rate: number;
  cost: number;
};

export const routeSchema = z.object({
  toBranchId: z.string().min(1),
  category: z.string().trim().max(60).default(''),
  fromLocationId: z.string(),
  priceRule: z.enum(['COST', 'COST_PLUS', 'LIST']).default('COST'),
  percent: z.number().min(0).max(500).nullish(),
  priceListId: z.string().nullish(),
});
export async function listRoutes(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const rows = await db.supplyRoute.findMany({ where: { companyId: actor.companyId, deletedAt: null } });
  return rows.map((r) => ({ ...r, percent: r.percent === null ? null : Number(r.percent) }));
}
/** Which kitchen or store supplies a branch — for one category or (category "") everything else. */
export async function saveRoute(db: Db, actor: Actor, input: z.input<typeof routeSchema>) {
  need(actor, 'ims.admin', 'Only inventory admins set supply routes');
  const r = routeSchema.parse(input);
  if (!(await db.branch.count({ where: { id: r.toBranchId, companyId: actor.companyId, deletedAt: null } })))
    throw notFound('Branch');
  if (
    r.fromLocationId &&
    !(await db.location.count({
      where: { id: r.fromLocationId, companyId: actor.companyId, deletedAt: null },
    }))
  )
    throw notFound('Location');
  if (r.priceRule === 'COST_PLUS' && (r.percent === null || r.percent === undefined))
    throw new AppError(400, 'VALIDATION_FAILED', 'Cost plus needs a percent');
  if (
    r.priceRule === 'LIST' &&
    !(await db.priceList.count({
      where: { id: r.priceListId ?? '', companyId: actor.companyId, deletedAt: null },
    }))
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose the price list');
  return db.$transaction(async (tx) => {
    await tx.supplyRoute.updateMany({
      where: { companyId: actor.companyId, toBranchId: r.toBranchId, category: r.category, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    const row = await tx.supplyRoute.create({
      data: {
        companyId: actor.companyId,
        ...r,
        percent: r.percent ?? null,
        priceListId: r.priceListId ?? null,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.route_saved',
      entityType: 'supply_route',
      entityId: row.id,
      after: r,
    });
    return { id: row.id };
  });
}
export async function deleteRoute(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.admin', 'Only inventory admins set supply routes');
  const done = await db.supplyRoute.updateMany({
    where: { id, companyId: actor.companyId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (!done.count) throw notFound('Supply route');
  return { ok: true };
}
/** The route that supplies a branch for a category: its own, else the branch's default. */
export async function routeFor(
  db: Db | Tx,
  companyId: string,
  toBranchId: string | null,
  category: string | null,
) {
  if (!toBranchId) return null;
  const rows = await db.supplyRoute.findMany({ where: { companyId, toBranchId, deletedAt: null } });
  return (
    rows.find((r) => category && r.category.toLowerCase() === category.toLowerCase()) ??
    rows.find((r) => r.category === '') ??
    null
  );
}

export const transferSchema = z.object({
  kind: z.enum(['INDENT', 'EMERGENCY', 'DIRECT']).default('INDENT'),
  /** Who supplies; left out, the branch's supply route decides. */
  fromLocationId: z.string().optional(),
  toLocationId: z.string(),
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        qty: z.number().positive().max(1e9),
        unit: z.string().trim().max(12).nullish(),
        batchId: z.string().nullish(),
      }),
    )
    .min(1)
    .max(200),
  note: z.string().trim().max(500).nullish(),
  /** Why it is an emergency. */
  reason: z.string().trim().max(300).nullish(),
});

/** May this person act for a place: it is within their reach and they hold the right (or manage its branch). */
export async function actsFor(
  db: Db | Tx,
  actor: Actor,
  place: Place,
  right: 'ims.create' | 'ims.edit' | 'ims.approve',
) {
  if (await isOwner(db, actor)) return true;
  if (!(await reachPlaces(db, actor.companyId)).has(place.id)) return false;
  if (can(actor, right)) return true;
  return place.branchId
    ? (await db.branchManager.count({
        where: {
          companyId: actor.companyId,
          userId: actor.userId,
          branchId: place.branchId,
          role: 'MANAGER',
        },
      })) > 0
    : false;
}

export async function createTransfer(db: Db, actor: Actor, input: z.input<typeof transferSchema>) {
  const t = transferSchema.parse(input);
  const all = await reachPlaces(db, actor.companyId);
  const to = all.get(t.toLocationId);
  if (!to) throw new AppError(403, 'FORBIDDEN', 'That location is not one of yours');
  if (!(await actsFor(db, actor, to, 'ims.create')))
    throw new AppError(403, 'FORBIDDEN', "You can't ask for stock");
  if (t.kind === 'EMERGENCY' && !t.reason)
    throw new AppError(400, 'VALIDATION_FAILED', 'Say why this is an emergency');
  if (new Set(t.lines.map((l) => `${l.itemId}|${l.batchId ?? ''}`)).size !== t.lines.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'The same item is asked for twice');
  const { items } = await itemsOf(
    db,
    actor.companyId,
    t.lines.map((l) => l.itemId),
  );
  const first = items.get(t.lines[0]!.itemId)!;
  const route = await routeFor(db, actor.companyId, to.branchId, first.category);
  const fromId = t.fromLocationId ?? route?.fromLocationId;
  if (fromId === undefined)
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      `Nobody is set to supply ${to.branch ?? to.name}: choose who to ask`,
    );
  // The supplier is looked up among every place of the company: an outlet may ask a kitchen it cannot see into.
  const from = (await places(db, actor.companyId)).get(fromId);
  if (!from || from.id === to.id) throw new AppError(400, 'VALIDATION_FAILED', 'Choose who supplies it');
  const price = route && route.fromLocationId === from.id ? route : null;
  const lines: TransferLine[] = t.lines.map((l) => ({
    itemId: l.itemId,
    batchId: l.batchId ?? null,
    asked: toStockQtyOr400(items.get(l.itemId)!, l.qty, l.unit),
    unit: l.unit ?? null,
    unitQty: l.qty,
    approved: t.kind === 'DIRECT' ? toStockQtyOr400(items.get(l.itemId)!, l.qty, l.unit) : null,
    substituteItemId: null,
    dispatched: 0,
    picks: [],
    received: 0,
    damaged: 0,
    short: 0,
    excess: 0,
    rate: 0,
    cost: 0,
  }));
  // A store's own transfer needs nobody's yes — but only the supplying side can raise one.
  if (t.kind === 'DIRECT' && !(await actsFor(db, actor, from, 'ims.edit')))
    throw new AppError(403, 'FORBIDDEN', `Only ${from.name}'s people can send its stock`);
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const row = await tx.stockTransfer.create({
      data: {
        companyId: actor.companyId,
        number: await paperNumber(tx, actor.companyId, 'IND'),
        kind: t.kind,
        status: t.kind === 'DIRECT' ? 'APPROVED' : 'REQUESTED',
        fromLocationId: from.id,
        toLocationId: to.id,
        fromBranchId: from.branchId,
        toBranchId: to.branchId,
        lines,
        priceRule: price?.priceRule ?? 'COST',
        percent: price?.percent ?? null,
        priceListId: price?.priceListId ?? null,
        note: t.note ?? null,
        reason: t.reason ?? null,
        requestedById: actor.userId,
        ...(t.kind === 'DIRECT' ? { approvedById: actor.userId } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: 'ims.transfer_asked',
      entityType: 'stock_transfer',
      entityId: row.id,
      after: t,
    });
    await emitEvent(tx, ctx, {
      name: 'ims.transfer_asked',
      entityType: 'stock_transfer',
      entityId: row.id,
      payload: {
        number: row.number,
        kind: t.kind,
        from: from.name,
        to: to.name,
        branchId: from.branchId,
        link: '/ims/transfers',
      },
    });
    return { id: row.id, number: row.number, status: row.status };
  });
}

export const approveSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        approved: z.number().min(0).max(1e9),
        substituteItemId: z.string().nullish(),
      }),
    )
    .max(200)
    .optional(),
  note: z.string().trim().max(500).nullish(),
});

export async function loadTransfer(db: Db | Tx, actor: Actor, id: string) {
  const row = await db.stockTransfer.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw notFound('Transfer');
  const all = await places(db, actor.companyId);
  const from = all.get(row.fromLocationId);
  const to = all.get(row.toLocationId);
  if (!from || !to) throw notFound('Location');
  const mine = await reachPlaces(db, actor.companyId);
  if (!mine.has(from.id) && !mine.has(to.id)) throw notFound('Transfer');
  return { row, from, to, lines: row.lines as TransferLine[] };
}

/** The supplying side says yes (in full, in part, or another item in its place), or no. */
export async function decideTransfer(
  db: Db,
  actor: Actor,
  id: string,
  action: 'approve' | 'reject' | 'cancel',
  input: z.input<typeof approveSchema> = {},
) {
  const a = approveSchema.parse(input);
  const { row, from, to, lines } = await loadTransfer(db, actor, id);
  const supplier = await actsFor(db, actor, from, 'ims.approve');
  const asker = row.requestedById === actor.userId || (await actsFor(db, actor, to, 'ims.approve'));
  // In an emergency the asking outlet's manager is an approver too (both sides may have to say yes).
  const toSide = row.kind === 'EMERGENCY' && (await actsFor(db, actor, to, 'ims.approve'));
  const roles = [
    ...(supplier ? (['supplier'] as const) : []),
    ...(asker ? (['asker'] as const) : []),
    ...(toSide ? (['approver'] as const) : []),
  ];
  const next = transition(transferMachine, {
    from: row.status as TransferStatus,
    action,
    roles,
    ctx: { differences: false },
  }).to;
  let approvals = row.approvals;
  let status: TransferStatus = next;
  if (action === 'approve') {
    for (const l of a.lines ?? []) {
      const line = lines.find((x) => x.itemId === l.itemId);
      if (!line) throw new AppError(400, 'VALIDATION_FAILED', 'A line is not on this request');
      if (l.approved > line.asked + 1e-9 && !l.substituteItemId)
        throw new AppError(400, 'VALIDATION_FAILED', 'More than was asked for');
      line.approved = r3(l.approved);
      line.substituteItemId = l.substituteItemId ?? null;
    }
    for (const line of lines) if (line.approved === null) line.approved = line.asked;
    const subs = lines.map((l) => l.substituteItemId).filter((x): x is string => Boolean(x));
    if (subs.length) await itemsOf(db, actor.companyId, subs);
    if (!lines.some((l) => num(l.approved) > 0))
      throw new AppError(400, 'VALIDATION_FAILED', 'Nothing is approved: reject the request instead');
    // An emergency between outlets may need a yes from both sides (the inventory rule). `approvals` keeps
    // who said yes for which side: "from:<userId>", "to:<userId>". One person who acts for both counts for both.
    if (row.kind === 'EMERGENCY') {
      const rules = await imsRulesOf(db, actor.companyId);
      const said = new Set(row.approvals);
      if (supplier) said.add(`from:${actor.userId}`);
      if (toSide) said.add(`to:${actor.userId}`);
      approvals = [...said];
      const sides = new Set(approvals.map((x) => x.split(':')[0]));
      if (rules.stock.emergencyApprovals === 'both' && sides.size < 2) status = 'REQUESTED';
    }
  }
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    await tx.stockTransfer.update({
      where: { id },
      data: {
        status,
        lines,
        approvals,
        note: a.note && action !== 'approve' ? a.note : row.note,
        ...(status === 'APPROVED' ? { approvedById: actor.userId } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: `ims.transfer_${action}`,
      entityType: 'stock_transfer',
      entityId: id,
      before: { status: row.status },
      after: { status, lines: a.lines ?? null, note: a.note ?? null },
    });
    await emitEvent(tx, ctx, {
      name: `ims.transfer_${status === 'REQUESTED' ? 'half_approved' : action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'cancelled'}`,
      entityType: 'stock_transfer',
      entityId: id,
      payload: {
        number: row.number,
        from: from.name,
        to: to.name,
        branchId: to.branchId,
        link: '/ims/transfers',
      },
    });
    return { id, status };
  });
}
