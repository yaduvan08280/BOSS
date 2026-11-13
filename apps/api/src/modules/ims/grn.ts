import type { Db } from '@mono/db';
import { factorOf, poMachine, transition, type PoStatus } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { createBillIn } from '../money/bills';
import { vendorParty } from '../money/parties';
import { can, type Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { applyMove } from './moves';
import { batchInputSchema, receiveIn, serialInputSchema } from './stock-entry';
import { clockOf, itemsOf, needPlace, num, paperNumber, r3, reachPlaces } from './v2';

/**
 * Phase 13 — goods receipt (GRN): what really came against a purchase order (or without one), at what rate,
 * in which batch, what was rejected at the gate — with the quantity and rate variance against the order. It can
 * raise the vendor's purchase bill, and goods can be sent back against it.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const grnSchema = z.object({
  poId: z.string().nullish(),
  vendor: z.string().trim().max(120).nullish(),
  locationId: z.string().optional(),
  invoiceNo: z.string().trim().max(60).nullish(),
  invoiceDate: day.nullish(),
  note: z.string().trim().max(500).nullish(),
  /** Raise the vendor's purchase bill for what was accepted (the vendor must be matched to a party). */
  raiseBill: z.boolean().default(false),
  lines: z
    .array(
      z.object({
        itemId: z.string(),
        poLineId: z.string().nullish(),
        /** Accepted into stock, in `unit`. */
        qty: z.number().min(0).max(1e9),
        unit: z.string().trim().max(12).nullish(),
        /** Rate per `unit` on the vendor's invoice; left out, the order's rate. */
        ratePaise: z.number().int().min(0).max(1e13).nullish(),
        rejected: z.number().min(0).max(1e9).default(0),
        rejectReason: z.string().trim().max(200).nullish(),
        batch: batchInputSchema.optional(),
        serials: z.array(serialInputSchema).max(500).optional(),
        qty2: z.number().positive().max(1e9).nullish(),
      }),
    )
    .min(1)
    .max(200),
});
export type GrnLine = {
  itemId: string;
  poLineId: string | null;
  ordered: number | null;
  /** Accepted, in the stock unit. */
  received: number;
  unit: string | null;
  unitQty: number;
  /** Per stock unit: what was paid and what the order said. */
  rate: number;
  poRate: number | null;
  rejected: number;
  rejectReason: string | null;
  /** + came more than was still due, − came short. */
  qtyVariance: number | null;
  rateVariance: number | null;
  batchIds: string[];
  returned: number;
};

export async function createGrn(db: Db, actor: Actor, input: z.input<typeof grnSchema>) {
  need(actor, 'ims.create', "You can't receive goods");
  const g = grnSchema.parse(input);
  const po = g.poId
    ? await db.purchaseOrder.findFirst({
        where: { id: g.poId, companyId: actor.companyId },
        include: { lines: true },
      })
    : null;
  if (g.poId && !po) throw notFound('Purchase order');
  const place = await needPlace(db, actor.companyId, g.locationId ?? po?.locationId ?? '');
  const { rows, items } = await itemsOf(
    db,
    actor.companyId,
    g.lines.map((l) => l.itemId),
  );
  const vendor = po?.vendor ?? g.vendor ?? null;
  const partyId = await vendorParty(db, actor.companyId, vendor);
  if (g.raiseBill) {
    if (!can(actor, 'money.create')) throw new AppError(403, 'FORBIDDEN', "You can't make bills");
    if (!partyId)
      throw new AppError(
        409,
        'CONFLICT',
        `Match the vendor "${vendor ?? ''}" to a party first (Money set-up → Vendors to match)`,
      );
  }
  const lines: GrnLine[] = g.lines.map((l) => {
    const item = items.get(l.itemId)!;
    const factor = factorOf(item, l.unit);
    if (factor === null)
      throw new AppError(400, 'VALIDATION_FAILED', `${item.name} has no unit called ${l.unit}`);
    const poLine = po?.lines.find((x) => (l.poLineId ? x.id === l.poLineId : x.itemId === l.itemId)) ?? null;
    if (po && !poLine) throw new AppError(400, 'VALIDATION_FAILED', `${item.name} is not on ${po.number}`);
    const received = item.tracking === 'SERIAL' ? (l.serials?.length ?? 0) : r3(l.qty * factor);
    const left = poLine ? num(poLine.qty) - num(poLine.receivedQty) : null;
    const poRate = poLine ? Number(poLine.rate) : null;
    const rate =
      l.ratePaise === null || l.ratePaise === undefined
        ? (poRate ?? item.rate)
        : Math.round(l.ratePaise / factor);
    return {
      itemId: item.id,
      poLineId: poLine?.id ?? null,
      ordered: poLine ? num(poLine.qty) : null,
      received,
      unit: l.unit ?? null,
      unitQty: l.qty,
      rate,
      poRate,
      rejected: r3(l.rejected * factor),
      rejectReason: l.rejectReason ?? null,
      qtyVariance: left === null ? null : r3(received - left),
      rateVariance: poRate === null ? null : rate - poRate,
      batchIds: [],
      returned: 0,
    };
  });
  if (!lines.some((l) => l.received > 0 || l.rejected > 0))
    throw new AppError(400, 'VALIDATION_FAILED', 'Nothing was received');
  // The order's own state: receiving it (in part or whole) follows the purchase-order machine.
  const allIn = po
    ? po.lines.every(
        (pl) =>
          num(pl.receivedQty) + (lines.find((l) => l.poLineId === pl.id)?.received ?? 0) >=
          num(pl.qty) - 1e-9,
      )
    : false;
  const poStatus = po
    ? transition(poMachine, {
        from: po.status as PoStatus,
        action: 'receive',
        roles: ['store'],
        ctx: { allIn, anyIn: true },
      }).to
    : null;
  const ctx = ctxOf(actor);
  const { today } = await clockOf(db, actor.companyId);
  return db.$transaction(async (tx) => {
    const number = await paperNumber(tx, actor.companyId, 'GRN');
    const id = (
      await tx.goodsReceipt.create({
        data: {
          companyId: actor.companyId,
          number,
          poId: po?.id ?? null,
          vendor,
          partyId,
          locationId: place.id,
          invoiceNo: g.invoiceNo ?? null,
          invoiceDate: g.invoiceDate ?? null,
          lines: [],
          note: g.note ?? null,
          createdById: actor.userId,
        },
      })
    ).id;
    for (const [i, line] of lines.entries()) {
      const typed = g.lines[i]!;
      const item = items.get(line.itemId)!;
      if (line.received > 0) {
        const factor = factorOf(item, typed.unit)!;
        const done = await receiveIn(tx, actor, item, rows.get(item.id)!, {
          qty: typed.qty,
          unit: typed.unit,
          batch: typed.batch,
          serials: typed.serials,
          qty2: typed.qty2,
          // receiveIn takes the rate per typed unit.
          ratePaise: typed.ratePaise ?? line.rate * factor,
          note: `${number}${po ? ` on ${po.number}` : ''}`,
          locationId: place.id,
          refType: 'goods_receipt',
          refId: id,
        });
        line.batchIds = done.map((d) => d.move.batchId).filter((x): x is string => Boolean(x));
        // The latest purchase rate is the item's rate: recipe costs read it.
        await tx.item.update({ where: { id: item.id }, data: { rate: BigInt(line.rate) } });
      }
      if (line.poLineId && line.received > 0)
        await tx.poLine.update({
          where: { id: line.poLineId },
          data: { receivedQty: { increment: line.received } },
        });
    }
    if (po && poStatus)
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: poStatus, ...(poStatus === 'RECEIVED' ? { closedAt: new Date() } : {}) },
      });
    let billId: string | null = null;
    if (g.raiseBill && partyId) {
      const bill = await createBillIn(
        tx,
        actor,
        {
          type: 'PURCHASE_BILL',
          partyId,
          date: g.invoiceDate ?? today,
          branchId: place.branchId,
          reference: g.invoiceNo ?? number,
          lines: lines
            .filter((l) => l.received > 0)
            .map((l) => {
              const item = items.get(l.itemId)!;
              return {
                item: item.name,
                hsn: item.hsn ?? undefined,
                qty: l.received,
                rate: l.rate,
                ...(item.taxCode ? { taxCode: item.taxCode } : {}),
              };
            }),
          charges: [],
          discount: 0,
          taxInclusive: false,
          note: number,
        },
        { issue: true, source: { type: 'goods_receipt', id } },
      );
      billId = bill.id;
    }
    await tx.goodsReceipt.update({ where: { id }, data: { lines, billId } });
    await writeAudit(tx, ctx, {
      action: 'ims.grn',
      entityType: 'goods_receipt',
      entityId: id,
      after: { number, poId: po?.id ?? null, lines },
    });
    await emitEvent(tx, ctx, {
      name: 'ims.goods_received',
      entityType: 'goods_receipt',
      entityId: id,
      payload: { number, vendor, location: place.name, branchId: place.branchId, po: po?.number ?? null },
    });
    return { id, number, billId, poStatus, lines };
  });
}

export const returnSchema = z.object({
  lines: z
    .array(
      z.object({ itemId: z.string(), qty: z.number().positive().max(1e9), batchId: z.string().nullish() }),
    )
    .min(1)
    .max(200),
  reason: z.string().trim().min(3).max(300),
});
/** Goods sent back to the vendor against a receipt: stock goes out (an expired batch too) and the bill is credited. */
export async function returnToVendor(db: Db, actor: Actor, id: string, input: z.input<typeof returnSchema>) {
  need(actor, 'ims.edit', "You can't send goods back");
  const r = returnSchema.parse(input);
  const grn = await db.goodsReceipt.findFirst({ where: { id, companyId: actor.companyId } });
  if (!grn) throw notFound('Goods receipt');
  await needPlace(db, actor.companyId, grn.locationId);
  const lines = grn.lines as GrnLine[];
  const { items } = await itemsOf(
    db,
    actor.companyId,
    r.lines.map((l) => l.itemId),
  );
  for (const l of r.lines) {
    const line = lines.find((x) => x.itemId === l.itemId);
    if (!line)
      throw new AppError(400, 'VALIDATION_FAILED', `${items.get(l.itemId)!.name} was not on this receipt`);
    if (l.qty > line.received - line.returned + 1e-9)
      throw new AppError(
        409,
        'CONFLICT',
        `Only ${r3(line.received - line.returned)} of ${items.get(l.itemId)!.name} can still be returned`,
      );
  }
  const ctx = ctxOf(actor);
  const { today } = await clockOf(db, actor.companyId);
  return db.$transaction(async (tx) => {
    let credit = 0;
    for (const l of r.lines) {
      const line = lines.find((x) => x.itemId === l.itemId)!;
      await applyMove(tx, ctx, {
        itemId: l.itemId,
        type: 'OUT',
        delta: -l.qty,
        reason: 'VENDOR_RETURN',
        locationId: grn.locationId,
        batchId: l.batchId ?? (line.batchIds.length === 1 ? line.batchIds[0] : null),
        note: `${grn.number}: ${r.reason}`,
        refType: 'goods_receipt',
        refId: grn.id,
        allowExpired: true,
      });
      line.returned = r3(line.returned + l.qty);
      credit += Math.round(l.qty * line.rate);
    }
    let noteId: string | null = null;
    const bill = grn.billId ? await tx.bill.findUnique({ where: { id: grn.billId } }) : null;
    if (bill && bill.status !== 'CANCELLED' && grn.partyId) {
      noteId = (
        await createBillIn(
          tx,
          actor,
          {
            type: 'CREDIT_NOTE',
            partyId: grn.partyId,
            date: today,
            branchId: bill.branchId,
            againstId: bill.id,
            lines: r.lines.map((l) => {
              const item = items.get(l.itemId)!;
              const line = lines.find((x) => x.itemId === l.itemId)!;
              return {
                item: `${item.name} returned`,
                qty: l.qty,
                rate: line.rate,
                ...(item.taxCode ? { taxCode: item.taxCode } : {}),
              };
            }),
            charges: [],
            discount: 0,
            taxInclusive: false,
            note: `${grn.number}: ${r.reason}`,
          },
          { issue: true, system: true, source: { type: 'vendor_return', id: grn.id } },
        )
      ).id;
    }
    await tx.goodsReceipt.update({ where: { id }, data: { lines } });
    await writeAudit(tx, ctx, {
      action: 'ims.vendor_return',
      entityType: 'goods_receipt',
      entityId: id,
      after: r,
    });
    return { id, credit, noteId };
  });
}

export async function listGrns(db: Db, actor: Actor) {
  need(actor, 'ims.view', "You can't see stock");
  const mine = await reachPlaces(db, actor.companyId);
  const rows = await db.goodsReceipt.findMany({
    where: { companyId: actor.companyId, locationId: { in: [...mine.keys()] } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  const names = new Map(
    (
      await db.item.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: [...new Set(rows.flatMap((r) => (r.lines as GrnLine[]).map((l) => l.itemId)))] },
        },
        select: { id: true, name: true, unit: true },
      })
    ).map((i) => [i.id, i]),
  );
  const pos = new Map(
    (
      await db.purchaseOrder.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: rows.map((r) => r.poId).filter((x): x is string => Boolean(x)) },
        },
        select: { id: true, number: true },
      })
    ).map((p) => [p.id, p.number]),
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    po: r.poId ? (pos.get(r.poId) ?? null) : null,
    vendor: r.vendor,
    location: mine.get(r.locationId)?.name ?? '—',
    invoiceNo: r.invoiceNo,
    invoiceDate: r.invoiceDate,
    billId: r.billId,
    createdAt: r.createdAt,
    lines: (r.lines as GrnLine[]).map((l) => ({
      ...l,
      item: names.get(l.itemId)?.name ?? '',
      stockUnit: names.get(l.itemId)?.unit ?? '',
    })),
  }));
}
