import type { Db, Tx } from '@mono/db';
import { localDate, plainValues, refsOf, type BillType, type ItemLine } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { createBill, createBillIn } from './bills';
import { vendorParty } from './parties';

/**
 * Other modules raising papers through the bill engine (phase 12M): a purchase order's goods received become a
 * purchase bill; a paper made by a process step becomes a bill when its document type says so.
 */

/** A purchase bill for what a purchase order has received, drafted for the accounts to check against the vendor's bill. */
export async function billForPo(
  db: Db,
  actor: Actor,
  poId: string,
  input: { date: string; reference?: string | null; taxCode?: string | null },
) {
  if (!can(actor, 'money.create')) throw new AppError(403, 'FORBIDDEN', "You can't make bills");
  const po = await db.purchaseOrder.findFirst({
    where: { id: poId, companyId: actor.companyId },
    include: { lines: { include: { item: { select: { name: true, unit: true } } } } },
  });
  if (!po) throw notFound('Purchase order');
  if (
    await db.bill.count({
      where: {
        companyId: actor.companyId,
        sourceType: 'purchase_order',
        sourceId: po.id,
        status: { not: 'CANCELLED' },
      },
    })
  )
    throw new AppError(409, 'CONFLICT', `${po.number} already has its purchase bill`);
  const received = po.lines.filter((l) => Number(l.receivedQty) > 0);
  if (!received.length) throw new AppError(409, 'CONFLICT', 'Nothing has been received on this order yet');
  // The vendor is whoever a person said this typed name is — never a guess.
  const partyId = await vendorParty(db, actor.companyId, po.vendor);
  if (!partyId)
    throw new AppError(409, 'CONFLICT', `Say which party "${po.vendor}" is first (Money → Vendors to match)`);
  return createBill(
    db,
    actor,
    {
      type: 'PURCHASE_BILL',
      partyId,
      date: input.date,
      branchId: po.branchId,
      lines: received.map((l) => ({
        item: l.item.name,
        unit: l.item.unit,
        qty: Number(l.receivedQty),
        rate: Number(l.rate),
        taxCode: input.taxCode ?? null,
      })),
      charges: [],
      discount: 0,
      taxInclusive: false,
      reference: input.reference ?? po.number,
    },
    { source: { type: 'purchase_order', id: po.id } },
  );
}

/**
 * A paper made by a process step is also a bill when its document type names a kind (invoice, challan …) and the
 * record names a party (a field that picked a customer or a party). Without a party nothing is raised — the
 * record's history says so; a record never stops on this.
 */
export async function billForDocument(
  tx: Tx,
  doc: {
    id: string;
    companyId: string;
    branchId: string | null;
    date: Date;
    data: unknown;
    createdById: string | null;
  },
  billType: BillType,
  tz: string,
): Promise<{ billId: string } | { skipped: string }> {
  const refs = Object.values(refsOf(doc.data));
  const ids = refs.flatMap((r) =>
    typeof r === 'string' && /^(customer|party):/.test(r) ? [r.split(':')[1]!] : [],
  );
  const party = ids.length
    ? await tx.party.findFirst({ where: { id: { in: ids }, companyId: doc.companyId, deletedAt: null } })
    : null;
  if (!party) return { skipped: 'The record names no party, so no bill was raised' };
  const lines = (Object.values(plainValues(doc.data)).find(Array.isArray) as ItemLine[] | undefined) ?? [];
  const usable = lines.filter((l) => l.item && l.qty > 0);
  if (!usable.length) return { skipped: 'The record has no item lines, so no bill was raised' };
  const bill = await createBillIn(
    tx,
    { companyId: doc.companyId, userId: doc.createdById ?? '', permissions: [] },
    {
      type: billType,
      partyId: party.id,
      date: localDate(doc.date, tz),
      branchId: doc.branchId,
      // Item lines hold rupees; the engine works in paise.
      lines: usable.map((l) => ({
        item: String(l.item),
        qty: Number(l.qty),
        rate: Math.round(Number(l.rate) * 100),
      })),
      charges: [],
      discount: 0,
      taxInclusive: false,
    },
    { issue: true, system: true, source: { type: 'document', id: doc.id } },
  );
  return { billId: bill.id };
}
