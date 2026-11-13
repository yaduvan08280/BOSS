import type { Db } from '@mono/db';
import { addDays, billChargeSchema, factorOf } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { createBillIn } from '../money/bills';
import { can, type Actor } from '../work/actor';
import { ctxOf, need } from './access';
import { priceFor } from './prices';
import { consume } from './recipes';
import { resolveEntry } from './stock-entry';
import { clockOf, needPlace, r3 } from './v2';

/**
 * Phase 13 — a counter sale: items (typed or scanned) sold from a location to a party. Each line takes its
 * price from the rate board / price lists, the stock leaves the location (a dish through its recipe, a piece
 * by its own number), and one invoice is raised through the money core. The POS (phase 15) sells the same way.
 */
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const sellSchema = z.object({
  partyId: z.string(),
  locationId: z.string().default(''),
  date: day.optional(),
  lines: z
    .array(
      z
        .object({
          itemId: z.string().optional(),
          barcode: z.string().trim().max(64).optional(),
          batchId: z.string().optional(),
          qty: z.number().positive().max(1e9).default(1),
          unit: z.string().trim().max(12).nullish(),
          /** A price typed at the counter in place of the list's (per typed unit / per unit of weight). */
          price: z.number().int().min(0).max(1e13).optional(),
        })
        .refine((m) => m.itemId || m.barcode, { message: 'Choose an item or scan a code' }),
    )
    .min(1)
    .max(200),
  /** Added after the items: making charges, packing, freight … taxed when given a tax code (phase 21). */
  charges: z.array(billChargeSchema).max(10).default([]),
  /** Taken off the whole bill before tax (a scheme, a round figure agreed at the counter). */
  discount: z.number().int().min(0).max(1e13).default(0),
  /** Money taken now: a receipt against this invoice. */
  paid: z.number().int().min(0).max(1e13).optional(),
  modeId: z.string().nullish(),
  note: z.string().trim().max(500).nullish(),
});

export async function sell(db: Db, actor: Actor, input: z.input<typeof sellSchema>) {
  need(actor, 'ims.create', "You can't sell from stock");
  if (!can(actor, 'money.create')) throw new AppError(403, 'FORBIDDEN', "You can't make bills");
  const s = sellSchema.parse(input);
  const place = await needPlace(db, actor.companyId, s.locationId);
  const party = await db.party.findFirst({
    where: { id: s.partyId, companyId: actor.companyId, deletedAt: null },
  });
  if (!party) throw notFound('Party');
  const date = s.date ?? (await clockOf(db, actor.companyId)).today;
  const ctx = ctxOf(actor);
  return db.$transaction(async (tx) => {
    const sold = [];
    for (const l of s.lines) {
      const { item, batchId } = await resolveEntry(tx, actor.companyId, l);
      const factor = factorOf(item, l.unit);
      if (factor === null)
        throw new AppError(400, 'VALIDATION_FAILED', `${item.name} has no unit called ${l.unit}`);
      const stockQty = item.tracking === 'SERIAL' ? 1 : r3(l.qty * factor);
      const p = await priceFor(tx, actor.companyId, item, {
        partyKinds: party.kinds,
        branchId: place.branchId,
        date,
      });
      const batch = batchId ? await tx.stockBatch.findUnique({ where: { id: batchId } }) : null;
      // A weight-priced item is billed by weight: a piece's own weight, else the quantity typed in the weight unit.
      const byWeight = p.pricedBy === 'second';
      const weight = byWeight
        ? batch?.qty2 === null || batch?.qty2 === undefined
          ? l.qty
          : Number(batch.qty2)
        : null;
      if (l.price === undefined && p.source === 'none')
        throw new AppError(
          409,
          'CONFLICT',
          `${item.name} has no price: add it to a price list or give it a selling price`,
        );
      const rate = l.price ?? (byWeight ? p.price : Math.round(p.price * factor));
      sold.push({
        item,
        batchId,
        stockQty,
        billQty: byWeight ? weight! : l.qty,
        rate,
        source: l.price === undefined ? p.source : 'typed',
        batch,
      });
    }
    const bill = await createBillIn(
      tx,
      actor,
      {
        type: 'INVOICE',
        partyId: party.id,
        date,
        branchId: place.branchId,
        lines: sold.map((x) => ({
          item: x.batch && x.item.tracking === 'SERIAL' ? `${x.item.name} · ${x.batch.code}` : x.item.name,
          hsn: x.item.hsn ?? undefined,
          qty: x.billQty,
          rate: x.rate,
          ...(x.item.taxCode ? { taxCode: x.item.taxCode } : {}),
        })),
        charges: s.charges,
        discount: s.discount,
        taxInclusive: false,
        // A party on credit has until its credit days to pay (it is not overdue the day it buys).
        dueOn: party.creditDays > 0 ? addDays(date, party.creditDays) : null,
        note: s.note ?? null,
      },
      { issue: true, source: { type: 'counter_sale', id: place.id || 'main' } },
    );
    let cost = 0;
    for (const x of sold) {
      const used = await consume(tx, ctx, {
        itemId: x.item.id,
        qty: x.stockQty,
        locationId: place.id,
        batchId: x.batchId ?? null,
        refType: 'bill',
        refId: bill.id,
        note: bill.number,
      });
      cost += used.cost;
    }
    let receiptId: string | null = null;
    if (s.paid) {
      const receipt = await createBillIn(
        tx,
        actor,
        {
          type: 'RECEIPT',
          partyId: party.id,
          date,
          branchId: place.branchId,
          lines: [],
          charges: [],
          discount: 0,
          taxInclusive: false,
          amount: s.paid,
          modeId: s.modeId ?? null,
        },
        { allocate: [{ billId: bill.id, amount: Math.min(s.paid, Number(bill.total)) }] },
      );
      receiptId = receipt.id;
    }
    await writeAudit(tx, ctx, {
      action: 'ims.sold',
      entityType: 'bill',
      entityId: bill.id,
      after: {
        location: place.id,
        lines: sold.map((x) => ({ itemId: x.item.id, qty: x.stockQty, rate: x.rate, source: x.source })),
      },
    });
    return {
      billId: bill.id,
      number: bill.number,
      total: Number(bill.total),
      cost,
      receiptId,
      lines: sold.map((x) => ({
        itemId: x.item.id,
        name: x.item.name,
        qty: x.billQty,
        rate: x.rate,
        source: x.source,
        batch: x.batch?.code ?? null,
      })),
    };
  });
}
