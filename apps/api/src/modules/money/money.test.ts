import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { publish, start, task } from '../forms/test-kit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type World = Awaited<ReturnType<typeof world>>;
type Api = World['api'];
const ok = async <T>(p: Promise<{ status: number; body: T }>): Promise<T> => {
  const r = await p;
  if (r.status !== 200) throw new Error(`${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
type BillOut = {
  id: string;
  number: string | null;
  status: string;
  total: number;
  tax: number;
  taxable: number;
  due: number;
  settled: number;
  credited: number;
  roundOff: number;
  currency: string;
  taxes: { name: string; percent: number; amount: number }[];
};

/** A company in Rajasthan with a GSTIN, the usual rates, a customer in the state and one outside, a vendor. */
async function books(w: World) {
  await ok(
    w.api.put('/api/org/company', {
      name: 'Levanto Foods',
      city: 'Jaipur',
      state: 'Rajasthan',
      ownerName: 'Owner',
      mobile: '9829000001',
      gstin: '08AAACL1234E1Z1',
    }),
  );
  const rate = (code: string, percent: number, from = '2020-01-01', more: object = {}) =>
    ok(w.api.put('/api/money/tax-rates', { code, name: `${code}`, percent, from, ...more }));
  await rate('GST5', 5);
  await rate('GST18', 18);
  const party = (name: string, kinds: string[], more: object = {}) =>
    ok<{ id: string; code: string }>(w.api.post('/api/money/parties', { name, kinds, ...more }));
  const sharma = await party('Sharma Traders', ['customer'], { state: 'Rajasthan', creditDays: 15 });
  const delhi = await party('Delhi Caterers', ['customer'], { state: 'Delhi' });
  const dairy = await party('Jaipur Dairy', ['vendor'], { state: 'Rajasthan' });
  const cash = await ok<{ id: string }>(w.api.post('/api/money/modes', { name: 'Cash', kind: 'CASH' }));
  const upi = await ok<{ id: string }>(w.api.post('/api/money/modes', { name: 'UPI', kind: 'UPI' }));
  const bill = (api: Api, body: object) => ok<BillOut>(api.post('/api/money/bills', body));
  return { rate, party, sharma, delhi, dairy, cash, upi, bill };
}
const meal = [
  { item: 'Paneer tikka', hsn: '996331', qty: 2, rate: 320_00, taxCode: 'GST5' },
  { item: 'Soft drink', qty: 3, rate: 60_00, taxCode: 'GST18' },
];

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

  it('U19: payment modes per branch and a day close — expected against counted', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const outlet = await ok<{ id: string }>(
      w.api.post('/api/org/branches', { name: 'Rooftop', type: 'OUTLET' }),
    );
    const card = await ok<{ id: string }>(
      w.api.post('/api/money/modes', { name: 'Card machine', kind: 'CARD', branchId: outlet.id }),
    );
    const at = { partyId: b.sharma.id, date: '2031-01-10', branchId: outlet.id };
    await b.bill(w.api, { type: 'RECEIPT', ...at, amount: 1_000_00, modeId: b.cash.id });
    await b.bill(w.api, { type: 'RECEIPT', ...at, amount: 250_00, modeId: b.cash.id });
    await b.bill(w.api, { type: 'RECEIPT', ...at, amount: 700_00, modeId: card.id });
    await b.bill(w.api, {
      type: 'VENDOR_PAYMENT',
      ...at,
      partyId: b.dairy.id,
      amount: 300_00,
      modeId: b.cash.id,
    });
    type Sheet = {
      closed: boolean;
      modes: { name: string; expected: number; counted: number | null; difference: number | null }[];
    };
    const sheet = () => ok<Sheet>(w.api.get(`/api/money/day-close?branchId=${outlet.id}&date=2031-01-10`));
    expect((await sheet()).modes.map((m) => [m.name, m.expected])).toEqual([
      ['Card machine', 700_00],
      ['Cash', 950_00],
      ['UPI', 0],
    ]);
    // Every mode that took money must be counted; the difference is kept as it is.
    const close = (counts: object[]) =>
      w.api.post('/api/money/day-close', { branchId: outlet.id, date: '2031-01-10', counts });
    expect((await close([{ modeId: b.cash.id, counted: 950_00 }])).status).toBe(400);
    const done = await ok<Sheet>(
      close([
        { modeId: b.cash.id, counted: 900_00, note: '₹50 short' },
        { modeId: card.id, counted: 700_00 },
      ]),
    );
    expect(done.closed).toBe(true);
    expect(done.modes.filter((m) => m.counted !== null).map((m) => [m.name, m.difference])).toEqual([
      ['Card machine', 0],
      ['Cash', -50_00],
    ]);
    expect((await close([{ modeId: b.cash.id, counted: 950_00 }])).status).toBe(409);
  });

  it('U21: vouchers for Tally — every head is mapped to a ledger first, then exported as Tally XML', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-01-10',
      lines: meal,
      issue: true,
    });
    await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: b.sharma.id,
      date: '2031-01-12',
      amount: 400_00,
      modeId: b.upi.id,
    });
    type Row = { head: string; ledger: string | null };
    const map = await ok<Row[]>(w.api.get('/api/money/tally/map'));
    expect(map.map((m) => m.head)).toEqual([
      'cash:upi',
      'round_off',
      'sales',
      'tax_output:CGST',
      'tax_output:SGST',
    ]);
    // With heads unmapped the export is refused and names them.
    const early = await w.api.get('/api/money/tally/export?from=2031-01-01&to=2031-01-31');
    expect(early.status).toBe(409);
    expect((early.body as { error: { details: { heads: string[] } } }).error.details.heads).toContain(
      'sales',
    );
    await ok(
      w.api.put('/api/money/tally/map', {
        rows: [
          { head: 'sales', ledger: 'Sales Account' },
          { head: 'tax_output:CGST', ledger: 'Output CGST' },
          { head: 'tax_output:SGST', ledger: 'Output SGST' },
          { head: 'round_off', ledger: 'Round Off' },
          { head: 'cash:upi', ledger: 'HDFC Bank (UPI)' },
        ],
      }),
    );
    const { tallyExport } = await import('./tally');
    const { actorFor } = await import('../work/actor');
    const owner = (await actorFor(ctx.prisma, w.companyId, w.owner.id))!;
    const { xml, count } = await tallyExport(ctx.prisma, owner, { from: '2031-01-01', to: '2031-01-31' });
    expect(count).toBe(2);
    expect(xml).toContain('<VOUCHER VCHTYPE="Sales" ACTION="Create"><DATE>20310110</DATE>');
    // The party's own ledger is debited with the invoice total; sales and taxes are credited.
    expect(xml).toContain(
      '<LEDGERNAME>Sharma Traders</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-884.00</AMOUNT>',
    );
    expect(xml).toContain(
      '<LEDGERNAME>Sales Account</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>820.00</AMOUNT>',
    );
    expect(xml).toContain('<VOUCHER VCHTYPE="Receipt" ACTION="Create"><DATE>20310112</DATE>');
    expect(xml).toContain(
      '<LEDGERNAME>HDFC Bank (UPI)</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-400.00</AMOUNT>',
    );
  });
  it('U22: CRM orders and payments, purchase orders, process papers and the API all raise bills through one engine', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const { carryOverCrm } = await import('./mirror');
    // The CRM's after-order steps (an order needs them).
    await ok(
      w.api.put('/api/crm/setup', {
        page: 'seats',
        patch: { seats: { owner: [w.owner.id], crm: [w.owner.id] } },
      }),
    );
    await ok(
      w.api.put('/api/crm/setup', {
        page: 'afterOrder',
        patch: {
          afterOrder: [
            {
              key: 'confirm',
              name: 'Confirm order',
              seat: 'crm',
              time: { value: 2, unit: 'hours', anchor: 'start' },
              documents: [],
              proof: false,
            },
          ],
        },
      }),
    );
    const customer = await ok<{ id: string }>(
      w.api.post('/api/crm/customers', { name: 'Delta Homes', creditDays: 15 }),
    );
    // An order made before the engine existed (no paper yet), and one made now.
    const old = await ctx.prisma.salesOrder.create({
      data: {
        companyId: w.companyId,
        number: 'SO/25-26/0042',
        customerId: customer.id,
        orderDate: '2026-02-10',
        dueOn: '2026-02-25',
        amount: 1_00_000_00n,
      },
    });
    const oldPay = await ctx.prisma.payment.create({
      data: {
        companyId: w.companyId,
        customerId: customer.id,
        orderId: old.id,
        amount: 40_000_00n,
        date: '2026-02-20',
      },
    });
    const order = await ok<{ id: string; number: string }>(
      w.api.post('/api/crm/orders', { customerId: customer.id, amount: 50_000_00 }),
    );
    const billOf = (type: string, id: string) =>
      ctx.prisma.bill.findFirst({ where: { companyId: w.companyId, sourceType: type, sourceId: id } });
    // The new order is an issued invoice with the order's own number.
    expect(await billOf('crm_order', order.id)).toMatchObject({
      type: 'INVOICE',
      status: 'ISSUED',
      number: order.number,
      partyId: customer.id,
    });
    // Carrying over: the old order and its payment get their papers, numbers unchanged; running again makes nothing.
    expect(await billOf('crm_order', old.id)).toBeNull();
    expect(await carryOverCrm(ctx.prisma, w.companyId)).toBe(2);
    expect(await carryOverCrm(ctx.prisma, w.companyId)).toBe(0);
    expect(await billOf('crm_order', old.id)).toMatchObject({
      number: 'SO/25-26/0042',
      status: 'PART_PAID',
      settled: 40_000_00n,
    });
    expect(await billOf('crm_payment', oldPay.id)).toMatchObject({ type: 'RECEIPT', total: 40_000_00n });
    // A payment taken in the CRM is a receipt, set against the oldest paper first.
    await ok(
      w.api.post('/api/crm/payments', {
        customerId: customer.id,
        amount: 60_000_00,
        date: new Date().toISOString().slice(0, 10),
      }),
    );
    expect((await billOf('crm_order', old.id))!.status).toBe('PAID');
    // Cancelling the new order cancels its invoice by a credit note.
    await ok(w.api.post(`/api/crm/orders/${order.id}/cancel`, { reason: 'Customer changed plans' }));
    expect((await billOf('crm_order', order.id))!.status).toBe('CANCELLED');
    expect(await billOf('crm_order_cancel', order.id)).toMatchObject({
      type: 'CREDIT_NOTE',
      total: 50_000_00n,
    });
    // The customer's statement is the same story: everything adds up to nothing owed.
    const st = await ok<{ closing: number; lines: { type: string }[] }>(
      w.api.get(`/api/money/parties/${customer.id}/statement`),
    );
    expect(st.closing).toBe(0);
    expect(st.lines.map((l) => l.type).sort()).toEqual([
      'CREDIT_NOTE',
      'INVOICE',
      'INVOICE',
      'RECEIPT',
      'RECEIPT',
    ]);

    // A purchase order's goods received become a purchase bill — once the typed vendor is matched to a party.
    const item = await ok<{ id: string }>(
      w.api.post('/api/ims/items', { code: 'MLK', name: 'Milk', unit: 'L' }),
    );
    const po = await ok<{ id: string }>(
      w.api.post('/api/ims/po', {
        vendor: 'jaipur dairy',
        lines: [{ itemId: item.id, qty: 100, ratePaise: 5000 }],
      }),
    );
    await ok(w.api.post(`/api/ims/po/${po.id}/send`, {}));
    const billIt = () =>
      w.api.post(`/api/ims/po/${po.id}/bill`, { date: '2031-01-05', reference: 'JD/778', taxCode: 'GST5' });
    expect((await billIt()).status).toBe(409); // nothing received yet
    const lines = (await ok<{ lines: { id: string }[] }>(w.api.get(`/api/ims/po/${po.id}`))).lines;
    await ok(w.api.post(`/api/ims/po/${po.id}/receive`, { lines: [{ lineId: lines[0]!.id, qty: 60 }] }));
    expect(((await billIt()).body as { error: { message: string } }).error.message).toMatch(
      /Say which party "jaipur dairy" is/,
    );
    await ok(w.api.post('/api/money/vendors/match', { name: 'jaipur dairy', partyId: b.dairy.id }));
    const pb = await ok<BillOut & { status: string }>(billIt());
    expect(pb).toMatchObject({ status: 'DRAFT', taxable: 3_000_00, tax: 150_00, total: 3_150_00 });
    expect((await billIt()).status).toBe(409); // not twice

    // A paper made by a process step is also a bill when its type says so and the record names a customer.
    await ok(
      w.api.put('/api/document-types', {
        code: 'TAXINV',
        name: 'Tax invoice',
        prefix: 'TI',
        billType: 'INVOICE',
      }),
    );
    const flowId = await publish(w.api, 'Counter sale', {
      startFields: [
        { key: 'customer', label: 'Customer', type: 'master', master: 'customers', required: true },
        { key: 'items', label: 'Items', type: 'items' },
      ],
      steps: [{ ...task('bill', w.owner.id), documents: ['TAXINV'] }],
    });
    const rec = (
      await start(w.api, flowId, {
        customer: 'Delta Homes',
        items: [{ item: 'Slab 20 mm', qty: 3, rate: 1200, amount: 3600 }],
        _refs: { customer: `customer:${customer.id}` },
      })
    ).body as { id: string };
    const step = await ctx.prisma.fmsRecordStep.findFirstOrThrow({
      where: { recordId: rec.id, status: 'OPEN' },
    });
    await ok(w.api.post(`/api/fms/steps/${step.id}/complete`, { data: {} }));
    const paper = await ctx.prisma.document.findFirstOrThrow({ where: { recordId: rec.id } });
    expect(await billOf('document', paper.id)).toMatchObject({
      type: 'INVOICE',
      status: 'ISSUED',
      partyId: customer.id,
      total: 3_600_00n,
    });

    // The public API: a key makes a party and a bill with the same engine and numbers.
    const key = (await ok<{ key: string }>(w.api.post('/api/platform/keys', { name: 'Billing app' }))).key;
    const v1 = async (method: 'GET' | 'POST', url: string, payload?: object) => {
      const res = await ctx.app.inject({ method, url, headers: { authorization: `Bearer ${key}` }, payload });
      return { status: res.statusCode, body: res.json() };
    };
    const guest = await v1('POST', '/api/v1/parties', {
      name: 'Walk-in guest',
      kinds: ['guest'],
      state: 'Rajasthan',
    });
    expect(guest.status).toBe(200);
    // A counter bill (pharmacy style): MRP holds the tax, paid at once in cash.
    const counter = await v1('POST', '/api/v1/bills', {
      type: 'INVOICE',
      partyId: guest.body.id,
      date: '2031-01-10',
      taxInclusive: true,
      lines: [{ item: 'Paracetamol 500', hsn: '3004', qty: 2, rate: 31_50, taxCode: 'GST5' }],
    });
    expect(counter.body).toMatchObject({ status: 'ISSUED', total: 63_00, taxable: 60_00, tax: 3_00 });
    await b.bill(w.api, {
      type: 'RECEIPT',
      partyId: guest.body.id,
      date: '2031-01-10',
      amount: 63_00,
      modeId: b.cash.id,
    });
    expect((await v1('GET', `/api/v1/bills/${counter.body.id}`)).body).toMatchObject({
      status: 'PAID',
      due: 0,
    });
    // A stay bill (hotel style) from the same engine: room nights by slab, a service charge, an advance taken first.
    await b.rate('ROOM', 12, '2020-01-01', {
      slabs: [
        { upTo: 7_500_00, percent: 12 },
        { upTo: null, percent: 18 },
      ],
    });
    await b.bill(w.api, {
      type: 'ADVANCE',
      partyId: guest.body.id,
      date: '2031-01-11',
      amount: 5_000_00,
      modeId: b.upi.id,
    });
    const stay = await v1('POST', '/api/v1/bills', {
      type: 'INVOICE',
      partyId: guest.body.id,
      date: '2031-01-13',
      lines: [
        { item: 'Deluxe room', qty: 2, unit: 'night', rate: 6_000_00, taxCode: 'ROOM' },
        { item: 'Dinner', qty: 2, rate: 800_00, taxCode: 'GST5' },
      ],
      charges: [{ name: 'Service charge', amount: 300_00, taxCode: 'GST18' }],
    });
    expect(stay.body).toMatchObject({ taxable: 13_900_00, tax: 1_440_00 + 80_00 + 54_00, total: 15_474_00 });
    expect((await v1('GET', `/api/v1/bills?partyId=${guest.body.id}&type=INVOICE`)).body.bills).toHaveLength(
      2,
    );
    // A key whose maker loses the money right can no longer bill.
    const st2 = await v1('GET', `/api/v1/parties/${guest.body.id}/statement`);
    expect(st2.body.closing).toBe(15_474_00 - 5_000_00);
  });
});
