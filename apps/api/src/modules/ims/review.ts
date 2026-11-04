import type { Db } from '@mono/db';
import { addDays, averageDailyUse, bandOf, computeMax, localDate, reviewItem, type Band } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { can, type Actor } from '../work/actor';
import { ctxOf, imsRulesOf, peoplePayload } from './access';
import { snapshot, tzOf } from './moves';

const n = (d: unknown) => (d === null || d === undefined ? null : Number(d));

/** Every active item gets a snapshot for today (stock and band), so days with no moves count in the review. */
export async function snapshotAll(db: Db, companyId: string, today: string) {
  const items = await db.item.findMany({
    where: { companyId, deletedAt: null, active: true, snapshots: { none: { date: today } } },
    select: { id: true, stock: true, maxQty: true, minQty: true },
  });
  for (const i of items)
    await snapshot(
      db,
      companyId,
      i.id,
      Number(i.stock),
      bandOf(Number(i.stock), n(i.maxQty), n(i.minQty)),
      today,
    );
  return items.length;
}

/**
 * The MAX review (§10.1): items not reviewed for the review period get a proposal — the safety factor up
 * after enough red days, down after enough purple days, and MAX from the average use. The reviewer applies it.
 * Items that weren't used at all in the window keep their MAX (they show as slow or dead stock instead).
 */
export async function proposeReviews(db: Db, companyId: string, now = new Date()) {
  const rules = await imsRulesOf(db, companyId);
  const r = rules.max;
  const tz = await tzOf(db, companyId);
  const today = localDate(now, tz);
  const asOf = addDays(today, -1);
  const due = new Date(now.getTime() - r.reviewEveryDays * 86_400_000);
  const items = await db.item.findMany({
    where: {
      companyId,
      deletedAt: null,
      active: true,
      OR: [{ lastReviewAt: null }, { lastReviewAt: { lte: due } }],
      reviews: { none: { status: 'PROPOSED' } },
    },
  });
  let made = 0;
  for (const item of items) {
    const since = addDays(asOf, -r.useDays + 1);
    const outs = await db.stockMove.findMany({
      where: {
        itemId: item.id,
        type: 'OUT',
        status: 'APPLIED',
        at: { gte: new Date(Date.parse(`${since}T00:00:00Z`) - 86_400_000) },
      },
      select: { at: true, qty: true },
    });
    const daily = outs
      .map((o) => ({ date: localDate(o.at, tz), qty: -Number(o.qty) }))
      .filter((o) => o.date >= since && o.date <= asOf);
    if (!daily.length) continue;
    const bands = (
      await db.stockSnapshot.findMany({
        where: { itemId: item.id, date: { gte: addDays(today, -r.reviewEveryDays), lte: asOf } },
        select: { band: true },
      })
    ).map((s) => s.band as Band);
    const p = reviewItem({
      safetyFactor: Number(item.safetyFactor),
      leadTimeDays: item.leadTimeDays,
      minQty: n(item.minQty),
      bands,
      avgDailyUse: averageDailyUse(daily, asOf, r.useDays, localDate(item.createdAt, tz)),
      rules: r,
    });
    await db.maxReview.create({
      data: {
        companyId,
        itemId: item.id,
        avgDailyUse: p.avgDailyUse,
        redDays: p.redDays,
        purpleDays: p.purpleDays,
        change: p.change,
        safetyBefore: item.safetyFactor,
        safetyAfter: p.safetyFactor,
        maxBefore: item.maxQty,
        maxAfter: p.max,
      },
    });
    made++;
  }
  if (made)
    await db.$transaction((tx) =>
      emitEvent(
        tx,
        { companyId, actorId: null },
        {
          name: 'ims.max_review_due',
          entityType: 'ims_rules',
          entityId: companyId,
          payload: { ...peoplePayload(rules), count: made, link: '/ims/max-review' },
        },
      ),
    );
  return made;
}

const canReview = async (db: Db, actor: Actor) =>
  can(actor, 'ims.edit') || (await imsRulesOf(db, actor.companyId)).people.reviewerIds.includes(actor.userId);

export async function listReviews(db: Db, actor: Actor) {
  if (!can(actor, 'ims.view')) throw new AppError(403, 'FORBIDDEN', "You can't see stock");
  const rows = await db.maxReview.findMany({
    where: { companyId: actor.companyId, item: { deletedAt: null } },
    orderBy: [{ createdAt: 'desc' }],
    take: 300,
    include: { item: { select: { code: true, name: true, unit: true, stock: true, leadTimeDays: true } } },
  });
  const view = (x: (typeof rows)[number]) => ({
    id: x.id,
    status: x.status,
    at: x.createdAt,
    decidedAt: x.decidedAt,
    item: {
      id: x.itemId,
      code: x.item.code,
      name: x.item.name,
      unit: x.item.unit,
      stock: Number(x.item.stock),
      leadTimeDays: x.item.leadTimeDays,
    },
    avgDailyUse: Number(x.avgDailyUse),
    redDays: x.redDays,
    purpleDays: x.purpleDays,
    change: x.change,
    safetyBefore: Number(x.safetyBefore),
    safetyAfter: Number(x.safetyAfter),
    maxBefore: n(x.maxBefore),
    maxAfter: Number(x.maxAfter),
  });
  return {
    due: rows.filter((x) => x.status === 'PROPOSED').map(view),
    done: rows
      .filter((x) => x.status !== 'PROPOSED')
      .slice(0, 100)
      .map(view),
    canReview: await canReview(db, actor),
  };
}

export const applySchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  /** One review only: the reviewer's own safety factor instead of the proposal. */
  safetyFactor: z.number().min(0.5).max(10).optional(),
  skip: z.boolean().default(false),
});

/** Apply (or skip) proposals: the item takes the new safety factor and MAX; the review is done for this period. */
export async function applyReviews(db: Db, actor: Actor, input: z.input<typeof applySchema>) {
  if (!(await canReview(db, actor))) throw new AppError(403, 'FORBIDDEN', "You aren't a reviewer");
  const a = applySchema.parse(input);
  if (a.safetyFactor !== undefined && a.ids.length !== 1)
    throw new AppError(400, 'VALIDATION_FAILED', 'Set your own safety factor on one item at a time');
  const rules = await imsRulesOf(db, actor.companyId);
  const rows = await db.maxReview.findMany({
    where: { id: { in: a.ids }, companyId: actor.companyId, status: 'PROPOSED' },
    include: { item: true },
  });
  if (rows.length !== a.ids.length) throw notFound('Review');
  const now = new Date();
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      let sf = Number(r.safetyAfter);
      let max = Number(r.maxAfter);
      if (a.safetyFactor !== undefined) {
        sf = Math.max(rules.max.lowestSafety, a.safetyFactor);
        max = computeMax(Number(r.avgDailyUse), r.item.leadTimeDays, sf, n(r.item.minQty));
      }
      await tx.maxReview.update({
        where: { id: r.id },
        data: {
          status: a.skip ? 'SKIPPED' : 'APPLIED',
          decidedById: actor.userId,
          decidedAt: now,
          ...(a.skip ? {} : { safetyAfter: sf, maxAfter: max }),
        },
      });
      await tx.item.update({
        where: { id: r.itemId },
        data: {
          lastReviewAt: now,
          ...(a.skip
            ? {}
            : { safetyFactor: sf, maxQty: max, band: bandOf(Number(r.item.stock), max, n(r.item.minQty)) }),
        },
      });
    }
    await writeAudit(tx, ctxOf(actor), {
      action: a.skip ? 'ims.review_skipped' : 'ims.review_applied',
      entityType: 'max_review',
      entityId: rows[0]!.id,
      after: { ids: a.ids, safetyFactor: a.safetyFactor },
    });
  });
  return { done: rows.length };
}

/** "Review now": make the proposals for whatever is due without waiting for the morning job. */
export async function reviewNow(db: Db, actor: Actor) {
  if (!(await canReview(db, actor))) throw new AppError(403, 'FORBIDDEN', "You aren't a reviewer");
  const today = localDate(new Date(), await tzOf(db, actor.companyId));
  await snapshotAll(db, actor.companyId, today);
  return { proposed: await proposeReviews(db, actor.companyId) };
}
