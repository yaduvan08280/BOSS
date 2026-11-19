import { describe, expect, it } from 'vitest';
import { splitExact } from '../crm/split';
import type { BILL_TYPES } from '../machines/bill';
import { computeBill, voucherFor, type BillTotals } from './bill';
import type { TaxRegime } from './tax';

/** A small seeded generator: the same thousands of papers on every run, so a failure can be found again. */
function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
  return { next, int, pick };
}
const RATES: Record<string, number> = {
  GST0: 0,
  GST5: 5,
  GST12: 12,
  GST18: 18,
  GST28: 28,
  VAT: 13.5,
  ODD: 7.25,
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function randomPaper(r: ReturnType<typeof seeded>) {
  const regime = r.pick<TaxRegime>(['GST', 'GST', 'GST', 'VAT', 'SALES_TAX', 'NONE']);
  const lines = Array.from({ length: r.int(1, 12) }, () => ({
    item: 'x',
    // Quantities with three decimals (grams of gold, litres), rates from a few paise to lakhs.
    qty: r.pick([1, 2, 3, 0.5, 0.25, 1.375, r.int(1, 500), r.int(1, 99999) / 1000]),
    rate: r.pick([r.int(1, 99), r.int(100, 99_999), r.int(1_00_000, 9_99_99_999), 33_33, 1]),
    discount: r.next() < 0.25 ? r.int(0, 500) : 0,
    taxCode: r.pick(Object.keys(RATES)),
  }));
  const charges = Array.from({ length: r.int(0, 3) }, (_, i) => ({
    name: `charge ${i}`,
    amount: r.int(0, 50_000),
    taxCode: r.pick([null, 'GST5', 'GST18']),
  }));
  const input = {
    lines,
    charges,
    discount: r.next() < 0.35 ? r.int(0, 2_00_000) : 0,
    taxInclusive: r.next() < 0.4,
    regime,
    sameState: r.next() < 0.6,
    percentOf: (code: string | null | undefined) => (code ? (RATES[code] ?? 0) : 0),
    roundTo: r.pick([1, 100, 100, 100, 5]),
  };
  return { input, out: computeBill(input) };
}

describe('money adds up to the paisa (4,000 papers made from a seed)', () => {
  const papers: ReturnType<typeof randomPaper>[] = [];
  const r = seeded(20261119);
  for (let i = 0; i < 4000; i++) papers.push(randomPaper(r));

  it('every amount is a whole number of paise, and none is negative but the round-off', () => {
    for (const { out } of papers) {
      const amounts = [
        out.taxable,
        out.tax,
        out.total,
        ...out.taxes.map((t) => t.amount),
        ...[...out.lines, ...out.charges].flatMap((x) => [
          x.taxable,
          x.total,
          ...x.taxes.map((t) => t.amount),
        ]),
      ];
      for (const a of amounts) expect(Number.isSafeInteger(a) && a >= 0, String(a)).toBe(true);
      expect(Number.isSafeInteger(out.roundOff)).toBe(true);
    }
  });

  it('lines + charges + round-off = total; the taxes shown = the tax charged; before tax + tax = what is asked', () => {
    for (const { out } of papers) {
      const parts = [...out.lines, ...out.charges];
      expect(sum(parts.map((x) => x.total)) + out.roundOff).toBe(out.total);
      expect(sum(parts.map((x) => x.taxable))).toBe(out.taxable);
      expect(sum(out.taxes.map((t) => t.amount))).toBe(out.tax);
      expect(out.taxable + out.tax + out.roundOff).toBe(out.total);
      for (const x of parts) expect(sum(x.taxes.map((t) => t.amount))).toBe(x.total - x.taxable);
    }
  });

  it('the total is a whole unit, and rounding never moves it by more than half a unit', () => {
    for (const { input, out } of papers) {
      expect(out.total % input.roundTo).toBe(0);
      expect(Math.abs(out.roundOff) * 2).toBeLessThanOrEqual(input.roundTo);
    }
  });

  it('inside one state the tax is CGST + SGST, a paisa apart at most; across states one IGST; no tax, none', () => {
    for (const { input, out } of papers)
      for (const x of [...out.lines, ...out.charges]) {
        const tax = x.total - x.taxable;
        if (!tax) {
          expect(x.taxes).toEqual([]);
          continue;
        }
        if (input.regime !== 'GST') expect(x.taxes).toHaveLength(1);
        else if (!input.sameState) expect(x.taxes.map((t) => t.name)).toEqual(['IGST']);
        else {
          expect(x.taxes.map((t) => t.name).sort()).toEqual(['CGST', 'SGST']);
          expect(Math.abs(x.taxes[0]!.amount - x.taxes[1]!.amount)).toBeLessThanOrEqual(1);
        }
      }
  });

  it('a discount on the whole paper comes off the lines exactly; a price that holds the tax is what is paid', () => {
    for (const { input, out } of papers) {
      const gross = input.lines.map((l) => Math.max(0, Math.round(l.qty * l.rate) - l.discount));
      const cut = Math.min(input.discount, sum(gross));
      // What the buyer pays for the lines (before round-off) with tax inside the price: the prices less the discount.
      if (input.taxInclusive || input.regime === 'NONE')
        expect(sum(out.lines.map((l) => l.total))).toBe(sum(gross) - cut);
      else expect(sum(out.lines.map((l) => l.taxable))).toBe(sum(gross) - cut);
    }
  });

  it('every paper books a voucher that balances, names the party for the total, and carries each tax', () => {
    const r2 = seeded(7);
    const book = (out: BillTotals, type: (typeof BILL_TYPES)[number]) =>
      voucherFor({
        type,
        partyId: 'p1',
        taxable: out.taxable,
        taxes: out.taxes,
        charges: out.charges.map((c) => ({ name: c.name, taxable: c.taxable })),
        roundOff: out.roundOff,
        total: out.total,
        mode: 'cash',
      });
    for (const { out } of papers) {
      const type = r2.pick(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_BILL'] as const);
      const v = book(out, type);
      expect(sum(v.map((l) => l.debit))).toBe(sum(v.map((l) => l.credit)));
      const party = v.filter((l) => l.partyId === 'p1');
      // (A paper worth nothing — the discount ate it all — books no line for the party.)
      expect(party).toHaveLength(out.total ? 1 : 0);
      expect(party.reduce((n, l) => n + l.debit + l.credit, 0)).toBe(out.total);
      const taxLines = v.filter((l) => l.head.startsWith('tax_'));
      expect(sum(taxLines.map((l) => l.debit + l.credit))).toBe(out.tax);
      for (const l of v)
        expect(l.debit >= 0 && l.credit >= 0 && Number.isSafeInteger(l.debit + l.credit)).toBe(true);
    }
    // Money papers (a receipt, a payment, an advance) balance too.
    for (const type of ['RECEIPT', 'ADVANCE', 'VENDOR_PAYMENT'] as const) {
      const v = voucherFor({
        type,
        partyId: 'p1',
        taxable: 0,
        taxes: [],
        charges: [],
        roundOff: 0,
        total: 12_345_67,
        mode: 'upi',
      });
      expect(sum(v.map((l) => l.debit))).toBe(sum(v.map((l) => l.credit)));
      expect(sum(v.map((l) => l.debit))).toBe(12_345_67);
    }
  });

  it('a split never loses or invents a paisa, whatever the shares and the rounding unit', () => {
    const r3 = seeded(99);
    for (let i = 0; i < 4000; i++) {
      const unit = r3.pick([1, 1, 100, 1000, 10_000]);
      const total = r3.int(0, 5_00_00_000);
      const weights = Array.from({ length: r3.int(1, 14) }, () =>
        r3.pick([0, 1, r3.int(1, 1000), r3.next() * 50]),
      );
      const parts = splitExact(total, weights, unit);
      expect(parts).toHaveLength(weights.length);
      expect(sum(parts)).toBe(total);
      for (const p of parts) expect(p >= 0 && Number.isSafeInteger(p)).toBe(true);
    }
  });
});
