import { z } from 'zod';
import { BILL_TYPES } from '../machines/bill';
import { splitExact } from '../crm/split';
import { splitTax, type TaxPart, type TaxRegime } from './tax';

/** What a person types for a paper with lines. Amounts are whole minor units of the bill's currency. */
export const billLineSchema = z.object({
  item: z.string().trim().min(1, 'Name the item').max(200),
  /** HSN (goods) or SAC (services), printed on tax papers. */
  hsn: z.string().trim().max(12).nullish(),
  qty: z.number().positive('Enter a quantity').max(1_000_000_000),
  unit: z.string().trim().max(20).nullish(),
  /** The price of one unit. */
  rate: z.number().int().min(0),
  /** Taken off this line, before tax. */
  discount: z.number().int().min(0).optional(),
  taxCode: z.string().trim().max(20).nullish(),
});
export type BillLineInput = z.infer<typeof billLineSchema>;

/** Service charge, packing, freight, making charges … added after the lines; taxed when given a code. */
export const billChargeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  amount: z.number().int().min(0),
  taxCode: z.string().trim().max(20).nullish(),
});
export type BillChargeInput = z.infer<typeof billChargeSchema>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date');
export const billInputSchema = z.object({
  type: z.enum(BILL_TYPES),
  partyId: z.string().max(40),
  date: day,
  /** The branch it is made at (its entity gives the series, the letterhead, the currency and the tax regime). */
  branchId: z.string().max(40).nullish(),
  lines: z.array(billLineSchema).max(500).default([]),
  charges: z.array(billChargeSchema).max(20).default([]),
  /** Taken off the whole paper before tax, shared over the lines in proportion. */
  discount: z.number().int().min(0).default(0),
  /** The prices typed already hold the tax (a menu price, an MRP). */
  taxInclusive: z.boolean().default(false),
  dueOn: day.nullish(),
  /** A credit or debit note: the paper it corrects. */
  againstId: z.string().max(40).nullish(),
  /** Money papers: how much, and by which mode (cash, UPI …). */
  amount: z.number().int().min(0).optional(),
  modeId: z.string().max(40).nullish(),
  reference: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type BillInput = z.infer<typeof billInputSchema>;

export type BillLineOut = BillLineInput & {
  /** What the line is worth before tax, after its own and its share of the paper's discount. */
  taxable: number;
  taxPercent: number;
  taxes: TaxPart[];
  total: number;
};
export type BillChargeOut = BillChargeInput & {
  taxable: number;
  taxPercent: number;
  taxes: TaxPart[];
  total: number;
};
export type BillTotals = {
  lines: BillLineOut[];
  charges: BillChargeOut[];
  /** Before tax: lines and charges after discounts. */
  taxable: number;
  /** Tax by name and rate, summed over the paper ("CGST 2.5%", "CGST 9%"). */
  taxes: TaxPart[];
  tax: number;
  /** What rounding to a whole unit added (or took off, when negative). */
  roundOff: number;
  total: number;
};

/**
 * Work a paper out. One rule for a counter bill, a stay bill, a purchase bill or a credit note: each line and
 * charge gets its own tax (so two rates on one paper are simply two lines), prices may already hold the tax, and
 * the total is rounded to a whole unit of the currency with the difference shown as round-off.
 */
export function computeBill(input: {
  lines: BillLineInput[];
  charges?: BillChargeInput[];
  discount?: number;
  taxInclusive?: boolean;
  regime: TaxRegime;
  /** GST only: the buyer's state is the seller's (CGST + SGST) or not (IGST). */
  sameState: boolean;
  /** The percent for a tax code at a unit price (the bill's date is already inside this). */
  percentOf: (taxCode: string | null | undefined, unitPrice: number) => number;
  /** Minor units in one whole unit (100 for rupees): the total is rounded to it. 1 = no rounding. */
  roundTo?: number;
}): BillTotals {
  const gross = input.lines.map((l) => Math.max(0, Math.round(l.qty * l.rate) - (l.discount ?? 0)));
  // The paper's own discount is shared over the lines in proportion to what each is worth.
  const cut = Math.min(
    input.discount ?? 0,
    gross.reduce((a, b) => a + b, 0),
  );
  const share = cut ? splitExact(cut, gross) : gross.map(() => 0);
  const part = (net: number, percent: number) => {
    if (input.regime === 'NONE' || !percent) return { taxable: net, tax: 0 };
    if (input.taxInclusive) {
      const taxable = Math.round(net / (1 + percent / 100));
      return { taxable, tax: net - taxable };
    }
    return { taxable: net, tax: Math.round((net * percent) / 100) };
  };
  const lines: BillLineOut[] = input.lines.map((l, i) => {
    const percent = input.regime === 'NONE' ? 0 : input.percentOf(l.taxCode, l.rate);
    const { taxable, tax } = part(gross[i]! - share[i]!, percent);
    return {
      ...l,
      taxable,
      taxPercent: percent,
      taxes: splitTax(input.regime, percent, tax, input.sameState),
      total: taxable + tax,
    };
  });
  const charges: BillChargeOut[] = (input.charges ?? []).map((c) => {
    const percent = input.regime === 'NONE' ? 0 : input.percentOf(c.taxCode, c.amount);
    const { taxable, tax } = part(c.amount, percent);
    return {
      ...c,
      taxable,
      taxPercent: percent,
      taxes: splitTax(input.regime, percent, tax, input.sameState),
      total: taxable + tax,
    };
  });
  const all = [...lines, ...charges];
  const byName = new Map<string, TaxPart>();
  for (const t of all.flatMap((x) => x.taxes)) {
    const key = `${t.name}|${t.percent}`;
    const have = byName.get(key);
    if (have) have.amount += t.amount;
    else byName.set(key, { ...t });
  }
  const taxable = all.reduce((n, x) => n + x.taxable, 0);
  const tax = all.reduce((n, x) => n + x.total - x.taxable, 0);
  const exact = taxable + tax;
  const unit = Math.max(1, Math.round(input.roundTo ?? 1));
  const total = Math.round(exact / unit) * unit;
  return { lines, charges, taxable, taxes: [...byName.values()], tax, roundOff: total - exact, total };
}

/** One line of a voucher: a MONO head, debited or credited. A party's own head carries the party. */
export type VoucherLine = { head: string; partyId?: string | null; debit: number; credit: number };

/**
 * The books of one paper as balanced debit and credit lines against MONO heads (phase 12M: vouchers are kept
 * this way so a full ledger can be added later, and so they can be sent to Tally through a head → ledger map).
 * Throws if the lines do not balance — a paper that cannot be booked must never be issued.
 */
export function voucherFor(bill: {
  type: (typeof BILL_TYPES)[number];
  partyId: string;
  taxable: number;
  taxes: TaxPart[];
  charges: { name: string; taxable: number }[];
  roundOff: number;
  total: number;
  /** Money papers: the mode's head ("cash", "upi", "bank" …). */
  mode?: string | null;
}): VoucherLine[] {
  const dr = (head: string, amount: number, partyId?: string): VoucherLine => ({
    head,
    partyId,
    debit: amount,
    credit: 0,
  });
  const cr = (head: string, amount: number, partyId?: string): VoucherLine => ({
    head,
    partyId,
    debit: 0,
    credit: amount,
  });
  const goods = bill.taxable - bill.charges.reduce((n, c) => n + c.taxable, 0);
  const cashHead = `cash:${bill.mode ?? 'cash'}`;
  let lines: VoucherLine[];
  const sale = (flip: boolean) => {
    const a = flip ? cr : dr;
    const b = flip ? dr : cr;
    return [
      a('receivable', bill.total, bill.partyId),
      b('sales', goods),
      ...bill.charges.filter((c) => c.taxable).map((c) => b(`charges:${c.name}`, c.taxable)),
      ...bill.taxes.map((t) => b(`tax_output:${t.name}`, t.amount)),
      ...(bill.roundOff
        ? [bill.roundOff > 0 ? b('round_off', bill.roundOff) : a('round_off', -bill.roundOff)]
        : []),
    ];
  };
  switch (bill.type) {
    case 'INVOICE':
    case 'DEBIT_NOTE':
      lines = sale(false);
      break;
    case 'CREDIT_NOTE':
      lines = sale(true);
      break;
    case 'PURCHASE_BILL':
      lines = [
        dr('purchases', goods),
        ...bill.charges.filter((c) => c.taxable).map((c) => dr(`charges:${c.name}`, c.taxable)),
        ...bill.taxes.map((t) => dr(`tax_input:${t.name}`, t.amount)),
        ...(bill.roundOff
          ? [bill.roundOff > 0 ? dr('round_off', bill.roundOff) : cr('round_off', -bill.roundOff)]
          : []),
        cr('payable', bill.total, bill.partyId),
      ];
      break;
    case 'RECEIPT':
      lines = [dr(cashHead, bill.total), cr('receivable', bill.total, bill.partyId)];
      break;
    case 'ADVANCE':
      lines = [dr(cashHead, bill.total), cr('advance_received', bill.total, bill.partyId)];
      break;
    case 'VENDOR_PAYMENT':
      lines = [dr('payable', bill.total, bill.partyId), cr(cashHead, bill.total)];
      break;
    default:
      // A delivery challan moves goods, not money: nothing to book.
      lines = [];
  }
  lines = lines.filter((l) => l.debit || l.credit);
  const debit = lines.reduce((n, l) => n + l.debit, 0);
  const credit = lines.reduce((n, l) => n + l.credit, 0);
  if (debit !== credit) throw new Error(`voucherFor: ${bill.type} does not balance (${debit} / ${credit})`);
  return lines;
}
