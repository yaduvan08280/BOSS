import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { add, bill, ok, open, pay, post, restaurant } from '../hosp/pos-kit';
import { world } from '../records/testkit';
import { actor, outside } from './connect-kit';
import { cancelEinvoice, makeEinvoice, type Einvoice } from './einvoice';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Tag = { partyId: string; modeId: string };
type Payout = {
  id: string | null;
  summary: {
    matched: number;
    unknown: number;
    unpaid: number;
    again: number;
    net: number;
    deductions: number;
    diff: number;
  };
  matched: { ref: string; diff: number }[];
  unknown: { ref: string }[];
  unpaid: { ref: string }[];
};

describe('Integrations: aggregators and e-invoices (phase 19)', { timeout: 120_000 }, () => {
  it('X13, X14: a Zomato order is billed to Zomato; its payout file settles it — receipt for what was paid, credit note for what was kept', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const delivery = async (ref: string) => {
      const o = await open(s, r, 'T1', { type: 'DELIVERY', tableIds: [] });
      await add(s, o.id, [{ menuItemId: r.m.dal, qty: 1 }]);
      const tag = await post<Tag>(s, `/api/pos/orders/${o.id}/aggregator`, { aggregator: 'ZOMATO', ref });
      const c = await bill(s, o.id);
      // "Paid" on Zomato's account: the guest paid Zomato, so no money came in — the bill is owed by Zomato.
      const paid = await pay(s, c.id, [{ modeId: tag.modeId, amount: c.total }]);
      expect(paid).toMatchObject({ status: 'PAID', orderStatus: 'PAID' });
      return { o, c, tag };
    };
    const one = await delivery('ZOM-1');
    const two = await delivery('ZOM-2');
    const inv = () =>
      ctx.prisma.bill.findFirstOrThrow({ where: { companyId: w.companyId, number: one.c.number } });
    expect(await inv()).toMatchObject({ partyId: one.tag.partyId, settled: 0n, status: 'ISSUED' });
    expect(await ctx.prisma.party.findUniqueOrThrow({ where: { id: one.tag.partyId } })).toMatchObject({
      name: 'Zomato',
    });
    expect(await ctx.prisma.bill.count({ where: { companyId: w.companyId, type: 'RECEIPT' } })).toBe(0);
    // The same Zomato number twice, or tagging after the bill, is refused.
    const o3 = await open(s, r, 'T2');
    expect(
      (await s.post(`/api/pos/orders/${o3.id}/aggregator`, { aggregator: 'ZOMATO', ref: 'ZOM-1' })).status,
    ).toBe(409);
    expect(
      (await s.post(`/api/pos/orders/${one.o.id}/aggregator`, { aggregator: 'SWIGGY', ref: 'X' })).status,
    ).toBe(409);

    // Zomato's payout file: ZOM-1 paid less its commission; an order MONO never saw; ZOM-2 is not in it.
    const total = one.c.total;
    const kept = 80_00;
    const csv = [
      'Order ID,Order Total,Commission,Net Payout',
      `ZOM-1,${(total / 100).toFixed(2)},${(kept / 100).toFixed(2)},"${((total - kept) / 100).toFixed(2)}"`,
      'ZOM-999,100.00,20.00,80.00',
    ].join('\n');
    const send = (api: typeof s, body: object = {}) =>
      api.post('/api/connect/payouts', { aggregator: 'ZOMATO', csv, fileName: 'zomato-w1.csv', ...body });
    expect((await send(s)).status).toBe(403);
    const m = r.manager.api;
    const bad = await m.post('/api/connect/payouts', { aggregator: 'ZOMATO', csv: 'Foo,Bar\n1,2' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('No order-number column');
    // A look first: nothing is recorded.
    const look = await ok<Payout>(send(m, { dryRun: true }));
    expect(look).toMatchObject({
      id: null,
      summary: { matched: 1, unknown: 1, unpaid: 1, net: total - kept, deductions: kept, diff: 0 },
    });
    expect((await inv()).settled).toBe(0n);
    const done = await ok<Payout>(send(m));
    expect(done.id).toBeTruthy();
    expect(done.unknown.map((u) => u.ref)).toEqual(['ZOM-999']);
    expect(done.unpaid.map((u) => u.ref)).toEqual(['ZOM-2']);
    expect(await inv()).toMatchObject({
      settled: BigInt(total - kept),
      credited: BigInt(kept),
      status: 'PAID',
    });
    const receipt = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, type: 'RECEIPT' },
    });
    expect(receipt).toMatchObject({
      partyId: one.tag.partyId,
      total: BigInt(total - kept),
      reference: 'ZOM-1',
    });
    const note = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, type: 'CREDIT_NOTE' },
    });
    expect(note.total).toBe(BigInt(kept));
    expect(
      (await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: one.o.id } })).settlement,
    ).toMatchObject({
      net: total - kept,
      deductions: kept,
      diff: 0,
    });
    // The same file again settles nothing twice.
    expect(await ok<Payout>(send(m))).toMatchObject({ summary: { matched: 0, again: 1 } });
    expect(await ctx.prisma.bill.count({ where: { companyId: w.companyId, type: 'RECEIPT' } })).toBe(1);
    // Where Zomato stands: one order still waits for its payout.
    type Report = {
      sides: { aggregator: string; orders: number; waiting: { ref: string }[]; waitingAmount: number }[];
      imports: unknown[];
    };
    const report = await ok<Report>(m.get('/api/connect/aggregators'));
    expect(report.sides).toMatchObject([
      { aggregator: 'ZOMATO', orders: 2, waiting: [{ ref: 'ZOM-2' }], waitingAmount: two.c.total },
    ]);
    expect(report.imports).toHaveLength(2);
  });

  it('X15, X16: a B2B invoice gets its IRN and signed QR from the e-invoice provider, once; it can be cancelled for 24 hours', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    await ok(
      w.api.put('/api/money/tax-rates', {
        code: 'GST18',
        name: 'GST 18%',
        percent: 18,
        from: '2020-01-01',
      }),
    );
    const owner = await actor(ctx.prisma, w.companyId, w.owner.id);
    const steward = await actor(ctx.prisma, w.companyId, r.steward.id);
    const buyer = await post(w.api, '/api/money/parties', {
      name: 'Acme Foods Pvt Ltd',
      kinds: ['customer'],
      state: 'Maharashtra',
      taxId: '27ABCDE1234F1Z5',
      address: 'Plot 4, Andheri East, Mumbai, Maharashtra 400069',
    });
    const invoice = async (partyId: string, hsn: string | null = '996334') => {
      const d = await post(w.api, '/api/money/bills', {
        type: 'INVOICE',
        partyId,
        date: '2026-11-13',
        branchId: r.g.b.rooftop.id,
        lines: [{ item: 'Outdoor catering', hsn, qty: 2, unit: 'nos', rate: 5000_00, taxCode: 'GST18' }],
      });
      await ok(w.api.post(`/api/money/bills/${d.id}/issue`));
      return d.id;
    };
    const id = await invoice(buyer.id);
    const gsp = outside((c) =>
      c.url.endsWith('/einvoice')
        ? {
            json: {
              irn: 'a'.repeat(64),
              ackNo: 112010036563310,
              ackDt: '2026-11-13 12:30:00',
              signedQr: 'eyJhbGciOi.signed.qr',
            },
          }
        : { json: { ok: true } },
    );
    // Not connected, or not allowed: said plainly.
    await expect(makeEinvoice(ctx.prisma, gsp.net, owner, id)).rejects.toMatchObject({ status: 400 }); // no PIN yet
    await ctx.prisma.legalEntity.update({
      where: { id: r.g.entity.id },
      data: {
        details: {
          legalName: 'GGM Hotels Rajasthan Pvt Ltd',
          address: '12 MI Road, Jaipur, Rajasthan 302001',
        },
      },
    });
    await expect(makeEinvoice(ctx.prisma, gsp.net, owner, id)).rejects.toMatchObject({ status: 409 });
    await ok(
      w.api.put('/api/connect/connections', {
        kind: 'EINVOICE',
        provider: 'GSP',
        baseUrl: 'https://gsp.example.com/api',
        secret: { token: 'gsp-token' },
      }),
    );
    await expect(makeEinvoice(ctx.prisma, gsp.net, steward, id)).rejects.toMatchObject({ status: 403 });
    const e = (await makeEinvoice(ctx.prisma, gsp.net, owner, id)) as Einvoice;
    expect(e).toMatchObject({ irn: 'a'.repeat(64), ackNo: '112010036563310', qr: 'eyJhbGciOi.signed.qr' });
    const sent = gsp.calls[0]!;
    expect(sent.url).toBe('https://gsp.example.com/api/einvoice');
    expect(sent.headers.authorization).toBe('Bearer gsp-token');
    // The IRP's own JSON: another state, so IGST; rupees with two decimals.
    expect(sent.body).toMatchObject({
      Version: '1.1',
      TranDtls: { SupTyp: 'B2B' },
      DocDtls: { Typ: 'INV', Dt: '13/11/2026' },
      SellerDtls: {
        Gstin: '08AAAAA0000A1Z5',
        LglNm: 'GGM Hotels Rajasthan Pvt Ltd',
        Pin: 302001,
        Stcd: '08',
      },
      BuyerDtls: { Gstin: '27ABCDE1234F1Z5', Pin: 400069, Stcd: '27', Pos: '27' },
      ItemList: [
        {
          HsnCd: '996334',
          IsServc: 'Y',
          Qty: 2,
          UnitPrice: 5000,
          AssAmt: 10000,
          GstRt: 18,
          IgstAmt: 1800,
          CgstAmt: 0,
          TotItemVal: 11800,
        },
      ],
      ValDtls: { AssVal: 10000, IgstAmt: 1800, TotInvVal: 11800 },
    });
    // Asked again: the IRN it has, nothing sent twice.
    expect(await makeEinvoice(ctx.prisma, gsp.net, owner, id)).toMatchObject({ irn: e.irn });
    expect(gsp.calls).toHaveLength(1);
    expect((await ctx.prisma.bill.findUniqueOrThrow({ where: { id } })).einvoice).toMatchObject({
      irn: e.irn,
    });
    // What stops an e-invoice is named: a buyer with no GSTIN, a line with no HSN.
    const walkIn = await post(w.api, '/api/money/parties', {
      name: 'Ramesh',
      kinds: ['customer'],
      state: 'Rajasthan',
    });
    await expect(makeEinvoice(ctx.prisma, gsp.net, owner, await invoice(walkIn.id))).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('GSTIN'),
    });
    await expect(
      makeEinvoice(ctx.prisma, gsp.net, owner, await invoice(buyer.id, null)),
    ).rejects.toMatchObject({
      message: expect.stringContaining('HSN'),
    });

    // Cancelling: refused a day later; inside the day the provider is told and the bill keeps the record.
    const late = new Date(Date.now() + 25 * 3_600_000);
    await expect(
      cancelEinvoice(ctx.prisma, gsp.net, owner, id, { remark: 'Wrong buyer' }, late),
    ).rejects.toMatchObject({ status: 409 });
    const cancelled = await cancelEinvoice(ctx.prisma, gsp.net, owner, id, {
      reason: '2',
      remark: 'Wrong buyer',
    });
    expect(cancelled).toMatchObject({ irn: e.irn, reason: 'Wrong buyer' });
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(gsp.calls.at(-1)).toMatchObject({
      url: 'https://gsp.example.com/api/einvoice/cancel',
      body: { irn: e.irn, reason: '2' },
    });
    await expect(makeEinvoice(ctx.prisma, gsp.net, owner, id)).rejects.toMatchObject({ status: 409 });
  });
});
