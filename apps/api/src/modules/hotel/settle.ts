import type { Bill, Db } from '@mono/db';
import { formatINR } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { createBillIn, dueOf, voidBill } from '../money/bills';
import { applyCredit, creditLeft } from '../money/credit';
import type { Actor } from '../work/actor';
import { desk, hotelOf, supervisor } from './core';
import { folioView, invoiceLines, isPosLine, liveLines } from './folio';

/**
 * Phase 17 — closing a folio. Its charges become one tax invoice in the name of whoever pays it (room nights are
 * taxed by the slab their tariff falls in); restaurant bills sent to the room are already invoices and are simply
 * paid with it. Advances go against them first, then the money taken now. A company's folio may be left owing —
 * it shows in Money owed; a guest's own must be paid in full.
 */
export const settleSchema = z.object({
  payments: z
    .array(
      z.object({
        modeId: z.string().min(1).max(40),
        amount: z.number().int().min(1).max(1e13),
        reference: z.string().trim().max(80).nullish(),
      }),
    )
    .max(10)
    .default([]),
  /** Leave what is unpaid owed by the folio's company (bill to company). */
  onCredit: z.boolean().default(false),
});

export async function settleFolio(
  db: Db,
  actor: Actor,
  folioId: string,
  input: z.input<typeof settleSchema>,
) {
  desk(actor);
  const p = settleSchema.parse(input);
  const folio = await db.folio.findFirst({ where: { id: folioId, companyId: actor.companyId } });
  if (!folio) throw notFound('Folio');
  const hotel = await hotelOf(db, actor, folio.branchId);
  if (folio.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This folio is closed');
  const stay = await db.stay.findUniqueOrThrow({ where: { id: folio.stayId } });
  const modes = new Map(
    (
      await db.paymentMode.findMany({
        where: {
          companyId: actor.companyId,
          id: { in: p.payments.map((x) => x.modeId) },
          deletedAt: null,
          active: true,
        },
      })
    ).map((m) => [m.id, m]),
  );
  for (const x of p.payments) {
    const mode = modes.get(x.modeId);
    if (!mode || ['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(mode.kind))
      throw new AppError(400, 'VALIDATION_FAILED', 'That way of paying can’t settle a folio');
    if (mode.needsRef && !x.reference)
      throw new AppError(400, 'VALIDATION_FAILED', `${mode.name} needs a reference`);
  }
  const ctx = ctxOf(actor);
  await db.$transaction(async (tx) => {
    const lines = liveLines(
      await tx.folioLine.findMany({ where: { folioId }, orderBy: { createdAt: 'asc' } }),
    );
    const toInvoice = invoiceLines(lines);
    const invoice = toInvoice.length
      ? await createBillIn(
          tx,
          actor,
          {
            type: 'INVOICE',
            partyId: folio.partyId,
            date: hotel.businessDate,
            branchId: hotel.branchId,
            lines: toInvoice,
            charges: [],
            discount: 0,
            taxInclusive: false,
            note: `Stay ${stay.number} — ${folio.name}`,
          },
          { issue: true, system: true, source: { type: 'folio', id: folio.id } },
        )
      : null;
    // What is to be paid: the restaurant bills sent to the room first, then the folio's own invoice.
    const checks = await tx.posCheck.findMany({
      where: { id: { in: lines.filter(isPosLine).map((l) => l.refId!) }, status: { not: 'CANCELLED' } },
    });
    const targets: Bill[] = [
      ...(await tx.bill.findMany({
        where: { id: { in: checks.map((c) => c.billId) } },
        orderBy: { createdAt: 'asc' },
      })),
      ...(invoice ? [invoice] : []),
    ];
    const due = async () => {
      const fresh = await tx.bill.findMany({ where: { id: { in: targets.map((t) => t.id) } } });
      return targets.map((t) => ({
        bill: fresh.find((f) => f.id === t.id)!,
        left: Math.max(0, dueOf(fresh.find((f) => f.id === t.id)!)),
      }));
    };
    for (const adv of lines.filter((l) => l.kind === 'PAYMENT' && l.refType === 'advance'))
      for (const t of await due())
        if (t.left > 0) await applyCredit(tx, actor.companyId, adv.refId!, t.bill.id, t.left);
    const owed = (await due()).reduce((n, t) => n + t.left, 0);
    const paying = p.payments.reduce((n, x) => n + x.amount, 0);
    if (paying > owed)
      throw new AppError(
        400,
        'VALIDATION_FAILED',
        `Only ${formatINR(BigInt(owed))} is left to pay on this folio`,
      );
    for (const x of p.payments) {
      const mode = modes.get(x.modeId)!;
      let left = x.amount;
      for (const t of await due()) {
        const part = Math.min(left, t.left);
        if (part <= 0) continue;
        // One receipt for each paper it pays, in that paper's name.
        const receipt = await createBillIn(
          tx,
          actor,
          {
            type: 'RECEIPT',
            partyId: t.bill.partyId,
            date: hotel.businessDate,
            branchId: hotel.branchId,
            lines: [],
            charges: [],
            discount: 0,
            taxInclusive: false,
            amount: part,
            modeId: mode.id,
            reference: x.reference ?? null,
            note: `Stay ${stay.number}`,
          },
          {
            system: true,
            allocate: [{ billId: t.bill.id, amount: part }],
            source: { type: 'folio', id: folio.id },
          },
        );
        await tx.folioLine.create({
          data: {
            companyId: actor.companyId,
            folioId,
            stayId: stay.id,
            day: hotel.businessDate,
            kind: 'PAYMENT',
            text: `${mode.name} ${receipt.number}`,
            amount: BigInt(part),
            refType: 'receipt',
            refId: receipt.id,
            postedById: actor.userId,
          },
        });
        left -= part;
      }
    }
    const after = await due();
    const unpaid = after.reduce((n, t) => n + t.left, 0);
    if (unpaid > 0) {
      const onlyInvoice = after.every((t) => t.left === 0 || t.bill.id === invoice?.id);
      if (!p.onCredit || folio.partyId === stay.partyId || !onlyInvoice)
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          `${formatINR(BigInt(unpaid))} is still to pay on this folio`,
        );
    }
    await tx.folio.update({
      where: { id: folioId },
      data: { status: 'CLOSED', billId: invoice?.id ?? null, closedAt: new Date() },
    });
    await writeAudit(tx, ctx, {
      action: 'hotel.folio_closed',
      entityType: 'stay',
      entityId: stay.id,
      after: { folio: folio.no, invoice: invoice?.number ?? null, paid: paying, onCredit: unpaid },
    });
  });
  const closed = await db.folio.findUniqueOrThrow({ where: { id: folioId } });
  // An advance bigger than the bill: what is left is still the payer's, to be returned in Money.
  let advanceLeft = 0;
  for (const l of await db.folioLine.findMany({
    where: { folioId, kind: 'PAYMENT', refType: 'advance', voided: false },
  }))
    advanceLeft += await db.$transaction((tx) => creditLeft(tx, actor.companyId, l.refId!));
  return { ...(await folioView(db, hotel, closed)), advanceLeft };
}

export const creditSchema = z.object({
  amount: z.number().int().min(1).max(1e13),
  reason: z.string().trim().min(3).max(200),
});
/** After the invoice is made, a correction is a credit note against it (a supervisor's, with why). */
export async function creditFolio(
  db: Db,
  actor: Actor,
  folioId: string,
  input: z.input<typeof creditSchema>,
) {
  supervisor(actor);
  const c = creditSchema.parse(input);
  const folio = await db.folio.findFirst({ where: { id: folioId, companyId: actor.companyId } });
  if (!folio) throw notFound('Folio');
  const hotel = await hotelOf(db, actor, folio.branchId);
  if (!folio.billId)
    throw new AppError(409, 'CONFLICT', 'This folio has no invoice yet — take the charge off instead');
  const note = await db.$transaction((tx) =>
    createBillIn(
      tx,
      actor,
      {
        type: 'CREDIT_NOTE',
        partyId: folio.partyId,
        date: hotel.businessDate,
        branchId: hotel.branchId,
        againstId: folio.billId,
        lines: [{ item: c.reason, qty: 1, rate: c.amount }],
        charges: [],
        discount: 0,
        taxInclusive: true,
        note: c.reason,
      },
      { issue: true, system: true, source: { type: 'folio_credit', id: folio.id } },
    ),
  );
  return { id: note.id, number: note.number, total: Number(note.total) };
}

/** Give an advance back before it was used (a cancelled booking): the paper is voided and the line struck out. */
export async function refundAdvance(db: Db, actor: Actor, lineId: string, input: { reason?: string | null }) {
  desk(actor);
  const line = await db.folioLine.findFirst({
    where: { id: lineId, companyId: actor.companyId, kind: 'PAYMENT', refType: 'advance', voided: false },
  });
  if (!line) throw notFound('Advance');
  const folio = await db.folio.findUniqueOrThrow({ where: { id: line.folioId } });
  await hotelOf(db, actor, folio.branchId);
  const bill = await db.bill.findUniqueOrThrow({ where: { id: line.refId! } });
  if (bill.settled > 0n)
    throw new AppError(409, 'CONFLICT', 'Part of this advance was already used on a bill');
  const reason = input.reason?.trim() || 'Advance returned';
  await voidBill(
    db,
    { ...actor, permissions: [...actor.permissions, 'money.edit'] } as Actor,
    bill.id,
    reason,
  );
  await db.$transaction(async (tx) => {
    await tx.folioLine.update({ where: { id: lineId }, data: { voided: true, voidReason: reason } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.advance_refunded',
      entityType: 'stay',
      entityId: line.stayId,
      after: { number: bill.number, amount: Number(bill.total), reason },
    });
  });
  return { ok: true, number: bill.number };
}
