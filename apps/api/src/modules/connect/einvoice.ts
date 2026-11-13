import type { Db, Prisma } from '@mono/db';
import { einvoicePayload, GSTIN, gstinState, type BillChargeOut, type BillLineOut } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { letterheadOf } from '../branches/letterhead';
import { can, type Actor } from '../work/actor';
import { callOut, needConnection, type Net } from './core';

/**
 * Phase 19 — e-invoices. A B2B tax invoice (the buyer has a GSTIN) is sent to the company's e-invoice provider
 * (a GSP), which registers it and answers with the IRN, the acknowledgement and the signed QR; they are kept on
 * the bill. An IRN can be cancelled within 24 hours. MONO speaks one plain contract to the provider:
 * POST {base}/einvoice with the IRP's own JSON, POST {base}/einvoice/cancel with { irn, reason, remark }.
 */
export type Einvoice = {
  irn: string;
  ackNo: string | null;
  ackDt: string | null;
  qr: string | null;
  at: string;
  cancelledAt?: string | null;
  reason?: string | null;
};
const made = z.object({
  irn: z.string().min(10).max(100),
  ackNo: z.union([z.string(), z.number()]).nullish(),
  ackDt: z.string().nullish(),
  signedQr: z.string().nullish(),
});
const pinOf = (address: string | null | undefined) => Number(/\b(\d{6})\b/.exec(address ?? '')?.[1] ?? 0);
const placeOf = (address: string | null | undefined, fallback: string) =>
  (address ?? '')
    .split(',')
    .map((x) => x.replace(/\d{6}/, '').trim())
    .filter(Boolean)
    .slice(-2, -1)[0] ?? fallback;

async function payloadOf(db: Db, companyId: string, billId: string) {
  const bill = await db.bill.findFirst({ where: { id: billId, companyId } });
  if (!bill) throw notFound('Bill');
  if (
    !['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE'].includes(bill.type) ||
    ['DRAFT', 'CANCELLED'].includes(bill.status)
  )
    throw new AppError(409, 'CONFLICT', 'Only an issued invoice or note gets an e-invoice');
  const head = await letterheadOf(db, companyId, bill.branchId);
  const party = await db.party.findUniqueOrThrow({ where: { id: bill.partyId } });
  const problems: string[] = [];
  if (!head.taxId || !GSTIN.test(head.taxId)) problems.push('The seller has no valid GSTIN');
  if (!party.taxId || !GSTIN.test(party.taxId))
    problems.push('The buyer has no valid GSTIN — an e-invoice is for B2B bills');
  // The address that carries a PIN code: the branch's own, else the legal entity's.
  const sellerAddress =
    [head.branchAddress, head.address].find((a) => pinOf(a)) ?? head.branchAddress ?? head.address;
  if (!pinOf(sellerAddress)) problems.push("The seller's address has no PIN code");
  if (!pinOf(party.address)) problems.push("The buyer's address has no PIN code");
  const lines = bill.lines as unknown as BillLineOut[];
  // Charges (service charge, packing, freight) go in as service lines of their own, so the lines add up to the bill.
  const charges = (bill.charges as unknown as BillChargeOut[]).filter((c) => c.total > 0);
  if (lines.some((l) => !l.hsn)) problems.push('Every line needs an HSN / SAC code');
  if (problems.length) throw new AppError(400, 'VALIDATION_FAILED', problems[0]!, { problems });
  return {
    bill,
    payload: einvoicePayload({
      seller: {
        gstin: head.taxId!,
        name: head.name,
        address: sellerAddress!,
        place: placeOf(sellerAddress, head.branch ?? head.name),
        pin: pinOf(sellerAddress),
        stateCode: gstinState(head.taxId)!,
      },
      buyer: {
        gstin: party.taxId!,
        name: party.name,
        address: party.address!,
        place: placeOf(party.address, party.state ?? party.name),
        pin: pinOf(party.address),
        stateCode: gstinState(party.taxId)!,
      },
      doc: {
        type: bill.type === 'INVOICE' ? 'INV' : bill.type === 'CREDIT_NOTE' ? 'CRN' : 'DBN',
        number: bill.number,
        date: bill.date,
      },
      lines: [
        ...lines.map((l) => ({
          name: l.item,
          hsn: l.hsn ?? null,
          qty: l.qty,
          unit: l.unit ?? null,
          rate: l.rate,
          taxable: l.taxable,
          percent: l.taxPercent,
          tax: l.total - l.taxable,
          total: l.total,
        })),
        ...charges.map((c) => ({
          name: c.name,
          hsn: '999799',
          qty: 1,
          unit: null,
          rate: c.taxable,
          taxable: c.taxable,
          percent: c.taxPercent,
          tax: c.total - c.taxable,
          total: c.total,
        })),
      ],
      totals: {
        taxable: Number(bill.taxable),
        tax: Number(bill.tax),
        roundOff: bill.roundOff,
        total: Number(bill.total),
      },
    }),
  };
}
const allowed = (actor: Actor) => {
  if (!can(actor, 'money.edit')) throw new AppError(403, 'FORBIDDEN', "You can't file e-invoices");
};

/** Register a bill's e-invoice and keep its IRN. A bill that has one is not sent again. */
export async function makeEinvoice(db: Db, net: Net, actor: Actor, billId: string) {
  allowed(actor);
  const { bill, payload } = await payloadOf(db, actor.companyId, billId);
  const have = bill.einvoice as Einvoice | null;
  if (have && !have.cancelledAt) return have;
  if (have?.cancelledAt)
    throw new AppError(
      409,
      'CONFLICT',
      'This e-invoice was cancelled; the bill number cannot be registered again',
    );
  const conn = await needConnection(db, net, actor.companyId, 'EINVOICE', '', 'E-invoicing');
  const out = await callOut(db, net, conn, {
    what: 'einvoice',
    ref: bill.number,
    url: `${(conn.baseUrl ?? '').replace(/\/$/, '')}/einvoice`,
    headers: { authorization: `Bearer ${conn.keys.token ?? ''}` },
    body: payload,
  });
  const answer = out.ok ? made.safeParse(out.json) : null;
  if (!answer?.success) throw new AppError(409, 'CONFLICT', out.error ?? 'The provider did not give an IRN');
  const einvoice: Einvoice = {
    irn: answer.data.irn,
    ackNo: answer.data.ackNo == null ? null : String(answer.data.ackNo),
    ackDt: answer.data.ackDt ?? null,
    qr: answer.data.signedQr ?? null,
    at: new Date().toISOString(),
  };
  await db.$transaction(async (tx) => {
    await tx.bill.update({
      where: { id: bill.id },
      data: { einvoice: einvoice as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'bill.einvoice_made',
        entityType: 'bill',
        entityId: bill.id,
        after: { irn: einvoice.irn, ackNo: einvoice.ackNo },
      },
    );
  });
  return einvoice;
}

const cancelSchema = z.object({
  /** The IRP's reasons: 1 duplicate, 2 data entry mistake, 3 order cancelled, 4 other. */
  reason: z.enum(['1', '2', '3', '4']).default('2'),
  remark: z.string().trim().min(3).max(100),
});
/** Cancel an IRN — the portal allows it for 24 hours after it was made. The bill itself is corrected by a credit note. */
export async function cancelEinvoice(
  db: Db,
  net: Net,
  actor: Actor,
  billId: string,
  input: z.input<typeof cancelSchema>,
  now = new Date(),
) {
  allowed(actor);
  const c = cancelSchema.parse(input);
  const bill = await db.bill.findFirst({ where: { id: billId, companyId: actor.companyId } });
  if (!bill) throw notFound('Bill');
  const have = bill.einvoice as Einvoice | null;
  if (!have || have.cancelledAt) throw new AppError(409, 'CONFLICT', 'This bill has no live e-invoice');
  if (now.getTime() - new Date(have.at).getTime() > 24 * 3_600_000)
    throw new AppError(
      409,
      'CONFLICT',
      'An e-invoice can be cancelled only within 24 hours — raise a credit note instead',
    );
  const conn = await needConnection(db, net, actor.companyId, 'EINVOICE', '', 'E-invoicing');
  const out = await callOut(db, net, conn, {
    what: 'einvoice_cancel',
    ref: bill.number,
    url: `${(conn.baseUrl ?? '').replace(/\/$/, '')}/einvoice/cancel`,
    headers: { authorization: `Bearer ${conn.keys.token ?? ''}` },
    body: { irn: have.irn, reason: c.reason, remark: c.remark },
  });
  if (!out.ok) throw new AppError(409, 'CONFLICT', out.error ?? 'The provider did not cancel it');
  const einvoice: Einvoice = { ...have, cancelledAt: now.toISOString(), reason: c.remark };
  await db.$transaction(async (tx) => {
    await tx.bill.update({
      where: { id: bill.id },
      data: { einvoice: einvoice as unknown as Prisma.InputJsonValue },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'bill.einvoice_cancelled',
        entityType: 'bill',
        entityId: bill.id,
        after: { irn: have.irn, remark: c.remark },
      },
    );
  });
  return einvoice;
}
