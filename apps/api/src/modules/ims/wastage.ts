import type { Db } from '@mono/db';
import { WASTE_REASONS, zonedToUtc } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { canApprove, ctxOf, imsRulesOf, need, peoplePayload, routedApprovers } from './access';
import { applyMove } from './moves';
import { resolveEntry, toStockQtyOr400 } from './stock-entry';
import { clockOf, needPlace, num, reachPlaces } from './v2';

/**
 * Phase 13 — the wastage register: spoiled, over-produced, a returned dish, breakage, staff meals,
 * complimentary. Each entry has a reason (and can carry a photo). Under the company's value limit it leaves
 * stock at once; over it, it waits for a stock approver like any other adjustment.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const wasteSchema = z
  .object({
    itemId: z.string().optional(),
    barcode: z.string().trim().max(64).optional(),
    locationId: z.string().default(''),
    batchId: z.string().optional(),
    qty: z.number().positive().max(1e9),
    unit: z.string().trim().max(12).nullish(),
    reason: z.enum(WASTE_REASONS),
    note: z.string().trim().max(500).nullish(),
    photoId: z.string().nullish(),
  })
  .refine((m) => m.itemId || m.barcode, { message: 'Choose an item or scan a code' });

export async function recordWaste(db: Db, actor: Actor, input: z.input<typeof wasteSchema>) {
  need(actor, 'ims.create', "You can't enter wastage");
  const w = wasteSchema.parse(input);
  const place = await needPlace(db, actor.companyId, w.locationId);
  const { item, batchId } = await resolveEntry(db, actor.companyId, w);
  const qty = toStockQtyOr400(item, w.qty, w.unit);
  const held = await db.stockBalance.findMany({
    where: { itemId: item.id, locationId: place.id, qty: { gt: 0 }, ...(batchId ? { batchId } : {}) },
  });
  const have = held.reduce((n, b) => n + num(b.qty), 0);
  if (qty > have + 1e-9)
    throw new AppError(
      409,
      'CONFLICT',
      `Only ${Math.round(have * 1000) / 1000} ${item.unit} of ${item.name} at ${place.name}`,
    );
  // Valued at what the location holds it at (its average), else the item's rate.
  const worth = held.reduce((n, b) => n + Number(b.value), 0);
  const value = Math.round(have > 0 && worth > 0 ? (worth / have) * qty : qty * item.rate);
  const rules = await imsRulesOf(db, actor.companyId);
  const waits = value > rules.stock.wasteApproveOverPaise;
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const base = {
      itemId: item.id,
      type: 'ADJUST' as const,
      reason: w.reason,
      note: w.note ?? null,
      refType: 'wastage',
      locationId: place.id,
      batchId: batchId ?? null,
      unit: w.unit ?? item.unit,
      unitQty: w.qty,
    };
    let moveId: string;
    if (waits) {
      const move = await tx.stockMove.create({
        data: {
          ...base,
          companyId: actor.companyId,
          qty: -qty,
          rate: BigInt(Math.round(value / qty)),
          value: BigInt(value),
          status: 'PENDING',
          createdById: actor.userId,
        },
      });
      moveId = move.id;
      const routedTo = await routedApprovers(tx, actor.companyId, move);
      await emitEvent(tx, ctx, {
        name: 'ims.adjustment_approval',
        entityType: 'stock_move',
        entityId: move.id,
        payload: {
          ...peoplePayload(rules),
          ...(routedTo ? { approverIds: routedTo } : {}),
          item: item.name,
          qty: `-${w.qty} ${w.unit ?? item.unit}`,
          reason: w.reason.toLowerCase().replace('_', ' '),
          branchId: place.branchId,
          link: '/ims/wastage',
        },
      });
    } else {
      // Waste may be of an expired batch: that is what is being thrown away.
      moveId = (await applyMove(tx, ctx, { ...base, delta: -qty, allowExpired: true })).move.id;
    }
    if (w.photoId)
      await tx.attachment.updateMany({
        where: { id: w.photoId, companyId: actor.companyId },
        data: { entityType: 'stock_move', entityId: moveId },
      });
    await writeAudit(tx, ctx, {
      action: 'ims.waste',
      entityType: 'stock_move',
      entityId: moveId,
      after: { ...w, value, waits },
    });
    return { id: moveId, value, pending: waits };
  });
}

export const wasteQuery = z.object({
  locationId: z.string().optional(),
  from: day.optional(),
  to: day.optional(),
});
/** The register, newest first, with each entry's value and who may still decide a waiting one. */
export async function wasteRegister(db: Db, actor: Actor, q: z.infer<typeof wasteQuery> = {}) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const { tz } = await clockOf(db, actor.companyId);
  const moves = await db.stockMove.findMany({
    where: {
      companyId: actor.companyId,
      refType: 'wastage',
      locationId: q.locationId !== undefined ? q.locationId : { in: [...mine.keys()] },
      ...(q.from || q.to
        ? {
            at: {
              ...(q.from ? { gte: zonedToUtc(q.from, 0, tz) } : {}),
              ...(q.to ? { lt: zonedToUtc(q.to, 24 * 60, tz) } : {}),
            },
          }
        : {}),
    },
    orderBy: { at: 'desc' },
    take: 500,
    include: { item: { select: { code: true, name: true, unit: true } } },
  });
  const rules = await imsRulesOf(db, actor.companyId);
  const photos = new Map(
    (
      await db.attachment.findMany({
        where: {
          companyId: actor.companyId,
          entityType: 'stock_move',
          entityId: { in: moves.map((m) => m.id) },
        },
        select: { id: true, entityId: true },
      })
    ).map((a) => [a.entityId, a.id]),
  );
  const people = new Map(
    (
      await db.user.findMany({
        where: { id: { in: moves.map((m) => m.createdById).filter((x): x is string => Boolean(x)) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const rows = [];
  for (const m of moves) {
    if (!mine.has(m.locationId)) continue;
    rows.push({
      id: m.id,
      at: m.at,
      item: m.item,
      qty: Math.abs(num(m.qty)),
      unit: m.unit ?? m.item.unit,
      unitQty: m.unitQty === null ? Math.abs(num(m.qty)) : num(m.unitQty),
      reason: m.reason,
      note: m.note,
      value: Math.abs(Number(m.value ?? 0n)),
      status: m.status,
      location: mine.get(m.locationId)!.name,
      by: m.createdById ? (people.get(m.createdById) ?? null) : null,
      photoId: photos.get(m.id) ?? null,
      canDecide:
        m.status === 'PENDING' &&
        (await canApprove(db, actor, rules, m)) &&
        !(rules.people.neverOwn && m.createdById === actor.userId),
    });
  }
  const byReason = new Map<string, number>();
  for (const r of rows)
    if (r.status === 'APPLIED') byReason.set(r.reason ?? '', (byReason.get(r.reason ?? '') ?? 0) + r.value);
  return { rows, byReason: [...byReason.entries()].map(([reason, value]) => ({ reason, value })) };
}
