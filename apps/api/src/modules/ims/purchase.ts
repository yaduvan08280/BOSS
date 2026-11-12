import { nextCounter, type Db } from '@mono/db';
import {
  financialYear,
  localDate,
  orderDay,
  owsLine,
  poMachine,
  transition,
  type PoStatus,
} from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { ctxOf, imsRulesOf, need } from './access';
import { onOrderOf } from './items';
import { applyMove, tzOf } from './moves';
import { homeBranchOf } from '../branches/reach';

const n = (d: unknown) => (d === null || d === undefined ? null : Number(d));

/**
 * OWS — order when short (§10.1): on the order day (the list opens N days before) every short item —
 * stock + on order below ⅔ of MAX, or under its minimum — with order qty = MAX − (stock + on order).
 */
export async function owsList(db: Db, actor: Actor, now = new Date()) {
  need(actor, 'ims.view', "You can't see stock");
  const rules = await imsRulesOf(db, actor.companyId);
  const today = localDate(now, await tzOf(db, actor.companyId));
  const day = orderDay(today, rules.ows);
  const items = await db.item.findMany({
    where: {
      companyId: actor.companyId,
      deletedAt: null,
      active: true,
      OR: [{ maxQty: { gt: 0 } }, { minQty: { gt: 0 } }],
    },
    orderBy: { code: 'asc' },
  });
  const onOrder = await onOrderOf(db, actor.companyId);
  const lines = items
    .map((i) => {
      const stock = Number(i.stock);
      const o = owsLine({ stock, onOrder: onOrder.get(i.id) ?? 0, maxQty: n(i.maxQty), minQty: n(i.minQty) });
      return {
        item: {
          id: i.id,
          code: i.code,
          name: i.name,
          unit: i.unit,
          vendor: i.vendor,
          leadTimeDays: i.leadTimeDays,
        },
        stock,
        onOrder: onOrder.get(i.id) ?? 0,
        maxQty: n(i.maxQty),
        band: o.band,
        qty: o.qty,
        ratePaise: i.rate.toString(),
        valuePaise: String(Math.round(o.qty * Number(i.rate))),
        short: o.short,
      };
    })
    .filter((l) => l.short)
    // Red first (closest to running out), then by how far below MAX.
    .sort((a, b) =>
      a.band === b.band ? a.stock / (a.maxQty || 1) - b.stock / (b.maxQty || 1) : a.band === 'red' ? -1 : 1,
    );
  return { orderDay: day.date, open: day.open, opensOn: day.opensOn, today, lines };
}

const lineSchema = z.object({
  itemId: z.string(),
  qty: z.number().positive().max(1e9),
  ratePaise: z.number().int().min(0).max(1e13).optional(),
});
export const poSchema = z.object({
  vendor: z.string().trim().min(2).max(120),
  expectedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().trim().max(1000).nullish(),
  /** Phase 13: the location the goods are delivered to (left out = the main store). */
  locationId: z.string().optional(),
  lines: z.array(lineSchema).min(1).max(200),
});
export const fromOwsSchema = z.object({ lines: z.array(lineSchema).min(1).max(500) });

async function newNumber(tx: Parameters<typeof nextCounter>[0], db: Db, companyId: string) {
  const c = await db.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const fy = financialYear(new Date(), c.timezone, c.fyStartMonth ?? 4).short;
  return `PO/${fy}/${String(await nextCounter(tx, companyId, 'po', fy)).padStart(4, '0')}`;
}

async function checkItems(db: Db, companyId: string, ids: string[]) {
  const items = await db.item.findMany({ where: { companyId, id: { in: ids }, deletedAt: null } });
  if (items.length !== new Set(ids).size)
    throw new AppError(400, 'VALIDATION_FAILED', 'An item on the order is not in the item master');
  if (new Set(ids).size !== ids.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'The same item is on the order twice');
  return new Map(items.map((i) => [i.id, i]));
}

/** A purchase order by hand. */
export async function createPo(db: Db, actor: Actor, input: z.input<typeof poSchema>) {
  need(actor, 'ims.create', "You can't make purchase orders");
  const p = poSchema.parse(input);
  const items = await checkItems(
    db,
    actor.companyId,
    p.lines.map((l) => l.itemId),
  );
  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.create({
      data: {
        companyId: actor.companyId,
        branchId: await homeBranchOf(tx, actor.companyId, actor.userId),
        number: await newNumber(tx, db, actor.companyId),
        vendor: p.vendor,
        ...(p.locationId !== undefined ? { locationId: p.locationId } : {}),
        expectedOn: p.expectedOn ?? null,
        note: p.note ?? null,
        createdById: actor.userId,
        lines: {
          create: p.lines.map((l) => ({
            companyId: actor.companyId,
            itemId: l.itemId,
            qty: l.qty,
            rate: BigInt(l.ratePaise ?? Number(items.get(l.itemId)!.rate)),
          })),
        },
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.po_created',
      entityType: 'purchase_order',
      entityId: po.id,
      after: p,
    });
    return po;
  });
}

/** The OWS list → one draft order per vendor (items without a vendor go on one "vendor to choose" order). */
export async function ordersFromOws(db: Db, actor: Actor, input: z.input<typeof fromOwsSchema>) {
  need(actor, 'ims.create', "You can't make purchase orders");
  const { lines } = fromOwsSchema.parse(input);
  const items = await checkItems(
    db,
    actor.companyId,
    lines.map((l) => l.itemId),
  );
  const byVendor = new Map<string, typeof lines>();
  for (const l of lines) {
    const v = items.get(l.itemId)!.vendor?.trim() || 'Vendor to choose';
    byVendor.set(v, [...(byVendor.get(v) ?? []), l]);
  }
  const made: { id: string; number: string; vendor: string }[] = [];
  await db.$transaction(async (tx) => {
    for (const [vendor, ls] of byVendor) {
      const po = await tx.purchaseOrder.create({
        data: {
          companyId: actor.companyId,
          branchId: await homeBranchOf(tx, actor.companyId, actor.userId),
          number: await newNumber(tx, db, actor.companyId),
          vendor,
          fromOws: true,
          createdById: actor.userId,
          lines: {
            create: ls.map((l) => ({
              companyId: actor.companyId,
              itemId: l.itemId,
              qty: l.qty,
              rate: BigInt(l.ratePaise ?? Number(items.get(l.itemId)!.rate)),
            })),
          },
        },
      });
      made.push({ id: po.id, number: po.number, vendor });
    }
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.ows_ordered',
      entityType: 'purchase_order',
      entityId: made[0]!.id,
      after: { orders: made, lines },
    });
  });
  return { orders: made };
}

const poView = async (db: Db, po: Awaited<ReturnType<typeof loadPo>>) => {
  const by = po.createdById
    ? await db.user.findUnique({ where: { id: po.createdById }, select: { name: true } })
    : null;
  const lines = po.lines.map((l) => ({
    id: l.id,
    item: { id: l.itemId, code: l.item.code, name: l.item.name, unit: l.item.unit },
    qty: Number(l.qty),
    receivedQty: Number(l.receivedQty),
    ratePaise: l.rate.toString(),
    amountPaise: String(Math.round(Number(l.qty) * Number(l.rate))),
  }));
  return {
    id: po.id,
    number: po.number,
    vendor: po.vendor,
    locationId: po.locationId,
    status: po.status as PoStatus,
    expectedOn: po.expectedOn,
    note: po.note,
    fromOws: po.fromOws,
    createdAt: po.createdAt,
    sentAt: po.sentAt,
    by: by?.name ?? null,
    lines,
    totalPaise: String(lines.reduce((s, l) => s + Number(l.amountPaise), 0)),
  };
};
const loadPo = (db: Db, companyId: string, id: string) =>
  db.purchaseOrder.findFirstOrThrow({
    where: { id, companyId },
    include: { lines: { include: { item: { select: { code: true, name: true, unit: true } } } } },
  });

export async function listPos(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see purchase orders");
  const pos = await db.purchaseOrder.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { lines: { include: { item: { select: { code: true, name: true, unit: true } } } } },
  });
  return Promise.all(pos.map((p) => poView(db, p)));
}

export async function getPo(db: Db, actor: Actor, id: string) {
  need(actor, 'ims.view', "You can't see purchase orders");
  const po = await db.purchaseOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!po) throw notFound('Purchase order');
  return poView(db, await loadPo(db, actor.companyId, id));
}

/** Change a draft (vendor, date, lines). */
export async function updatePo(db: Db, actor: Actor, id: string, input: z.input<typeof poSchema>) {
  need(actor, 'ims.create', "You can't change purchase orders");
  const p = poSchema.parse(input);
  const po = await db.purchaseOrder.findFirst({ where: { id, companyId: actor.companyId } });
  if (!po) throw notFound('Purchase order');
  if (po.status !== 'DRAFT') throw new AppError(409, 'CONFLICT', 'Only a draft order can be changed');
  const items = await checkItems(
    db,
    actor.companyId,
    p.lines.map((l) => l.itemId),
  );
  await db.$transaction(async (tx) => {
    await tx.poLine.deleteMany({ where: { poId: id } });
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        vendor: p.vendor,
        ...(p.locationId !== undefined ? { locationId: p.locationId } : {}),
        expectedOn: p.expectedOn ?? null,
        note: p.note ?? null,
        lines: {
          create: p.lines.map((l) => ({
            companyId: actor.companyId,
            itemId: l.itemId,
            qty: l.qty,
            rate: BigInt(l.ratePaise ?? Number(items.get(l.itemId)!.rate)),
          })),
        },
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'ims.po_changed',
      entityType: 'purchase_order',
      entityId: id,
      after: p,
    });
  });
  return getPo(db, actor, id);
}

export const receiveSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.string(), qty: z.number().positive().max(1e9) }))
    .min(1)
    .max(200),
  note: z.string().trim().max(500).nullish(),
});

/** Send / receive (goods receipt → stock in at the order's rate) / close short / cancel. */
export async function poAction(
  db: Db,
  actor: Actor,
  id: string,
  action: 'send' | 'receive' | 'close' | 'cancel',
  input: { lines?: { lineId: string; qty: number }[]; note?: string | null } = {},
) {
  const po = await db.purchaseOrder.findFirst({
    where: { id, companyId: actor.companyId },
    include: { lines: true },
  });
  if (!po) throw notFound('Purchase order');
  const rules = await imsRulesOf(db, actor.companyId);
  const roles = [
    ...(can(actor, 'ims.admin') ? (['admin'] as const) : []),
    ...(can(actor, 'ims.create') || rules.people.purchaseIds.includes(actor.userId)
      ? (['purchase'] as const)
      : []),
    ...(can(actor, 'ims.create') || rules.people.storeKeeperIds.includes(actor.userId)
      ? (['store'] as const)
      : []),
  ];
  const anyIn = po.lines.some((l) => Number(l.receivedQty) > 0);
  let got = new Map<string, number>();
  if (action === 'receive') {
    const r = receiveSchema.parse(input);
    got = new Map(r.lines.map((l) => [l.lineId, l.qty]));
    for (const [lineId, qty] of got) {
      const line = po.lines.find((l) => l.id === lineId);
      if (!line) throw new AppError(400, 'VALIDATION_FAILED', 'A line is not on this order');
      const left = Number(line.qty) - Number(line.receivedQty);
      if (qty > left + 1e-9)
        throw new AppError(
          409,
          'CONFLICT',
          `Only ${left} left to receive on a line. Enter anything extra as a stock in.`,
        );
    }
  }
  const allIn = po.lines.every((l) => Number(l.receivedQty) + (got.get(l.id) ?? 0) >= Number(l.qty) - 1e-9);
  const to = transition(poMachine, { from: po.status as PoStatus, action, roles, ctx: { allIn, anyIn } }).to;
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    for (const [lineId, qty] of got) {
      const line = po.lines.find((l) => l.id === lineId)!;
      await tx.poLine.update({ where: { id: lineId }, data: { receivedQty: { increment: qty } } });
      await applyMove(tx, ctx, {
        itemId: line.itemId,
        type: 'IN',
        delta: qty,
        rate: line.rate,
        note: input.note ?? `Received on ${po.number}`,
        refType: 'purchase_order',
        refId: po.id,
      });
    }
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: to,
        ...(action === 'send' ? { sentAt: new Date() } : {}),
        ...(to === 'RECEIVED' || to === 'CANCELLED' ? { closedAt: new Date() } : {}),
      },
    });
    await writeAudit(tx, ctx, {
      action: `ims.po_${action}`,
      entityType: 'purchase_order',
      entityId: id,
      before: { status: po.status },
      after: { status: to, lines: [...got.entries()] },
    });
  });
  return getPo(db, actor, id);
}
