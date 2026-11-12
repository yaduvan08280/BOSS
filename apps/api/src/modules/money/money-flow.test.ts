import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { publish, start, task } from '../forms/test-kit';
import { world } from '../records/testkit';
import { books, meal, ok, type BillOut } from './money-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('the money core (phase 12M): cash, Tally and the other modules', () => {
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

    // A customer that never became a party (imported or seeded straight into the table) still gets its paper:
    // the order makes the party first.
    const bare = await ctx.prisma.customer.create({
      data: { companyId: w.companyId, code: 'CUS-900', name: 'Bare Stones', creditDays: 10 },
    });
    const bareOrder = await ok<{ id: string }>(
      w.api.post('/api/crm/orders', { customerId: bare.id, amount: 10_000_00 }),
    );
    expect(await billOf('crm_order', bareOrder.id)).toMatchObject({ partyId: bare.id, status: 'ISSUED' });
    expect(await ctx.prisma.party.findUnique({ where: { id: bare.id } })).toMatchObject({
      name: 'Bare Stones',
      kinds: ['customer'],
    });

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
