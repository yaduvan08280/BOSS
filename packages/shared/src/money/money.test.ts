import { describe, expect, it } from 'vitest';
import { billMachine } from '../machines/bill';
import { transition } from '../machines/transition';
import { computeBill, voucherFor } from './bill';
import { percentFor, rateOn, splitTax, type TaxRateRow } from './tax';

const RATES: TaxRateRow[] = [
  { code: 'GST5', name: 'GST 5%', percent: 5, from: '2020-01-01' },
  { code: 'GST18', name: 'GST 18%', percent: 18, from: '2020-01-01' },
  // Liquor moved from 18% to 28% on 1 April 2031.
  { code: 'BAR', name: 'Bar', percent: 18, from: '2020-01-01' },
  { code: 'BAR', name: 'Bar', percent: 28, from: '2031-04-01' },
  // A room night: up to ₹7,500 → 12%, above → 18%.
  {
    code: 'ROOM',
    name: 'Room tariff',
    percent: 12,
    from: '2020-01-01',
    slabs: [
      { upTo: 7_500_00, percent: 12 },
      { upTo: null, percent: 18 },
    ],
  },
];
const on = (date: string) => (code: string | null | undefined, unit: number) =>
  percentFor(RATES, code, date, unit);

describe('money core rules (phase 12M)', () => {
  it('U13: a rate applies from its date — a bill before the change keeps the old rate', () => {
    expect(rateOn(RATES, 'BAR', '2031-03-31')!.percent).toBe(18);
    expect(rateOn(RATES, 'BAR', '2031-04-01')!.percent).toBe(28);
    expect(rateOn(RATES, 'BAR', '2019-12-31')).toBeNull();
    const peg = { item: 'Whisky 60 ml', qty: 2, rate: 400_00, taxCode: 'BAR' };
    const before = computeBill({ lines: [peg], regime: 'VAT', sameState: true, percentOf: on('2031-03-31') });
    const after = computeBill({ lines: [peg], regime: 'VAT', sameState: true, percentOf: on('2031-04-01') });
    expect([before.tax, after.tax]).toEqual([144_00, 224_00]);
    // A code nobody typed a rate for charges nothing (and never throws).
    expect(percentFor(RATES, 'NOPE', '2031-01-01', 100)).toBe(0);
  });

  it('U13: tax inside the price or on top of it', () => {
    const line = { item: 'Thali', qty: 1, rate: 210_00, taxCode: 'GST5' };
    const onTop = computeBill({ lines: [line], regime: 'GST', sameState: true, percentOf: on('2031-01-01') });
    expect(onTop).toMatchObject({ taxable: 210_00, tax: 10_50, total: 220_50 });
    const inside = computeBill({
      lines: [line],
      taxInclusive: true,
      regime: 'GST',
      sameState: true,
      percentOf: on('2031-01-01'),
    });
    expect(inside).toMatchObject({ taxable: 200_00, tax: 10_00, total: 210_00 });
  });

  it('U14: same state → CGST + SGST; another state → IGST; VAT is one tax; no tax is none', () => {
    expect(splitTax('GST', 18, 1801, true)).toEqual([
      { name: 'CGST', percent: 9, amount: 900 },
      { name: 'SGST', percent: 9, amount: 901 },
    ]);
    expect(splitTax('GST', 18, 1801, false)).toEqual([{ name: 'IGST', percent: 18, amount: 1801 }]);
    expect(splitTax('VAT', 5, 500, true)).toEqual([{ name: 'VAT', percent: 5, amount: 500 }]);
    expect(splitTax('NONE', 5, 500, true)).toEqual([]);
    // A "no tax" entity ignores the codes on its lines.
    const free = computeBill({
      lines: [{ item: 'Thali', qty: 1, rate: 210_00, taxCode: 'GST5' }],
      regime: 'NONE',
      sameState: true,
      percentOf: on('2031-01-01'),
    });
    expect(free).toMatchObject({ tax: 0, total: 210_00, taxes: [] });
  });

  it('U15: tax by price slab — the rate follows the price of one unit', () => {
    const stay = (rate: number) =>
      computeBill({
        lines: [{ item: 'Room night', qty: 2, rate, taxCode: 'ROOM' }],
        regime: 'GST',
        sameState: true,
        percentOf: on('2031-01-01'),
      });
    expect(stay(7_500_00).lines[0]!.taxPercent).toBe(12);
    expect(stay(7_500_01).lines[0]!.taxPercent).toBe(18);
    expect(stay(6_000_00).tax).toBe(1_440_00);
  });

  it('U16: two tax rates, a line discount, a paper discount, a taxed charge and round-off on one paper', () => {
    const bill = computeBill({
      lines: [
        { item: 'Paneer tikka', qty: 2, rate: 320_00, taxCode: 'GST5' },
        { item: 'Soft drink', qty: 3, rate: 60_00, discount: 30_00, taxCode: 'GST18' },
      ],
      charges: [{ name: 'Service charge', amount: 50_00, taxCode: 'GST5' }],
      discount: 79_00,
      regime: 'GST',
      sameState: true,
      percentOf: on('2031-01-01'),
      roundTo: 100,
    });
    // ₹640 and ₹150 before the paper's ₹79 discount, shared 64 : 15.
    expect(bill.lines.map((l) => l.taxable)).toEqual([576_00, 135_00]);
    expect(bill.taxable).toBe(576_00 + 135_00 + 50_00);
    // 5% of 576 + 5% of 50 = 31.30; 18% of 135 = 24.30.
    expect(bill.tax).toBe(28_80 + 2_50 + 24_30);
    expect(bill.taxes.map((t) => `${t.name} ${t.percent}% ${t.amount}`).sort()).toEqual([
      'CGST 2.5% 1565',
      'CGST 9% 1215',
      'SGST 2.5% 1565',
      'SGST 9% 1215',
    ]);
    // 761.00 + 55.60 = 816.60 → ₹817, with 40 paise of round-off.
    expect(bill).toMatchObject({ total: 817_00, roundOff: 40 });
    // The parts always add up.
    expect(bill.taxable + bill.tax + bill.roundOff).toBe(bill.total);
  });

  it('U17: draft → issued → part paid → paid; cancelled only by a full credit note; money papers are voided', () => {
    const go = (from: string, action: string, ctx: object, roles: string[] = ['accounts']) =>
      transition(billMachine, { from, action, roles, ctx } as never).to;
    const owed = (due: number) => ({ due, total: 1000, money: false });
    expect(go('DRAFT', 'issue', owed(1000), ['maker'])).toBe('ISSUED');
    expect(go('ISSUED', 'settle', owed(400))).toBe('PART_PAID');
    expect(go('PART_PAID', 'settle', owed(0))).toBe('PAID');
    // A voided receipt puts the money owed back.
    expect(go('PAID', 'settle', owed(1000))).toBe('ISSUED');
    // A part credit lowers what is owed; a credit for everything cancels the paper.
    expect(go('ISSUED', 'credit', { due: 600, total: 600, money: false })).toBe('ISSUED');
    expect(go('PART_PAID', 'credit', { due: 0, total: 0, money: false })).toBe('CANCELLED');
    // An issued paper can't be discarded, a cancelled one is final, a maker can't settle.
    expect(() => go('ISSUED', 'discard', owed(1000))).toThrow();
    expect(() => go('CANCELLED', 'issue', owed(1000))).toThrow();
    expect(() => go('ISSUED', 'settle', owed(0), ['maker'])).toThrow();
    expect(go('DRAFT', 'discard', owed(1000), ['maker'])).toBe('CANCELLED');
    // Money papers: voided, never "settled" or credited.
    expect(go('ISSUED', 'void', { due: 0, total: 500, money: true })).toBe('CANCELLED');
    expect(() => go('ISSUED', 'void', owed(1000))).toThrow();
    expect(() => go('ISSUED', 'settle', { due: 0, total: 500, money: true })).toThrow();
  });

  it('U20: every paper books as balanced debit and credit lines', () => {
    const totals = computeBill({
      lines: [
        { item: 'Paneer tikka', qty: 2, rate: 320_00, taxCode: 'GST5' },
        { item: 'Soft drink', qty: 3, rate: 60_00, taxCode: 'GST18' },
      ],
      charges: [{ name: 'Packing', amount: 20_00 }],
      regime: 'GST',
      sameState: true,
      percentOf: on('2031-01-01'),
      roundTo: 100,
    });
    const paper = { partyId: 'p1', ...totals };
    const sum = (lines: { debit: number; credit: number }[]) => [
      lines.reduce((n, l) => n + l.debit, 0),
      lines.reduce((n, l) => n + l.credit, 0),
    ];
    const invoice = voucherFor({ type: 'INVOICE', ...paper });
    // Both sides are equal (here the total plus the 40 paise rounded away, booked to round-off).
    expect(sum(invoice)[0]).toBe(sum(invoice)[1]);
    expect(totals.roundOff).toBe(-40);
    expect(invoice[0]).toEqual({ head: 'receivable', partyId: 'p1', debit: totals.total, credit: 0 });
    expect(invoice.map((l) => l.head)).toEqual(
      expect.arrayContaining(['sales', 'charges:Packing', 'tax_output:CGST', 'tax_output:SGST', 'round_off']),
    );
    // A credit note is the invoice turned round; a purchase bill books input tax and a payable.
    const credit = voucherFor({ type: 'CREDIT_NOTE', ...paper });
    expect(credit[0]).toEqual({ head: 'receivable', partyId: 'p1', debit: 0, credit: totals.total });
    const purchase = voucherFor({ type: 'PURCHASE_BILL', ...paper });
    expect(purchase.at(-1)).toEqual({ head: 'payable', partyId: 'p1', debit: 0, credit: totals.total });
    expect(purchase.some((l) => l.head === 'tax_input:CGST' && l.debit > 0)).toBe(true);
    for (const v of [credit, purchase]) expect(sum(v)[0]).toBe(sum(v)[1]);
    // Money papers.
    const money = { partyId: 'p1', taxable: 500_00, taxes: [], charges: [], roundOff: 0, total: 500_00 };
    expect(voucherFor({ type: 'RECEIPT', ...money, mode: 'upi' })).toEqual([
      { head: 'cash:upi', partyId: undefined, debit: 500_00, credit: 0 },
      { head: 'receivable', partyId: 'p1', debit: 0, credit: 500_00 },
    ]);
    expect(voucherFor({ type: 'VENDOR_PAYMENT', ...money, mode: 'bank' })[0]).toMatchObject({
      head: 'payable',
      debit: 500_00,
    });
    expect(voucherFor({ type: 'ADVANCE', ...money })[1]).toMatchObject({
      head: 'advance_received',
      credit: 500_00,
    });
    // A challan moves goods, not money.
    expect(voucherFor({ type: 'CHALLAN', ...paper })).toEqual([]);
  });
});
