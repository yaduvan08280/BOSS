import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { at } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { add, bill, ok, open, order, pay, post, restaurant, type CheckOut } from './pos-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('POS: bills, discounts, splits, payments, stock, cancellation (phase 15)', () => {
  it('P15, P16, P19, P21, P24: a GST bill with a voluntary service charge, round-off, a B2B name, a UPI link and a DUPLICATE reprint', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.tikka, variantKey: 'full' },
      { menuItemId: r.m.dal },
      { menuItemId: r.m.naan, hold: true },
    ]);
    // A held item blocks the bill until it is fired or taken off.
    expect((await s.post(`/api/pos/orders/${o.id}/check`, {})).status).toBe(409);
    const held = (await order(s, o.id)).items.find((i) => i.status === 'HELD')!;
    await ok(s.post(`/api/pos/orders/${o.id}/items/${held.id}/void`, {}));
    // ₹600 of food: 10 % service charge ₹60, GST 5 % on the food ₹30 → ₹690.
    const c = await bill(s, o.id);
    expect(c).toMatchObject({
      pending: false,
      status: 'OPEN',
      total: 690_00,
      tax: 30_00,
      serviceCharge: 60_00,
      roundOff: 0,
      due: 690_00,
    });
    expect(c.upi).toBe(
      'upi://pay?pa=rooftop%40hdfc&pn=Rooftop&am=690.00&cu=INR&tn=Bill%20' + encodeURIComponent(c.number),
    );
    // It is a real invoice in the money core: per-item tax and HSN, issued, in the walk-in guest's name.
    const invoice = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, number: c.number },
    });
    expect(invoice).toMatchObject({
      type: 'INVOICE',
      status: 'ISSUED',
      sourceType: 'pos_check',
      partyId: `walkin_${w.companyId}`,
    });
    expect(
      (invoice.lines as { item: string; hsn: string; taxCode: string }[]).map((l) => [
        l.item,
        l.hsn,
        l.taxCode,
      ]),
    ).toEqual([
      ['Paneer tikka (Full)', '996331', 'GST5'],
      ['Dal makhani', '996331', 'GST5'],
    ]);
    expect((await order(s, o.id)).status).toBe('BILLED');
    expect((await s.post(`/api/pos/orders/${o.id}/check`, {})).status).toBe(409);
    // P21: printed again, it says DUPLICATE and is counted.
    expect(await post(s, `/api/pos/checks/${c.id}/reprint`)).toMatchObject({
      printed: 2,
      duplicate: true,
      queued: true,
    });
    const prints = await ctx.prisma.printJob.findMany({
      where: { companyId: w.companyId, kind: 'BILL' },
      orderBy: { createdAt: 'asc' },
    });
    const text = (i: number) => Buffer.from(prints[i]!.payload, 'base64').toString('latin1');
    expect([text(0).includes('DUPLICATE'), text(1).includes('DUPLICATE'), text(0).includes('TOTAL')]).toEqual(
      [false, true, true],
    );

    // P16: the guest refuses the service charge. P19: ₹180 + 5 % = ₹189 exactly; ₹100 off makes ₹84 — no paise left.
    const o2 = await open(s, r, 'T2');
    await add(s, o2.id, [{ menuItemId: r.m.tikka, variantKey: 'half' }]);
    expect(await bill(s, o2.id, { noServiceCharge: true })).toMatchObject({
      total: 189_00,
      serviceCharge: 0,
      tax: 9_00,
    });
    // P15: a company's bill carries its name and GSTIN (the invoice's party).
    const firm = await post(w.api, '/api/money/parties', {
      name: 'Sharma Exports',
      kinds: ['company'],
      taxId: '08AAACS1234E1Z1',
      state: 'Rajasthan',
    });
    const o3 = await open(s, r, 'T3', { partyId: firm.id });
    await add(s, o3.id, [{ menuItemId: r.m.cola, qty: 3 }]);
    const c3 = await bill(s, o3.id);
    // ₹240 + ₹24 service + ₹12 tax = ₹276.
    expect(c3.total).toBe(276_00);
    expect(
      (await ctx.prisma.bill.findFirstOrThrow({ where: { number: c3.number, companyId: w.companyId } }))
        .partyId,
    ).toBe(firm.id);
  });

  it('P17, P18: a discount within the limit, one that needs an approver, and a no-charge bill with a reason', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const table = async (name: string) => {
      const o = await open(s, r, name);
      await add(s, o.id, [{ menuItemId: r.m.tikka, variantKey: 'full' }, { menuItemId: r.m.dal }]);
      return o;
    };
    // 5 % is the steward's own to give: ₹30 off ₹600 → ₹570 + ₹57 + ₹28.50 = ₹655.50 → ₹656.
    const a = await table('T1');
    const within = await bill(s, a.id, { discount: { kind: 'PERCENT', value: 5, reason: 'Regular guest' } });
    expect(within).toMatchObject({
      pending: false,
      total: 656_00,
      roundOff: 50,
      discount: { amount: 30_00 },
    });
    // 15 % is above it: nothing is billed until the manager says yes.
    const b = await table('T2');
    const asked = await bill(s, b.id, { discount: { kind: 'PERCENT', value: 15, reason: 'Late food' } });
    expect(asked.pending).toBe(true);
    expect((await order(s, b.id)).status).toBe('OPEN');
    await ok(r.manager.api.post(`/api/pos/approvals/${asked.approvalId}/decide`, { approve: true }));
    const made = await ctx.prisma.posCheck.findFirstOrThrow({ where: { orderId: b.id } });
    // ₹90 off → ₹510 + ₹51 + ₹25.50 = ₹586.50 → ₹587 (rounded half up).
    expect([Number(made.total), made.discount]).toEqual([
      587_00,
      expect.objectContaining({ amount: 90_00, approvedById: r.manager.id }),
    ]);
    // The manager gives 20 % without asking anyone (it is within 25 %).
    const c = await table('T3');
    expect((await bill(r.manager.api, c.id, { discount: { kind: 'PERCENT', value: 20 } })).pending).toBe(
      false,
    );
    // P18: no-charge needs one of the company's reasons, and someone who may give it.
    const d = await table('T4');
    expect((await s.post(`/api/pos/orders/${d.id}/check`, { ncReason: 'I said so' })).status).toBe(400);
    expect((await bill(s, d.id, { ncReason: 'Owner’s guest' })).pending).toBe(true);
    const nc = await bill(r.manager.api, d.id, { ncReason: 'Owner’s guest' });
    expect(nc).toMatchObject({ pending: false, total: 0, status: 'PAID', serviceCharge: 0 });
    expect((await ctx.prisma.posCheck.findFirstOrThrow({ where: { orderId: d.id } })).ncReason).toBe(
      'Owner’s guest',
    );
  });

  it('P20: a bill split by item, by seat, in equal parts and by amounts', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const split = (id: string, body: object) => s.post(`/api/pos/orders/${id}/split`, body);
    // By item: the tikka on check 2, the rest on check 1 — two bills.
    const a = await open(s, r, 'T1');
    await add(s, a.id, [
      { menuItemId: r.m.tikka, variantKey: 'full', seat: 1 },
      { menuItemId: r.m.dal, seat: 2 },
      { menuItemId: r.m.cola, seat: 2 },
    ]);
    const items = (await order(s, a.id)).items;
    expect(await ok(split(a.id, { by: 'ITEM', items: [{ itemId: items[0]!.id, check: 2 }] }))).toEqual({
      checks: [1, 2],
    });
    const [c1, c2] = [await bill(s, a.id, { check: 1 }), await bill(s, a.id, { check: 2 })];
    // ₹360 → ₹414; ₹320 → ₹368.
    expect([c1.total, c2.total, c1.number === c2.number]).toEqual([414_00, 368_00, false]);
    // By seat: each seat its own check.
    const b = await open(s, r, 'T2');
    await add(s, b.id, [
      { menuItemId: r.m.naan, seat: 1 },
      { menuItemId: r.m.dal, seat: 2 },
      { menuItemId: r.m.cola, seat: 3 },
    ]);
    expect(await ok(split(b.id, { by: 'SEAT' }))).toEqual({ checks: [1, 2, 3] });
    // Equally: one bill of ₹690 paid by three — ₹230 each.
    const c = await open(s, r, 'T3');
    await add(s, c.id, [{ menuItemId: r.m.tikka, variantKey: 'full' }, { menuItemId: r.m.dal }]);
    await ok(split(c.id, { by: 'EQUAL', parts: 3 }));
    expect((await bill(s, c.id)).parts).toEqual([230_00, 230_00, 230_00]);
    // By amount: the amounts must add up to the bill.
    const d = await open(s, r, 'T4');
    await add(s, d.id, [{ menuItemId: r.m.tikka, variantKey: 'full' }, { menuItemId: r.m.dal }]);
    await ok(split(d.id, { by: 'AMOUNT', amounts: [500_00, 100_00] }));
    expect((await s.post(`/api/pos/orders/${d.id}/check`, {})).status).toBe(400);
    await ok(split(d.id, { by: 'AMOUNT', amounts: [500_00, 190_00] }));
    expect((await bill(s, d.id)).parts).toEqual([500_00, 190_00]);
  });

  it('P23, P25–P27, P29: several modes on one bill, references, a room charge, company credit, tips — and stock when the order is paid', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.tikka, variantKey: 'full', modifiers: [{ groupId: r.m.addOns, key: 'cheese' }] },
      { menuItemId: r.m.cola, qty: 2 },
    ]);
    const c = await bill(s, o.id);
    // ₹520 + ₹52 + ₹26 = ₹598.
    expect(c.total).toBe(598_00);
    // P23: UPI needs its reference; nobody can pay more than is due.
    expect(
      (await s.post(`/api/pos/checks/${c.id}/pay`, { payments: [{ modeId: r.modes.upi, amount: 100_00 }] }))
        .status,
    ).toBe(400);
    expect(
      (await s.post(`/api/pos/checks/${c.id}/pay`, { payments: [{ modeId: r.modes.cash, amount: 600_00 }] }))
        .status,
    ).toBe(400);
    const part = await pay(s, c.id, [{ modeId: r.modes.cash, amount: 300_00 }]);
    expect(part).toMatchObject({ status: 'OPEN', due: 298_00, orderStatus: 'BILLED' });
    // Nothing leaves stock until the order is paid.
    expect(await at(ctx.prisma, r.stock.paneer, r.kitchenLoc)).toBe(5000);
    // P27: the rest by UPI with a tip for the steward.
    const done = await pay(s, c.id, [{ modeId: r.modes.upi, amount: 298_00, reference: 'UTR123' }], {
      amount: 50_00,
    });
    expect(done).toMatchObject({ status: 'PAID', due: 0, orderStatus: 'PAID' });
    expect(done.payments.map((p) => [p.mode, p.amount, p.reference])).toEqual([
      ['Cash', 300_00, null],
      ['UPI', 298_00, 'UTR123'],
    ]);
    expect((await ctx.prisma.posCheck.findUniqueOrThrow({ where: { id: c.id } })).tips).toEqual([
      { amount: 50_00, stewardId: r.steward.id, modeId: null },
    ]);
    // The invoice is paid in the money core by two receipts.
    expect(
      await ctx.prisma.bill.findFirstOrThrow({ where: { number: c.number, companyId: w.companyId } }),
    ).toMatchObject({ status: 'PAID', settled: 598_00n });
    // P29: the recipe's paneer, the add-on's cheese and the cola cans left the outlet's kitchen.
    expect([
      await at(ctx.prisma, r.stock.paneer, r.kitchenLoc),
      await at(ctx.prisma, r.stock.cheese, r.kitchenLoc),
      await at(ctx.prisma, r.stock.cola, r.kitchenLoc),
    ]).toEqual([4800, 480, 46]);
    expect(
      (await s.post(`/api/pos/checks/${c.id}/pay`, { payments: [{ modeId: r.modes.cash, amount: 1 }] }))
        .status,
    ).toBe(409);

    // P25: room service is charged to the room it was ordered for.
    const rs = await post<{ id: string }>(s, '/api/pos/orders', {
      outletId: r.outlet,
      type: 'ROOM_SERVICE',
      roomNo: '204',
    });
    await add(s, rs.id, [{ menuItemId: r.m.dal }]);
    const rc = await bill(s, rs.id);
    const charged = await pay(s, rc.id, [{ modeId: r.modes.room, amount: rc.total }]);
    expect(charged.payments).toMatchObject([{ kind: 'ROOM', reference: '204' }]);
    // P26: company credit needs the company's name on the bill; the invoice then stays owed (receivables).
    const walk = await open(s, r, 'T2');
    await add(s, walk.id, [{ menuItemId: r.m.dal }]);
    const wc = await bill(s, walk.id);
    expect(
      (
        await s.post(`/api/pos/checks/${wc.id}/pay`, {
          payments: [{ modeId: r.modes.company, amount: wc.total }],
        })
      ).status,
    ).toBe(409);
    const firm = await post(w.api, '/api/money/parties', { name: 'Sharma Exports', kinds: ['company'] });
    const co = await open(s, r, 'T3', { partyId: firm.id });
    await add(s, co.id, [{ menuItemId: r.m.dal }]);
    const cc = await bill(s, co.id);
    expect(await pay(s, cc.id, [{ modeId: r.modes.company, amount: cc.total }])).toMatchObject({
      status: 'PAID',
      orderStatus: 'PAID',
      due: 0,
    });
    const owed = await ok<{ rows: { party: { id: string }; due: number }[] }>(
      w.api.get('/api/money/outstanding?side=receivable'),
    );
    expect(owed.rows.find((x) => x.party.id === firm.id)?.due).toBe(cc.total);
    // Stock that is short never blocks a payment: it is noted on the item.
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: r.stock.paneer,
        type: 'OUT',
        qty: 4800,
        locationId: r.kitchenLoc,
      }),
    );
    const late = await open(s, r, 'T4');
    // (the menu would show it 86 now; this line was taken before the stock ran out)
    await ctx.prisma.posOrderItem.create({
      data: {
        companyId: w.companyId,
        orderId: late.id,
        menuItemId: r.m.tikka,
        name: 'Paneer tikka',
        qty: 1,
        price: 320_00n,
        status: 'FIRED',
        firedAt: new Date(),
        stockItemId: (await ctx.prisma.menuItem.findUniqueOrThrow({ where: { id: r.m.tikka } })).itemId,
      },
    });
    const lc = await bill(s, late.id);
    await pay(s, lc.id, [{ modeId: r.modes.cash, amount: lc.total }]);
    expect((await order(s, late.id)).items[0]).toMatchObject({
      status: 'SERVED',
      stockNote: 'Short: Paneer',
    });
  });

  it('P22, P34, P37, P38: cancelling a bill with approval; a device’s reserved bill numbers; a counter sale; takeaway and delivery charges', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // P22: a paid part is refunded (its receipt voided), a credit note undoes the invoice, the table is open again.
    const o = await open(s, r, 'T1');
    await add(s, o.id, [{ menuItemId: r.m.dal }]);
    const c = await bill(s, o.id);
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: 100_00 }]);
    expect((await s.post(`/api/pos/checks/${c.id}/cancel`, { reason: 'x' })).status).toBe(400);
    const asked = await post<{ pending: boolean; approvalId: string }>(s, `/api/pos/checks/${c.id}/cancel`, {
      reason: 'Billed the wrong table',
    });
    expect(asked.pending).toBe(true);
    await ok(r.manager.api.post(`/api/pos/approvals/${asked.approvalId}/decide`, { approve: true }));
    const gone = await ctx.prisma.posCheck.findUniqueOrThrow({ where: { id: c.id } });
    expect(gone).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Billed the wrong table',
      cancelledById: r.manager.id,
    });
    const invoice = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: gone.billId } });
    expect([invoice.status, Number(invoice.settled), Number(invoice.credited)]).toEqual([
      'CANCELLED',
      0,
      Number(invoice.total),
    ]);
    expect(await ctx.prisma.bill.findUniqueOrThrow({ where: { id: gone.creditNoteId! } })).toMatchObject({
      type: 'CREDIT_NOTE',
      status: 'ISSUED',
    });
    expect((await order(s, o.id)).status).toBe('OPEN');
    // It can be billed again — a new number; the cancelled one is never reused.
    const again = await bill(s, o.id);
    expect(again.number).not.toBe(c.number);

    // P34: a device takes a block of bill numbers; a bill made on it later uses one, once.
    const device = await post<{ numbers: string[] }>(s, `/api/pos/outlets/${r.outlet}/device`, {
      name: 'Tablet 1',
      count: 3,
    });
    expect(device.numbers).toHaveLength(3);
    const o2 = await open(s, r, 'T2');
    await add(s, o2.id, [{ menuItemId: r.m.cola }]);
    const offline = await bill(s, o2.id, { number: device.numbers[1] });
    expect(offline.number).toBe(device.numbers[1]);
    const o3 = await open(s, r, 'T3');
    await add(s, o3.id, [{ menuItemId: r.m.cola }]);
    expect((await s.post(`/api/pos/orders/${o3.id}/check`, { number: device.numbers[1] })).status).toBe(409);
    // A bill made at the server meanwhile takes the number after the block.
    const online = await bill(s, o3.id);
    expect([device.numbers.includes(online.number), online.number > device.numbers[2]!]).toEqual([
      false,
      true,
    ]);

    // P37: a counter sale — no table, no service charge; billed and paid in one go, stock taken.
    const counter = await post<{ id: string }>(s, '/api/pos/orders', { outletId: r.outlet, type: 'COUNTER' });
    await add(s, counter.id, [{ menuItemId: r.m.cola, qty: 2 }]);
    const cb = await bill(s, counter.id);
    // ₹160 + 5 % = ₹168.
    expect([cb.total, cb.serviceCharge]).toEqual([168_00, 0]);
    expect((await pay(s, cb.id, [{ modeId: r.modes.cash, amount: cb.total }])).orderStatus).toBe('PAID');
    expect(await at(ctx.prisma, r.stock.cola, r.kitchenLoc)).toBe(46);
    // P38: takeaway adds packaging; delivery adds packaging and delivery; neither a service charge.
    const charges = async (type: string): Promise<CheckOut> => {
      const x = await post<{ id: string }>(s, '/api/pos/orders', { outletId: r.outlet, type });
      await add(s, x.id, [{ menuItemId: r.m.dal }]);
      return bill(s, x.id);
    };
    // ₹280 + ₹14 tax + ₹20 = ₹314; with ₹50 delivery ₹364.
    expect([(await charges('TAKEAWAY')).total, (await charges('DELIVERY')).total]).toEqual([314_00, 364_00]);
  });
});
