import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { billSums } from './bill-pdf';
import { books, ok, type BillOut } from './money-kit';

type Full = BillOut & {
  type: string;
  lines: { total: number; taxable: number }[];
  charges: { total: number; taxable: number }[];
  vouchers: { lines: { head: string; partyId?: string | null; debit: number; credit: number }[] }[];
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * One paper, four places: the screen (the bill as the API gives it), the printed bill (the totals block of the
 * PDF), the books (its voucher) and the report (money owed). They must say the same, to the paisa — also for
 * awkward amounts: three rates, tax inside the price, a discount, a round-off, a part payment.
 */
describe('the screen, the PDF, the voucher and the report agree to the paisa', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp();
  });
  afterAll(async () => ctx.app.close());

  it('an awkward invoice, then a part payment', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    await b.rate('GST12', 12);
    const draft = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-03-31',
      taxInclusive: true,
      discount: 33_33,
      lines: [
        { item: 'Thali', hsn: '996331', qty: 3, rate: 333_33, taxCode: 'GST5' },
        { item: 'Juice', qty: 7, rate: 47_77, taxCode: 'GST12' },
        { item: 'Mineral water', qty: 0.375, rate: 1999_99, taxCode: 'GST18' },
      ],
      charges: [{ name: 'Packing', amount: 17_17, taxCode: 'GST18' }],
    });
    const inv = await ok<BillOut>(w.api.post(`/api/money/bills/${draft.id}/issue`, {}));
    const check = async (settled: number) => {
      const screen = await ok<Full>(w.api.get(`/api/money/bills/${inv.id}`));
      // The screen adds up by itself.
      expect(sum([...screen.lines, ...screen.charges].map((x) => x.total)) + screen.roundOff).toBe(
        screen.total,
      );
      expect(sum(screen.taxes.map((t) => t.amount))).toBe(screen.tax);
      expect(screen.taxable + screen.tax + screen.roundOff).toBe(screen.total);
      expect(screen.due).toBe(screen.total - settled);
      // The printed bill prints those very numbers.
      const printed = new Map(
        billSums({ ...screen, settled: screen.settled, credited: screen.credited }, screen.taxes).map(
          ([l, a]) => [l, a],
        ),
      );
      expect(printed.get('Total')).toBe(screen.total);
      expect(printed.get('Before tax')).toBe(screen.taxable);
      expect(printed.get('Still due')).toBe(screen.due);
      for (const t of screen.taxes) expect(printed.get(`${t.name} ${t.percent}%`)).toBe(t.amount);
      // The books: the invoice's voucher balances, charges the party the total and each tax its amount.
      const voucher = screen.vouchers[0]!.lines;
      expect(sum(voucher.map((l) => l.debit))).toBe(sum(voucher.map((l) => l.credit)));
      expect(voucher.find((l) => l.head === 'receivable')).toMatchObject({
        debit: screen.total,
        partyId: b.sharma.id,
      });
      expect(sum(voucher.filter((l) => l.head.startsWith('tax_output')).map((l) => l.credit))).toBe(
        screen.tax,
      );
      // The report: what the party owes is what the screen says is due.
      const owed = await ok<{ rows: { party: { id: string }; due: number }[] }>(
        w.api.get('/api/money/outstanding?side=receivable'),
      );
      expect(owed.rows.find((r) => r.party.id === b.sharma.id)?.due ?? 0).toBe(screen.due);
      return screen;
    };
    const first = await check(0);
    expect(first.total % 100).toBe(0);
    // A part payment of an odd amount: every place moves by exactly that.
    await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: b.sharma.id,
      date: '2031-04-01',
      amount: 123_45,
      modeId: b.upi.id,
      reference: 'UTR9',
    });
    const after = await check(123_45);
    expect(after.status).toBe('PART_PAID');
    // And the rest: paid, nothing owed anywhere.
    await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: b.sharma.id,
      date: '2031-04-02',
      amount: after.due,
      modeId: b.cash.id,
    });
    const done = await check(first.total);
    expect(done).toMatchObject({ status: 'PAID', due: 0 });
  });
});
