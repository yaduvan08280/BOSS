import type { Db, Folio, FolioLine, Tx } from '@mono/db';
import { FOLIO_KINDS, routingSchema } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { ctxOf } from '../hosp/access';
import { createBillIn, dueOf, workOutBill } from '../money/bills';
import type { Actor } from '../work/actor';
import { desk, hotelOf, seer, stayOf, supervisor, type Hotel } from './core';
import { postCharge } from './folio-core';

/**
 * Phase 17 — the guest folio: charges before tax (room nights, restaurant bills sent to the room, minibar,
 * laundry, extras), advances and payments, several folios on one stay with routing, and moving lines between
 * folios — of the same stay (a split) or of another room (a transfer).
 */
const lineView = (l: FolioLine) => ({
  id: l.id,
  day: l.day,
  kind: l.kind,
  text: l.text,
  qty: Number(l.qty),
  amount: Number(l.amount),
  taxCode: l.taxCode,
  refType: l.refType,
  refId: l.refId,
  voided: l.voided,
  voidReason: l.voidReason,
});
/** A restaurant bill sent to the room: it is its own tax invoice, so it is not invoiced again by the folio. */
export const isPosLine = (l: Pick<FolioLine, 'kind' | 'refType'>) =>
  l.kind === 'FOOD' && l.refType === 'pos_check';
export const liveLines = (lines: FolioLine[]) => lines.filter((l) => !l.voided);

/** The invoice lines a folio's charges make (everything but restaurant bills and money). */
export const invoiceLines = (lines: FolioLine[]) =>
  liveLines(lines)
    .filter((l) => l.kind !== 'PAYMENT' && !isPosLine(l))
    .map((l) => {
      const qty = Number(l.qty);
      const amount = Number(l.amount);
      const whole = Number.isInteger(amount / qty);
      return {
        item: l.text,
        qty: whole ? qty : 1,
        rate: whole ? amount / qty : amount,
        taxCode: l.taxCode,
        hsn: l.hsn,
      };
    });

/** What a folio comes to: its charges with tax as the invoice would work them out, restaurant bills, money in. */
export async function folioTotals(db: Db | Tx, hotel: Hotel, folio: Folio, lines: FolioLine[]) {
  const live = liveLines(lines);
  const invoice = invoiceLines(lines);
  const worked = invoice.length
    ? (
        await workOutBill(
          db,
          hotel.companyId,
          {
            type: 'INVOICE',
            partyId: folio.partyId,
            date: hotel.businessDate,
            branchId: hotel.branchId,
            lines: invoice,
            charges: [],
            discount: 0,
            taxInclusive: false,
          },
          hotel.branchId,
        )
      ).totals
    : null;
  const pos = live.filter(isPosLine).reduce((n, l) => n + Number(l.amount), 0);
  const paid = live.filter((l) => l.kind === 'PAYMENT').reduce((n, l) => n + Number(l.amount), 0);
  const total = (worked?.total ?? 0) + pos;
  return {
    charges: worked?.taxable ?? 0,
    tax: worked?.tax ?? 0,
    taxes: worked?.taxes ?? [],
    restaurant: pos,
    total,
    paid,
    due: total - paid,
  };
}

export async function folioView(db: Db | Tx, hotel: Hotel, folio: Folio) {
  const lines = await db.folioLine.findMany({ where: { folioId: folio.id }, orderBy: { createdAt: 'asc' } });
  const bill = folio.billId ? await db.bill.findUnique({ where: { id: folio.billId } }) : null;
  return {
    id: folio.id,
    no: folio.no,
    name: folio.name,
    partyId: folio.partyId,
    status: folio.status,
    invoice: bill
      ? { id: bill.id, number: bill.number, total: Number(bill.total), due: Math.max(0, dueOf(bill)) }
      : null,
    lines: lines.map(lineView),
    ...(await folioTotals(db, hotel, folio, lines)),
  };
}

export async function stayFolios(db: Db, actor: Actor, stayId: string) {
  seer(actor);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  const folios = await db.folio.findMany({ where: { stayId }, orderBy: { no: 'asc' } });
  const out = [];
  for (const f of folios) out.push(await folioView(db, hotel, f));
  return { stayId, routing: stay.routing ?? [], folios: out };
}

export const chargeSchema = z.object({
  kind: z.enum(['LAUNDRY', 'EXTRA']).default('EXTRA'),
  /** One of the property's listed extras, or a line typed by hand. */
  extraKey: z.string().max(30).nullish(),
  text: z.string().trim().min(1).max(120).optional(),
  qty: z.number().positive().max(999).default(1),
  /** The price of one, minor units (typed lines only). */
  price: z.number().int().min(0).max(1e12).optional(),
  taxCode: z.string().trim().max(20).nullish(),
  folioNo: z.number().int().min(1).max(9).optional(),
});
/** Laundry, an extra bed, a cab: a charge on the stay from the property's list, or typed. */
export async function addCharge(db: Db, actor: Actor, stayId: string, input: z.input<typeof chargeSchema>) {
  desk(actor);
  const c = chargeSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (stay.status !== 'CHECKED_IN') throw new AppError(409, 'CONFLICT', 'The guest is not in the hotel');
  const listed = c.extraKey ? hotel.rules.extras.find((e) => e.key === c.extraKey) : null;
  if (c.extraKey && !listed) throw notFound('Extra');
  const text = listed?.name ?? c.text;
  const price = listed?.price ?? c.price;
  if (!text || price === undefined)
    throw new AppError(400, 'VALIDATION_FAILED', 'Say what it is and its price');
  const taxCode = listed ? (listed.taxCode ?? null) : (c.taxCode ?? null);
  if (taxCode && !(await db.taxRate.count({ where: { companyId: actor.companyId, code: taxCode } })))
    throw new AppError(400, 'VALIDATION_FAILED', `There is no tax rate ${taxCode} in Money set-up`);
  return db.$transaction(async (tx) => {
    const line = await postCharge(tx, ctxOf(actor), hotel, stay, {
      kind: listed?.kind ?? c.kind,
      text,
      qty: c.qty,
      amount: Math.round(price * c.qty),
      taxCode,
      folioNo: c.folioNo,
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.charge_posted',
      entityType: 'stay',
      entityId: stayId,
      after: lineView(line),
    });
    return lineView(line);
  });
}

async function openFolio(db: Db | Tx, actor: Actor, folioId: string) {
  const folio = await db.folio.findFirst({ where: { id: folioId, companyId: actor.companyId } });
  if (!folio) throw notFound('Folio');
  const hotel = await hotelOf(db, actor, folio.branchId);
  if (folio.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'This folio is closed');
  return { folio, hotel };
}

export const voidSchema = z.object({ reason: z.string().trim().min(3).max(200) });
/** An allowance: a charge taken off a folio by a supervisor, with why. The line stays, struck through. */
export async function voidLine(db: Db, actor: Actor, lineId: string, input: z.input<typeof voidSchema>) {
  supervisor(actor);
  const { reason } = voidSchema.parse(input);
  const line = await db.folioLine.findFirst({ where: { id: lineId, companyId: actor.companyId } });
  if (!line) throw notFound('Line');
  await openFolio(db, actor, line.folioId);
  if (line.voided) throw new AppError(409, 'CONFLICT', 'That line is already taken off');
  if (line.kind === 'PAYMENT')
    throw new AppError(409, 'CONFLICT', 'Money is returned in Money, not taken off here');
  if (isPosLine(line)) throw new AppError(409, 'CONFLICT', 'Cancel the restaurant bill in the POS instead');
  return db.$transaction(async (tx) => {
    const after = await tx.folioLine.update({
      where: { id: lineId },
      data: { voided: true, voidReason: reason },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.charge_voided',
      entityType: 'stay',
      entityId: line.stayId,
      before: lineView(line),
      after: { reason },
    });
    return lineView(after);
  });
}

export const folioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Who pays it; left out, the guest. */
  partyId: z.string().max(40).nullish(),
});
export async function addFolio(db: Db, actor: Actor, stayId: string, input: z.input<typeof folioSchema>) {
  desk(actor);
  const f = folioSchema.parse(input);
  const { stay } = await stayOf(db, actor, stayId);
  if (!['BOOKED', 'CHECKED_IN'].includes(stay.status))
    throw new AppError(409, 'CONFLICT', 'This booking is closed');
  if (
    f.partyId &&
    !(await db.party.count({ where: { id: f.partyId, companyId: actor.companyId, deletedAt: null } }))
  )
    throw notFound('Party');
  return db.$transaction(async (tx) => {
    const last = await tx.folio.findFirst({ where: { stayId }, orderBy: { no: 'desc' } });
    const row = await tx.folio.create({
      data: {
        companyId: actor.companyId,
        branchId: stay.branchId,
        stayId,
        no: (last?.no ?? 0) + 1,
        name: f.name,
        partyId: f.partyId ?? stay.partyId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.folio_added',
      entityType: 'stay',
      entityId: stayId,
      after: { no: row.no, name: row.name, partyId: row.partyId },
    });
    return { id: row.id, no: row.no, name: row.name };
  });
}

export const routingBody = z.object({ routing: routingSchema });
/** Which folio kinds of charge go to from now on (lines already posted stay where they are). */
export async function setRouting(db: Db, actor: Actor, stayId: string, input: z.input<typeof routingBody>) {
  desk(actor);
  const { routing } = routingBody.parse(input);
  const { stay } = await stayOf(db, actor, stayId);
  const folios = await db.folio.findMany({ where: { stayId } });
  if (routing.some((r) => !folios.some((f) => f.no === r.folio && f.status === 'OPEN')))
    throw new AppError(400, 'VALIDATION_FAILED', 'A rule points at a folio that is not open');
  await db.$transaction(async (tx) => {
    await tx.stay.update({ where: { id: stayId }, data: { routing } });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.routing_set',
      entityType: 'stay',
      entityId: stayId,
      before: stay.routing,
      after: routing,
    });
  });
  return { routing };
}

export const moveSchema = z.object({
  lineIds: z.array(z.string().min(1)).min(1).max(200),
  toFolioId: z.string().min(1),
});
/**
 * Move charges to another open folio: of the same stay (splitting the bill) or of another room in the same
 * property (a folio transfer). Money lines don't move.
 */
export async function moveLines(db: Db, actor: Actor, folioId: string, input: z.input<typeof moveSchema>) {
  desk(actor);
  const p = moveSchema.parse(input);
  const { folio } = await openFolio(db, actor, folioId);
  const { folio: to } = await openFolio(db, actor, p.toFolioId);
  if (to.branchId !== folio.branchId)
    throw new AppError(400, 'VALIDATION_FAILED', 'That folio is at another property');
  if (to.id === folio.id) throw new AppError(400, 'VALIDATION_FAILED', 'Choose another folio');
  const lines = await db.folioLine.findMany({ where: { id: { in: p.lineIds }, folioId } });
  if (lines.length !== new Set(p.lineIds).size) throw notFound('Line');
  if (lines.some((l) => l.kind === 'PAYMENT' || l.voided))
    throw new AppError(409, 'CONFLICT', 'Only charges that still stand can be moved');
  await db.$transaction(async (tx) => {
    await tx.folioLine.updateMany({
      where: { id: { in: p.lineIds } },
      data: { folioId: to.id, stayId: to.stayId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: to.stayId === folio.stayId ? 'hotel.folio_split' : 'hotel.folio_transfer',
      entityType: 'stay',
      entityId: folio.stayId,
      after: { lines: p.lineIds.length, toFolioId: to.id, toStayId: to.stayId },
    });
  });
  return { moved: lines.length, toFolioId: to.id };
}

export const advanceSchema = z.object({
  modeId: z.string().min(1).max(40),
  amount: z.number().int().min(1).max(1e12),
  reference: z.string().trim().max(80).nullish(),
  folioNo: z.number().int().min(1).max(9).default(1),
});
/** Money taken before the bill is made: an ADVANCE paper in the name of whoever pays that folio. */
export async function takeAdvance(
  db: Db,
  actor: Actor,
  stayId: string,
  input: z.input<typeof advanceSchema>,
) {
  desk(actor);
  const a = advanceSchema.parse(input);
  const { stay, hotel } = await stayOf(db, actor, stayId);
  if (!['BOOKED', 'CHECKED_IN'].includes(stay.status))
    throw new AppError(409, 'CONFLICT', 'This booking is closed');
  const folio = await db.folio.findFirst({ where: { stayId, no: a.folioNo, status: 'OPEN' } });
  if (!folio) throw notFound('Folio');
  const mode = await db.paymentMode.findFirst({
    where: { id: a.modeId, companyId: actor.companyId, deletedAt: null, active: true },
  });
  if (!mode || ['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(mode.kind))
    throw new AppError(400, 'VALIDATION_FAILED', 'Choose how the money was paid');
  if (mode.needsRef && !a.reference)
    throw new AppError(400, 'VALIDATION_FAILED', `${mode.name} needs a reference`);
  return db.$transaction(async (tx) => {
    const bill = await createBillIn(
      tx,
      actor,
      {
        type: 'ADVANCE',
        partyId: folio.partyId,
        date: hotel.businessDate,
        branchId: hotel.branchId,
        lines: [],
        charges: [],
        discount: 0,
        taxInclusive: false,
        amount: a.amount,
        modeId: mode.id,
        reference: a.reference ?? null,
        note: `Advance — booking ${stay.number}`,
      },
      { system: true, source: { type: 'stay', id: stay.id } },
    );
    const line = await tx.folioLine.create({
      data: {
        companyId: actor.companyId,
        folioId: folio.id,
        stayId,
        day: hotel.businessDate,
        kind: 'PAYMENT',
        text: `Advance ${bill.number} — ${mode.name}`,
        amount: BigInt(a.amount),
        refType: 'advance',
        refId: bill.id,
        postedById: actor.userId,
      },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hotel.advance_taken',
      entityType: 'stay',
      entityId: stayId,
      after: { amount: a.amount, number: bill.number, folio: folio.no },
    });
    return { lineId: line.id, billId: bill.id, number: bill.number };
  });
}
export { FOLIO_KINDS };
