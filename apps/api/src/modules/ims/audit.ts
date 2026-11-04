import type { Db } from '@mono/db';
import { addDays, countMachine, daysBetween, formatINR, localDate, transition } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { claimMark } from '../ea/jobs';
import { can, type Actor } from '../work/actor';
import { ctxOf, imsRulesOf, need, peoplePayload } from './access';
import { tzOf } from './moves';

/** Audit cycles are counted from Monday 05/01/2026, every N days (no stored state). */
const ANCHOR = '2026-01-05';
export const cycleOf = (today: string, days: number) =>
  addDays(ANCHOR, Math.floor(daysBetween(ANCHOR, today) / days) * days);

/** Open this cycle's counts: the top N items by stock value (§10.1), once per cycle. */
export async function openCycle(db: Db, companyId: string, now = new Date()) {
  const rules = await imsRulesOf(db, companyId);
  const cycle = cycleOf(localDate(now, await tzOf(db, companyId)), rules.audit.cycleDays);
  if (await db.auditCount.count({ where: { companyId, cycle } })) return { cycle, opened: 0 };
  const items = await db.item.findMany({
    where: { companyId, deletedAt: null, active: true, stock: { gt: 0 } },
    select: { id: true, stock: true, rate: true },
  });
  const top = items
    .map((i) => ({ id: i.id, value: Number(i.stock) * Number(i.rate) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, rules.audit.topByValue);
  if (!top.length) return { cycle, opened: 0 };
  await db.auditCount.createMany({
    data: top.map((t) => ({ companyId, itemId: t.id, cycle })),
    skipDuplicates: true,
  });
  return { cycle, opened: top.length };
}

const isAuditor = async (db: Db, actor: Actor) =>
  can(actor, 'ims.edit') || (await imsRulesOf(db, actor.companyId)).people.auditIds.includes(actor.userId);

export async function listCounts(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const rules = await imsRulesOf(db, actor.companyId);
  const today = localDate(new Date(), await tzOf(db, actor.companyId));
  const cycle = cycleOf(today, rules.audit.cycleDays);
  const rows = await db.auditCount.findMany({
    where: { companyId: actor.companyId, cycle },
    include: {
      item: { select: { code: true, name: true, unit: true, stock: true, rate: true, location: true } },
    },
    orderBy: { item: { code: 'asc' } },
  });
  const counts = rows.map((r) => ({
    id: r.id,
    status: r.status,
    item: {
      id: r.itemId,
      code: r.item.code,
      name: r.item.name,
      unit: r.item.unit,
      location: r.item.location,
    },
    systemQty: r.systemQty === null ? null : Number(r.systemQty),
    countedQty: r.countedQty === null ? null : Number(r.countedQty),
    differencePaise:
      r.countedQty === null || r.systemQty === null
        ? null
        : String(Math.round((Number(r.countedQty) - Number(r.systemQty)) * Number(r.item.rate))),
    countedAt: r.countedAt,
    note: r.note,
    moveId: r.moveId,
  }));
  return {
    cycle,
    nextCycle: addDays(cycle, rules.audit.cycleDays),
    counts,
    done: counts.filter((c) => c.status !== 'OPEN').length,
    canCount: await isAuditor(db, actor),
  };
}

export const countSchema = z.object({
  countedQty: z.number().min(0).max(1e9).optional(),
  skip: z.boolean().default(false),
  note: z.string().trim().max(500).nullish(),
});

/** Record a count. A difference becomes a COUNT adjustment that waits for an approver like any other. */
export async function recordCount(db: Db, actor: Actor, id: string, input: z.input<typeof countSchema>) {
  if (!(await isAuditor(db, actor))) throw new AppError(403, 'FORBIDDEN', "You aren't an audit coordinator");
  const c = countSchema.parse(input);
  if (!c.skip && c.countedQty === undefined)
    throw new AppError(400, 'VALIDATION_FAILED', 'How many did you count?');
  const row = await db.auditCount.findFirst({
    where: { id, companyId: actor.companyId },
    include: { item: true },
  });
  if (!row) throw notFound('Count');
  const to = transition(countMachine, {
    from: row.status as 'OPEN',
    action: c.skip ? 'skip' : 'count',
    roles: ['auditor'],
    ctx: {},
  }).to;
  const rules = await imsRulesOf(db, actor.companyId);
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const item = await tx.item.findUniqueOrThrow({ where: { id: row.itemId } });
    const system = Number(item.stock);
    const diff = c.skip ? 0 : Math.round((c.countedQty! - system) * 1000) / 1000;
    let moveId: string | null = null;
    if (diff !== 0) {
      const move = await tx.stockMove.create({
        data: {
          companyId: actor.companyId,
          itemId: item.id,
          type: 'ADJUST',
          qty: diff,
          rate: item.rate,
          reason: 'COUNT',
          note: c.note ?? `Audit count ${row.cycle}`,
          status: 'PENDING',
          refType: 'audit_count',
          refId: row.id,
          createdById: actor.userId,
        },
      });
      moveId = move.id;
      await emitEvent(tx, ctx, {
        name: 'ims.adjustment_approval',
        entityType: 'stock_move',
        entityId: move.id,
        payload: {
          ...peoplePayload(rules),
          item: item.name,
          qty: `${diff > 0 ? '+' : ''}${diff} ${item.unit}`,
          reason: 'audit count',
          link: '/ims/stock?tab=approvals',
        },
      });
    }
    await tx.auditCount.update({
      where: { id },
      data: {
        status: to,
        systemQty: c.skip ? null : system,
        countedQty: c.skip ? null : c.countedQty!,
        countedById: actor.userId,
        countedAt: new Date(),
        note: c.note ?? null,
        moveId,
      },
    });
    await writeAudit(tx, ctx, {
      action: c.skip ? 'ims.count_skipped' : 'ims.counted',
      entityType: 'audit_count',
      entityId: id,
      after: { ...c, system, diff },
    });
    return { status: to, difference: diff, adjustmentId: moveId };
  });
}

/** Dead stock (§10.1): stock that hasn't moved for N days, with its value. */
export async function deadStock(db: Db, companyId: string, now = new Date()) {
  const rules = await imsRulesOf(db, companyId);
  const before = new Date(now.getTime() - rules.audit.deadAfterDays * 86_400_000);
  const items = await db.item.findMany({
    where: {
      companyId,
      deletedAt: null,
      stock: { gt: 0 },
      OR: [{ lastMovedAt: { lt: before } }, { lastMovedAt: null, createdAt: { lt: before } }],
    },
    orderBy: { code: 'asc' },
  });
  const rows = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    unit: i.unit,
    location: i.location,
    stock: Number(i.stock),
    lastMovedAt: i.lastMovedAt,
    valuePaise: String(Math.round(Number(i.stock) * Number(i.rate))),
  }));
  return {
    days: rules.audit.deadAfterDays,
    items: rows,
    valuePaise: String(rows.reduce((s, r) => s + Number(r.valuePaise), 0)),
  };
}

export async function deadStockFor(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  return deadStock(db, actor.companyId);
}

/** Once a month the owner hears about dead stock (if there is any). */
export async function deadStockAlert(db: Db, companyId: string, now = new Date()) {
  const month = localDate(now, await tzOf(db, companyId)).slice(0, 7);
  const dead = await deadStock(db, companyId, now);
  if (!dead.items.length || !(await claimMark(db, companyId, `ims.dead:${month}`))) return false;
  const rules = await imsRulesOf(db, companyId);
  await db.$transaction((tx) =>
    emitEvent(
      tx,
      { companyId, actorId: null },
      {
        name: 'ims.dead_stock',
        entityType: 'ims_rules',
        entityId: companyId,
        payload: {
          ...peoplePayload(rules),
          count: dead.items.length,
          days: dead.days,
          value: formatINR(dead.valuePaise, { compact: true }),
          link: '/ims/audit?tab=dead',
        },
      },
    ),
  );
  return true;
}
