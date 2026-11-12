import type { Db } from '@mono/db';
import { closingCountMachine, transition, varianceOf, type ClosingCountStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import type { Actor } from '../work/actor';
import { canApprove, ctxOf, imsRulesOf, need, peoplePayload } from './access';
import { applyMove } from './moves';
import { clockOf, needPlace, num, paperNumber, r3, reachPlaces } from './v2';

/**
 * Phase 13 — closing counts per location (daily for a bar or kitchen, weekly or monthly for a store). A blind
 * count hides the system figure from the counter. Submitting compares each count with the system and with what
 * the recipes say should have been used since the last count (theoretical): the difference is the variance,
 * flagged above the company's limit. A count with differences waits for a stock approver; approving it brings
 * the stock to what was counted.
 */
export type CountLine = {
  itemId: string;
  system: number | null;
  counted: number | null;
  diff: number | null;
  theoretical: number | null;
  pct: number | null;
  flagged: boolean;
};
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const openCountSchema = z.object({
  locationId: z.string().default(''),
  date: day.optional(),
  blind: z.boolean().default(false),
  /** Left out: everything the location holds or has a level for. */
  itemIds: z.array(z.string()).max(2000).optional(),
  note: z.string().trim().max(500).nullish(),
});

async function heldAt(db: Db, companyId: string, locationId: string) {
  const out = new Map<string, number>();
  for (const b of await db.stockBalance.findMany({ where: { companyId, locationId } }))
    out.set(b.itemId, r3((out.get(b.itemId) ?? 0) + num(b.qty)));
  return out;
}

export async function openCount(db: Db, actor: Actor, input: z.input<typeof openCountSchema>) {
  need(actor, 'ims.create', "You can't count stock");
  const c = openCountSchema.parse(input);
  const place = await needPlace(db, actor.companyId, c.locationId);
  if (
    await db.stockCount.count({
      where: { companyId: actor.companyId, locationId: place.id, status: { in: ['OPEN', 'SUBMITTED'] } },
    })
  )
    throw new AppError(409, 'CONFLICT', `${place.name} already has a count that is not finished`);
  const held = await heldAt(db, actor.companyId, place.id);
  const levels = await db.parLevel.findMany({
    where: { companyId: actor.companyId, locationId: place.id },
    select: { itemId: true },
  });
  const ids = c.itemIds ?? [
    ...new Set([
      ...[...held.entries()].filter(([, q]) => q !== 0).map(([id]) => id),
      ...levels.map((l) => l.itemId),
    ]),
  ];
  const known = await db.item.findMany({
    where: { companyId: actor.companyId, id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  if (!known.length) throw new AppError(409, 'CONFLICT', `${place.name} holds nothing to count`);
  const { today } = await clockOf(db, actor.companyId);
  const lines: CountLine[] = known.map((i) => ({
    itemId: i.id,
    system: null,
    counted: null,
    diff: null,
    theoretical: null,
    pct: null,
    flagged: false,
  }));
  return db.$transaction(async (tx) => {
    const row = await tx.stockCount.create({
      data: {
        companyId: actor.companyId,
        number: await paperNumber(tx, actor.companyId, 'CNT'),
        locationId: place.id,
        date: c.date ?? today,
        blind: c.blind,
        lines,
        note: c.note ?? null,
        createdById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.count_opened',
      entityType: 'stock_count',
      entityId: row.id,
      after: c,
    });
    return { id: row.id, number: row.number };
  });
}

async function load(db: Db, actor: Actor, id: string) {
  const row = await db.stockCount.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw notFound('Count');
  const place = await needPlace(db, actor.companyId, row.locationId);
  return { row, place, lines: row.lines as CountLine[] };
}

export const countLinesSchema = z.object({
  lines: z
    .array(z.object({ itemId: z.string(), counted: z.number().min(0).max(1e9) }))
    .min(1)
    .max(2000),
});
/** Save what has been counted so far (the count stays open). */
export async function saveCountLines(
  db: Db,
  actor: Actor,
  id: string,
  input: z.input<typeof countLinesSchema>,
) {
  need(actor, 'ims.create', "You can't count stock");
  const c = countLinesSchema.parse(input);
  const { row, lines } = await load(db, actor, id);
  if (row.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This count is already submitted');
  for (const l of c.lines) {
    const line = lines.find((x) => x.itemId === l.itemId);
    if (!line) throw new AppError(400, 'VALIDATION_FAILED', 'An item is not on this count');
    line.counted = r3(l.counted);
  }
  await db.stockCount.update({ where: { id }, data: { lines } });
  return getCount(db, actor, id);
}

/** What the recipes and sales took from a location since a moment: the theoretical use per item. */
async function theoreticalSince(db: Db, companyId: string, locationId: string, since: Date) {
  const moves = await db.stockMove.findMany({
    where: {
      companyId,
      locationId,
      status: 'APPLIED',
      type: 'OUT',
      reason: { in: ['RECIPE', 'SALE', 'PRODUCTION'] },
      at: { gte: since },
    },
    select: { itemId: true, qty: true },
  });
  const out = new Map<string, number>();
  for (const m of moves) out.set(m.itemId, r3((out.get(m.itemId) ?? 0) + Math.abs(num(m.qty))));
  return out;
}

export async function submitCount(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.create', "You can't count stock");
  const { row, place, lines } = await load(db, actor, id);
  if (lines.some((l) => l.counted === null))
    throw new AppError(
      400,
      'VALIDATION_FAILED',
      'Every item on the count needs a figure (0 when there is none)',
    );
  const rules = await imsRulesOf(db, actor.companyId);
  const last = await db.stockCount.findFirst({
    where: { companyId: actor.companyId, locationId: place.id, status: 'APPROVED' },
    orderBy: { submittedAt: 'desc' },
  });
  const since = last?.submittedAt ?? new Date(Date.now() - 30 * 86_400_000);
  const held = await heldAt(db, actor.companyId, place.id);
  const used = await theoreticalSince(db, actor.companyId, place.id, since);
  for (const l of lines) {
    const system = held.get(l.itemId) ?? 0;
    const v = varianceOf(system, l.counted!, used.get(l.itemId) ?? 0, rules.stock.varianceFlagPct);
    Object.assign(l, { system, theoretical: used.get(l.itemId) ?? 0, ...v });
  }
  const differences = lines.some((l) => l.diff !== 0);
  const status = transition(closingCountMachine, {
    from: row.status as ClosingCountStatus,
    action: 'submit',
    roles: ['counter'],
    ctx: { differences },
  }).to;
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    await tx.stockCount.update({
      where: { id },
      data: {
        status,
        lines,
        submittedById: actor.userId,
        submittedAt: new Date(),
        ...(status === 'APPROVED' ? { decidedAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: 'ims.count_submitted',
      entityType: 'stock_count',
      entityId: id,
      after: { status, flagged: lines.filter((l) => l.flagged).length },
    });
    if (differences)
      await emitEvent(tx, ctx, {
        name: 'ims.adjustment_approval',
        entityType: 'stock_count',
        entityId: id,
        payload: {
          ...peoplePayload(rules),
          item: `${row.number} at ${place.name}`,
          qty: `${lines.filter((l) => l.diff !== 0).length} items differ`,
          reason: 'closing count',
          branchId: place.branchId,
          link: '/ims/counts',
        },
      });
  });
  return getCount(db, actor, id);
}

/** A stock approver accepts the count (stock becomes what was counted) or sends it back as wrong. */
export async function decideCount(
  db: Db,
  actor: Actor,
  id: string,
  action: 'approve' | 'reject',
  note?: string | null,
) {
  const { row, place, lines } = await load(db, actor, id);
  const rules = await imsRulesOf(db, actor.companyId);
  if (rules.people.neverOwn && row.submittedById === actor.userId && action === 'approve')
    throw new AppError(403, 'FORBIDDEN', "You can't approve your own count");
  const roles = (await canApprove(db, actor, rules)) ? (['approver'] as const) : [];
  const status = transition(closingCountMachine, {
    from: row.status as ClosingCountStatus,
    action,
    roles,
    ctx: { differences: true },
  }).to;
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    if (action === 'approve') {
      // The difference as it stands now: stock may have moved since the count was submitted.
      for (const l of lines) {
        if (!l.diff) continue;
        let batchId: string | null = null;
        if (l.diff > 0) {
          // Extra stock of a batch item joins the batch the location holds most of.
          const top = await tx.stockBalance.findFirst({
            where: { itemId: l.itemId, locationId: place.id, batchId: { not: '' } },
            orderBy: { qty: 'desc' },
          });
          batchId = top?.batchId ?? null;
        }
        await applyMove(tx, ctx, {
          itemId: l.itemId,
          type: 'ADJUST',
          delta: l.diff,
          reason: 'COUNT',
          locationId: place.id,
          batchId,
          note: `${row.number}: counted ${l.counted}`,
          refType: 'stock_count',
          refId: row.id,
          allowExpired: true,
        });
      }
    }
    await tx.stockCount.update({
      where: { id },
      data: { status, decidedById: actor.userId, decidedAt: new Date(), note: note ?? row.note },
    });
    await writeAudit(tx, ctx, {
      action: `ims.count_${action}`,
      entityType: 'stock_count',
      entityId: id,
      after: { status, note: note ?? null },
    });
  });
  return getCount(db, actor, id);
}

export async function getCount(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.view', "You can't see stock");
  const { row, place, lines } = await load(db, actor, id);
  const rules = await imsRulesOf(db, actor.companyId);
  const approver = await canApprove(db, actor, rules);
  const items = new Map(
    (
      await db.item.findMany({
        where: { companyId: actor.companyId, id: { in: lines.map((l) => l.itemId) } },
        select: { id: true, code: true, name: true, unit: true, rate: true },
      })
    ).map((i) => [i.id, i]),
  );
  // Blind: while it is open whoever is counting does not see what the system expects (an approver who is not
  // the counter does).
  const hide = row.blind && row.status === 'OPEN' && (!approver || row.createdById === actor.userId);
  const held = hide || row.status !== 'OPEN' ? null : await heldAt(db, actor.companyId, place.id);
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    date: row.date,
    blind: row.blind,
    location: place,
    note: row.note,
    canDecide:
      row.status === 'SUBMITTED' &&
      approver &&
      !(rules.people.neverOwn && row.submittedById === actor.userId),
    lines: lines
      .map((l) => {
        const i = items.get(l.itemId);
        return {
          ...l,
          system: hide ? null : (l.system ?? held?.get(l.itemId) ?? 0),
          code: i?.code ?? '',
          name: i?.name ?? '',
          unit: i?.unit ?? '',
          value: l.diff === null ? null : Math.round(l.diff * Number(i?.rate ?? 0)),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
}

export async function listCountsV2(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const rows = await db.stockCount.findMany({
    where: { companyId: actor.companyId, locationId: { in: [...mine.keys()] } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => {
    const lines = r.lines as CountLine[];
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      date: r.date,
      blind: r.blind,
      location: mine.get(r.locationId)?.name ?? '—',
      items: lines.length,
      counted: lines.filter((l) => l.counted !== null).length,
      differ: lines.filter((l) => l.diff).length,
      flagged: lines.filter((l) => l.flagged).length,
    };
  });
}
