import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { books, meal, ok, type BillOut } from './money-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('the money core (phase 12M)', () => {
  it('U11: one master of parties; a party can be several kinds; a CRM customer is a party with the same id', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    expect(b.sharma.code).toMatch(/^PTY-\d+$/);
    // A dealer who also supplies: two kinds on one party, found under either.
    await ok(
      w.api.put(`/api/money/parties/${b.sharma.id}`, {
        name: 'Sharma Traders',
        kinds: ['customer', 'vendor'],
      }),
    );
    const of = async (kind: string) =>
      (await ok<{ name: string }[]>(w.api.get(`/api/money/parties?kind=${kind}`))).map((p) => p.name).sort();
    expect(await of('vendor')).toEqual(['Jaipur Dairy', 'Sharma Traders']);
    expect(await of('customer')).toEqual(['Delhi Caterers', 'Sharma Traders']);
    // A customer made in the CRM is a party at once, with the same id and code.
    const c = await ok<{ id: string; code: string }>(
      w.api.post('/api/crm/customers', { name: 'Delta Homes', creditDays: 20 }),
    );
    const p = await ctx.prisma.party.findUniqueOrThrow({ where: { id: c.id } });
    expect(p).toMatchObject({ name: 'Delta Homes', kinds: ['customer'], creditDays: 20, code: c.code });
    // Someone without the right can read parties (forms need them) but not change them; unknown kinds are refused.
    const member = await w.person('Asha Member');
    expect((await member.api.get('/api/money/parties')).status).toBe(200);
    expect((await member.api.post('/api/money/parties', { name: 'Mine', kinds: ['customer'] })).status).toBe(
      403,
    );
    expect((await w.api.post('/api/money/parties', { name: 'Odd', kinds: ['alien'] })).status).toBe(400);
    // A party with papers can't be deleted; one without can.
    await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-01-10',
      lines: meal,
      issue: true,
    });
    expect((await w.api.del(`/api/money/parties/${b.sharma.id}`)).status).toBe(409);
    await ok(w.api.del(`/api/money/parties/${b.delhi.id}`));
  });

  it('U12: typed vendor names are matched to parties by a person — never by themselves', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    await ok(w.api.post('/api/ims/items', { code: 'MLK', name: 'Milk', unit: 'L', vendor: 'jaipur dairy' }));
    await ok(
      w.api.post('/api/ims/items', { code: 'OIL', name: 'Oil', unit: 'L', vendor: 'Ajmer Oil Mills' }),
    );
    type Row = {
      name: string;
      items: number;
      partyId: string | null;
      suggestion: { id: string; name: string } | null;
    };
    const typed = () => ok<Row[]>(w.api.get('/api/money/vendors'));
    // The same name exists as a party: suggested, not linked.
    expect(await typed()).toMatchObject([
      { name: 'Ajmer Oil Mills', items: 1, partyId: null, suggestion: null },
      { name: 'jaipur dairy', items: 1, partyId: null, suggestion: { id: b.dairy.id, name: 'Jaipur Dairy' } },
    ]);
    // A person accepts the suggestion; for the other name a new vendor is made from it.
    await ok(w.api.post('/api/money/vendors/match', { name: 'jaipur dairy', partyId: b.dairy.id }));
    const made = await ok<{ partyId: string }>(
      w.api.post('/api/money/vendors/match', { name: 'Ajmer Oil Mills' }),
    );
    const after = await typed();
    expect(after.map((r) => r.partyId)).toEqual([made.partyId, b.dairy.id]);
    expect(await ctx.prisma.party.findUniqueOrThrow({ where: { id: made.partyId } })).toMatchObject({
      name: 'Ajmer Oil Mills',
      kinds: ['vendor'],
    });
  });

  it('U13–U17: a tax invoice with two rates; a rate from a date; draft → issued → never edited; its own number series', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    // A draft has no number and can be changed.
    const draft = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-01-10',
      lines: meal,
    });
    expect(draft).toMatchObject({ status: 'DRAFT', number: null });
    await ok(
      w.api.put(`/api/money/bills/${draft.id}`, {
        type: 'INVOICE',
        partyId: b.sharma.id,
        date: '2031-01-10',
        lines: meal,
        charges: [{ name: 'Packing', amount: 20_00 }],
      }),
    );
    const inv = await ok<BillOut>(w.api.post(`/api/money/bills/${draft.id}/issue`, {}));
    // ₹640 at 5% + ₹180 at 18% + ₹20 packing: tax 32.00 + 32.40; same state → CGST + SGST at each rate.
    expect(inv).toMatchObject({
      status: 'ISSUED',
      taxable: 840_00,
      tax: 64_40,
      total: 904_00,
      roundOff: -40,
      due: 904_00,
    });
    expect(inv.number).toMatch(/^INV\/\d\d-\d\d\/0001$/);
    expect(inv.taxes.map((t) => `${t.name} ${t.percent}% ${t.amount}`).sort()).toEqual([
      'CGST 2.5% 1600',
      'CGST 9% 1620',
      'SGST 2.5% 1600',
      'SGST 9% 1620',
    ]);
    // Issued: no edits, no second issue, no discard.
    const edit = await w.api.put(`/api/money/bills/${inv.id}`, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-01-10',
      lines: meal,
    });
    expect(edit.status).toBe(409);
    expect((await w.api.post(`/api/money/bills/${inv.id}/issue`, {})).status).toBeGreaterThanOrEqual(400);
    expect(
      (await w.api.post(`/api/money/bills/${inv.id}/void`, { reason: 'changed my mind' })).status,
    ).toBeGreaterThanOrEqual(400);
    // U14: a buyer in another state is charged IGST.
    const out = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.delhi.id,
      date: '2031-01-11',
      lines: meal,
      issue: true,
    });
    expect(out.taxes.map((t) => t.name).sort()).toEqual(['IGST', 'IGST']);
    expect(out.number).toMatch(/\/0002$/);
    // U13: GST18 becomes 28% from 1 April 2031 — only for papers from that day.
    await b.rate('GST18', 28, '2031-04-01');
    const march = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-03-31',
      lines: [meal[1]],
      issue: true,
    });
    const april = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-04-01',
      lines: [meal[1]],
      issue: true,
    });
    expect([march.tax, april.tax]).toEqual([32_40, 50_40]);
    // A new financial year starts its own numbers.
    expect(april.number).toMatch(/^INV\/31-32\/0001$/);
    // U15: a room night's rate follows its price.
    await b.rate('ROOM', 12, '2020-01-01', {
      slabs: [
        { upTo: 7_500_00, percent: 12 },
        { upTo: null, percent: 18 },
      ],
    });
    const stay = (rate: number) =>
      b.bill(w.api, {
        type: 'INVOICE',
        partyId: b.sharma.id,
        date: '2031-01-12',
        lines: [{ item: 'Room night', qty: 1, rate, taxCode: 'ROOM' }],
      });
    expect((await stay(6_000_00)).tax).toBe(720_00);
    expect((await stay(9_000_00)).tax).toBe(1_620_00);
    // Only people with the right make and issue papers.
    const member = await w.person('Asha Member');
    expect(
      (
        await member.api.post('/api/money/bills', {
          type: 'INVOICE',
          partyId: b.sharma.id,
          date: '2031-01-10',
          lines: meal,
        })
      ).status,
    ).toBe(403);
    expect((await member.api.get('/api/money/bills')).status).toBe(403);
  });

  it('U18, U20: part payment, credit note, vendor bill and payment — statement, ageing and balanced vouchers', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const inv = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-01-10',
      lines: meal,
      issue: true,
    });
    expect(inv.total).toBe(884_00);
    // A part payment by UPI: the invoice is part paid.
    const rct = await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: b.sharma.id,
      date: '2031-01-12',
      amount: 400_00,
      modeId: b.upi.id,
      reference: 'UTR123',
    });
    expect(rct).toMatchObject({ status: 'ISSUED', settled: 400_00 });
    expect(rct.number).toMatch(/^RCT\//);
    const get = (id: string) =>
      ok<BillOut & { vouchers: { lines: { head: string; debit: number; credit: number }[] }[] }>(
        w.api.get(`/api/money/bills/${id}`),
      );
    expect(await get(inv.id)).toMatchObject({ status: 'PART_PAID', settled: 400_00, due: 484_00 });
    // One soft drink came back: a credit note for it lowers what is owed.
    const cn = await b.bill(w.api, {
      type: 'CREDIT_NOTE',
      partyId: b.sharma.id,
      date: '2031-01-13',
      againstId: inv.id,
      lines: [{ item: 'Soft drink', qty: 1, rate: 60_00, taxCode: 'GST18' }],
      issue: true,
    });
    expect(cn.total).toBe(71_00);
    expect(await get(inv.id)).toMatchObject({ status: 'PART_PAID', credited: 71_00, due: 413_00 });
    // A credit note can't be for more than the bill, nor for a bill of someone else.
    const tooMuch = await w.api.post('/api/money/bills', {
      type: 'CREDIT_NOTE',
      partyId: b.sharma.id,
      date: '2031-01-13',
      againstId: inv.id,
      lines: [{ item: 'All', qty: 1, rate: 900_00 }],
    });
    expect(tooMuch.status).toBe(400);
    // The rest is paid in cash: paid. More than is owed stays on the receipt as money on account.
    const rest = await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: b.sharma.id,
      date: '2031-01-20',
      amount: 500_00,
      modeId: b.cash.id,
    });
    expect(await get(inv.id)).toMatchObject({ status: 'PAID', due: 0 });
    expect(rest.settled).toBe(413_00);
    // The vendor's side: a purchase bill and a payment against it.
    const pb = await b.bill(w.api, {
      type: 'PURCHASE_BILL',
      partyId: b.dairy.id,
      date: '2031-01-05',
      dueOn: '2031-01-15',
      lines: [{ item: 'Milk', qty: 100, rate: 50_00, taxCode: 'GST5' }],
      issue: true,
    });
    expect(pb).toMatchObject({ total: 5_250_00 });
    await b.bill(w.api, {
      type: 'VENDOR_PAYMENT',
      partyId: b.dairy.id,
      date: '2031-01-06',
      amount: 2_000_00,
      modeId: b.cash.id,
    });
    expect(await get(pb.id)).toMatchObject({ status: 'PART_PAID', due: 3_250_00 });

    // The party's statement: every paper in order with a running balance.
    const st = await ok<{
      lines: { type: string; debit: number; credit: number; balance: number }[];
      closing: number;
    }>(w.api.get(`/api/money/parties/${b.sharma.id}/statement`));
    expect(st.lines.map((l) => [l.type, l.debit, l.credit, l.balance])).toEqual([
      ['INVOICE', 884_00, 0, 884_00],
      ['RECEIPT', 0, 400_00, 484_00],
      ['CREDIT_NOTE', 0, 71_00, 413_00],
      ['RECEIPT', 0, 500_00, -87_00],
    ]);
    // What we owe, with ageing: the dairy's bill was due on 15/01/2031 — long past.
    type Out = {
      rows: { party: { name: string }; due: number; overdue: number; ageing: Record<string, number> }[];
    };
    const payable = await ok<Out>(w.api.get('/api/money/outstanding?side=payable'));
    expect(payable.rows).toMatchObject([
      { party: { name: 'Jaipur Dairy' }, due: 3_250_00, ageing: { '0_30': 3_250_00 } },
    ]);
    // Nothing is owed to us any more.
    expect((await ok<Out>(w.api.get('/api/money/outstanding?side=receivable'))).rows).toEqual([]);

    // U20: every paper has a voucher whose two sides are equal.
    const vouchers = await ctx.prisma.voucher.findMany({ where: { companyId: w.companyId } });
    expect(vouchers).toHaveLength(6);
    for (const v of vouchers) {
      const lines = v.lines as { debit: number; credit: number }[];
      expect(lines.reduce((n, l) => n + l.debit, 0)).toBe(lines.reduce((n, l) => n + l.credit, 0));
    }
    // A receipt entered by mistake is voided: the invoice is owed again and the books are turned round, not erased.
    await ok(w.api.post(`/api/money/bills/${rest.id}/void`, { reason: 'Entered twice' }));
    expect(await get(inv.id)).toMatchObject({ status: 'PART_PAID', due: 413_00 });
    expect(await ctx.prisma.voucher.count({ where: { billId: rest.id } })).toBe(2);
  });
});
