import type { Db, Tx } from '@mono/db';
import { bandOf, localDate, moveSchema, worseBand, zonedToUtc, type Band, type MoveType } from '@mono/shared';
import { z } from 'zod';
import type { ActorContext } from '../../lib/audit';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { canApprove, ctxOf, imsRulesOf, need, peoplePayload } from './access';

export const tzOf = async (db: Db | Tx, companyId: string) =>
  (await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { timezone: true } })).timezone;
const n = (d: unknown) => (d === null || d === undefined ? null : Number(d));
export const show = (q: number) => String(Math.round(q * 1000) / 1000);

/** A move as the API sends it (money as a string of paise, quantities as numbers). */
export const moveView = (m: {
  id: string;
  type: string;
  status: string;
  qty: unknown;
  balance: unknown;
  at: Date;
}) => ({
  id: m.id,
  type: m.type,
  status: m.status,
  qty: Number(m.qty),
  balance: n(m.balance),
  at: m.at,
});

export type MoveArgs = {
  itemId: string;
  type: MoveType;
  /** The change in stock: + in, − out (0 for a transfer). */
  delta: number;
  rate?: bigint | null;
  reason?: string | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  note?: string | null;
  refType?: string | null;
  refId?: string | null;
  /** Stock on steps: the record's step row, the line's quantity, and (a reversal) the move this one undoes. */
  stepId?: string | null;
  lineQty?: number | null;
  reversesId?: string | null;
  at?: Date;
};

/**
 * Apply one move to stock in the caller's transaction. Stock can't go below zero: the check and the change are
 * one statement, so two people issuing the last unit at once can't both succeed.
 */
export async function applyMove(tx: Tx, ctx: ActorContext, a: MoveArgs, moveId?: string) {
  const item = await tx.item.findFirst({ where: { id: a.itemId, companyId: ctx.companyId } });
  if (!item || item.deletedAt) throw new AppError(404, 'NOT_FOUND', 'Item not found');
  if (a.delta !== 0) {
    const done = await tx.item.updateMany({
      where: { id: item.id, ...(a.delta < 0 ? { stock: { gte: -a.delta } } : {}) },
      data: { stock: { increment: a.delta } },
    });
    if (!done.count)
      throw new AppError(
        409,
        'CONFLICT',
        `Only ${show(Number(item.stock))} ${item.unit} of ${item.name} in stock`,
      );
  }
  const after = await tx.item.findUniqueOrThrow({ where: { id: item.id } });
  const stock = Number(after.stock);
  const band = bandOf(stock, n(after.maxQty), n(after.minQty));
  const at = a.at ?? new Date();
  await tx.item.update({
    where: { id: item.id },
    data: {
      band,
      lastMovedAt: at,
      ...(a.type === 'TRANSFER' && a.toLocation ? { location: a.toLocation } : {}),
      // An item with no rate yet takes its first receipt's rate.
      ...(a.type === 'IN' && a.rate && !after.rate ? { rate: a.rate } : {}),
    },
  });
  const data = {
    type: a.type,
    qty: a.delta,
    rate: a.rate ?? after.rate,
    reason: a.reason ?? null,
    fromLocation: a.fromLocation ?? (a.type === 'TRANSFER' ? item.location : null),
    toLocation: a.toLocation ?? null,
    note: a.note ?? null,
    refType: a.refType ?? null,
    refId: a.refId ?? null,
    stepId: a.stepId ?? null,
    lineQty: a.lineQty ?? null,
    reversesId: a.reversesId ?? null,
    status: 'APPLIED',
    balance: stock,
    at,
  };
  const move = moveId
    ? await tx.stockMove.update({ where: { id: moveId }, data: { status: 'APPLIED', balance: stock } })
    : await tx.stockMove.create({
        data: { companyId: ctx.companyId, itemId: item.id, createdById: ctx.actorId, ...data },
      });
  await snapshot(tx, ctx.companyId, item.id, stock, band, localDate(at, await tzOf(tx, ctx.companyId)));
  await emitEvent(tx, ctx, {
    name: 'ims.stock_moved',
    entityType: 'item',
    entityId: item.id,
    payload: {
      moveId: move.id,
      code: item.code,
      item: item.name,
      unit: item.unit,
      type: a.type,
      qty: a.delta,
      stock,
      band,
      reason: a.reason ?? null,
      refType: a.refType ?? null,
      refId: a.refId ?? null,
      at: at.toISOString(),
    },
  });
  await bandAlert(tx, ctx, after, item.band as Band, band, stock);
  return { move, stock, band };
}

/** Today's snapshot keeps the worst band the day saw. */
export async function snapshot(
  tx: Tx | Db,
  companyId: string,
  itemId: string,
  qty: number,
  band: Band,
  date: string,
) {
  const had = await tx.stockSnapshot.findUnique({ where: { itemId_date: { itemId, date } } });
  const worst = had ? worseBand(had.band as Band, band) : band;
  await tx.stockSnapshot.upsert({
    where: { itemId_date: { itemId, date } },
    create: { companyId, itemId, date, qty, band: worst },
    update: { qty, band: worst },
  });
}

/** Turning red tells purchase (with the quantity to order); going over MAX tells the reviewer. */
async function bandAlert(
  tx: Tx,
  ctx: ActorContext,
  item: { id: string; name: string; unit: string; maxQty: unknown },
  was: Band,
  now: Band,
  stock: number,
) {
  if (was === now || (now !== 'red' && now !== 'purple')) return;
  const rules = await imsRulesOf(tx, ctx.companyId);
  const max = n(item.maxQty) ?? 0;
  await emitEvent(tx, ctx, {
    name: now === 'red' ? 'ims.below_min' : 'ims.above_max',
    entityType: 'item',
    entityId: item.id,
    payload: {
      ...peoplePayload(rules),
      item: item.name,
      stock: `${show(stock)} ${item.unit}`,
      max: `${show(max)} ${item.unit}`,
      qty: `${show(Math.max(0, max - stock))} ${item.unit}`,
      link: now === 'red' ? '/ims/purchase' : '/ims/max-review',
    },
  });
}

/** A move typed by the store: in, out and transfers apply at once; an adjustment waits for an approver. */
export async function postMove(db: Db, actor: Actor, input: z.input<typeof moveSchema>) {
  need(actor, 'ims.create', "You can't enter stock moves");
  const m = moveSchema.parse(input);
  const at = m.at ? new Date(m.at) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000)
    throw new AppError(400, 'VALIDATION_FAILED', "A move can't be in the future");
  const item = await db.item.findFirst({
    where: { id: m.itemId, companyId: actor.companyId, deletedAt: null },
  });
  if (!item) throw notFound('Item');
  if (!item.active) throw new AppError(409, 'CONFLICT', `${item.name} is switched off`);
  const ctx = ctxOf(actor);
  if (m.type === 'ADJUST') {
    if (m.qty < 0 && -m.qty > Number(item.stock))
      throw new AppError(
        409,
        'CONFLICT',
        `Only ${show(Number(item.stock))} ${item.unit} of ${item.name} in stock`,
      );
    const rules = await imsRulesOf(db, actor.companyId);
    return db.$transaction(async (tx) => {
      const move = await tx.stockMove.create({
        data: {
          companyId: actor.companyId,
          itemId: item.id,
          type: 'ADJUST',
          qty: m.qty,
          rate: item.rate,
          reason: m.reason!,
          note: m.note ?? null,
          status: 'PENDING',
          at,
          createdById: actor.userId,
        },
      });
      await writeAudit(tx, ctx, {
        action: 'ims.adjust_asked',
        entityType: 'stock_move',
        entityId: move.id,
        after: m,
      });
      await emitEvent(tx, ctx, {
        name: 'ims.adjustment_approval',
        entityType: 'stock_move',
        entityId: move.id,
        payload: {
          ...peoplePayload(rules),
          item: item.name,
          qty: `${m.qty > 0 ? '+' : ''}${show(m.qty)} ${item.unit}`,
          reason: m.reason!.toLowerCase(),
          link: '/ims/stock?tab=approvals',
        },
      });
      return { move: moveView(move), pending: true };
    });
  }
  const delta = m.type === 'IN' ? m.qty : m.type === 'OUT' ? -m.qty : 0;
  return db.$transaction(async (tx) => {
    const r = await applyMove(tx, ctx, {
      itemId: item.id,
      type: m.type,
      delta,
      rate: m.ratePaise !== null && m.ratePaise !== undefined ? BigInt(m.ratePaise) : null,
      fromLocation: m.fromLocation,
      toLocation: m.toLocation,
      note: m.note,
      at,
    });
    await writeAudit(tx, ctx, {
      action: 'ims.move',
      entityType: 'stock_move',
      entityId: r.move.id,
      after: m,
    });
    return { move: moveView(r.move), stock: r.stock, band: r.band, pending: false };
  });
}

export const sheetQuery = z.object({
  itemId: z.string().optional(),
  type: z.enum(['IN', 'OUT', 'TRANSFER', 'ADJUST']).optional(),
  status: z.enum(['APPLIED', 'PENDING', 'REJECTED']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** The IMS sheet: every in and out in one list, newest first (at most 500). */
export async function listMoves(db: Db, actor: Actor, q: z.infer<typeof sheetQuery>) {
  need(actor, 'ims.view', "You can't see stock");
  const tz = await tzOf(db, actor.companyId);
  const at =
    q.from || q.to
      ? {
          ...(q.from ? { gte: zonedToUtc(q.from, 0, tz) } : {}),
          ...(q.to ? { lt: zonedToUtc(q.to, 24 * 60, tz) } : {}),
        }
      : undefined;
  const moves = await db.stockMove.findMany({
    where: { companyId: actor.companyId, itemId: q.itemId, type: q.type, status: q.status, at },
    orderBy: { at: 'desc' },
    take: 500,
    include: { item: { select: { code: true, name: true, unit: true } } },
  });
  const ids = [
    ...new Set(moves.flatMap((m) => [m.createdById, m.decidedById]).filter((x): x is string => Boolean(x))),
  ];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [
      u.id,
      u.name,
    ]),
  );
  const rules = await imsRulesOf(db, actor.companyId);
  const mayApprove = await canApprove(db, actor, rules);
  return moves.map((m) => ({
    id: m.id,
    at: m.at,
    type: m.type,
    status: m.status,
    qty: Number(m.qty),
    balance: n(m.balance),
    ratePaise: m.rate?.toString() ?? null,
    reason: m.reason,
    note: m.note,
    fromLocation: m.fromLocation,
    toLocation: m.toLocation,
    refType: m.refType,
    refId: m.refId,
    stepId: m.stepId,
    lineQty: n(m.lineQty),
    reversal: Boolean(m.reversesId),
    item: { id: m.itemId, ...m.item },
    by: m.createdById ? (names.get(m.createdById) ?? null) : null,
    decidedBy: m.decidedById ? (names.get(m.decidedById) ?? null) : null,
    canDecide:
      m.status === 'PENDING' &&
      mayApprove &&
      !(rules.people.neverOwn && m.createdById === actor.userId) &&
      !m.approvals.includes(actor.userId),
  }));
}

export const canSeeStock = (actor: Actor) => can(actor, 'ims.view');
