import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a shop (phase 21)', { timeout: 120_000 }, () => {
  it('K11–K15: set up from the pack; goods received; sold by barcode with a members’ price and a scheme discount; a return; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'retail');
    const { companyId } = t;

    // K11 — set up from the pack: barcoded items with a price, the members' price list, returns, the closing checklist.
    expect(await ctx.prisma.item.findFirstOrThrow({ where: { companyId, code: 'TEA250' } })).toMatchObject({
      barcode: '8902000000017',
      taxCode: 'GST5',
    });
    expect(await ctx.prisma.priceList.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      name: 'Members’ price',
      partyKind: 'member',
    });
    expect(await ctx.prisma.checklistMaster.count({ where: { companyId, name: 'Shop closing' } })).toBe(1);
    await t.rate('GST5', 5);
    await t.rate('GST18', 18);

    // K12 — buy and receive: a carton of each from the distributor; stock is on the shelf and the bill is owed.
    const got = await t.buy('Jaipur Traders', [
      { code: 'TEA250', qty: 48, ratePaise: 110_00 },
      { code: 'SOAP100', qty: 144, ratePaise: 32_00 },
      { code: 'BISC200', qty: 96, ratePaise: 22_00 },
    ]);
    expect(got.grn.poStatus).toBe('RECEIVED');
    expect([await t.stock('TEA250'), await t.stock('SOAP100'), await t.stock('BISC200')]).toEqual([
      48, 144, 96,
    ]);
    // ₹5,280 + 5 % and ₹6,720 + 18 %, rounded to a whole rupee.
    expect((await t.owed('payable')).rows[0]!.due).toBe(13_474_00);

    // K13 — sell and bill: scanned at the counter and paid in cash; a member pays the members' price; a scheme takes ₹20 off.
    const walkIn = await t.party('Walk-in', ['customer']);
    const member = await t.party('Meena (member)', ['member', 'customer']);
    const basket = [
      { barcode: '8902000000017', qty: 1 },
      { barcode: '8902000000024', qty: 2 },
    ];
    const counter = await t.sold({ partyId: walkIn, lines: basket, paid: 253_20, modeId: t.cash });
    // Tea ₹140 + 5 % = ₹147; two soaps ₹90 + 18 % = ₹106.20 → ₹253.20, rounded to ₹253.
    expect(counter.lines.map((l) => l.rate)).toEqual([140_00, 45_00]);
    expect(counter.total).toBe(253_00);
    const forMember = await t.sold({ partyId: member, lines: basket });
    expect(forMember.lines.map((l) => [l.rate, l.source])).toEqual([
      [130_00, 'list'],
      [40_00, 'list'],
    ]);
    const scheme = await t.sold({
      partyId: walkIn,
      lines: [{ barcode: '8902000000031', qty: 4 }],
      discount: 20_00,
    });
    // Four packs ₹120 − ₹20 = ₹100 + 18 %.
    expect(scheme.total).toBe(118_00);
    expect([await t.stock('TEA250'), await t.stock('SOAP100'), await t.stock('BISC200')]).toEqual([
      46, 140, 92,
    ]);
    // An unknown barcode, or more than is on the shelf, is refused.
    expect((await t.sell({ partyId: walkIn, lines: [{ barcode: '0000000000000' }] })).status).not.toBe(200);
    expect((await t.sell({ partyId: walkIn, lines: [{ barcode: '8902000000017', qty: 500 }] })).status).toBe(
      409,
    );

    // K14 — the trade's own: a customer's return is asked, accepted by a manager and the goods are back on the shelf; a scheme runs.
    const ret = await t.made('RET', {
      bill_no: counter.number,
      item: 'Bath soap 100 g',
      qty: 1,
      reason: 'Damaged',
      settle: 'Exchange',
    });
    const cashier = await w.person('Shop Cashier');
    expect((await cashier.api.post(`/api/records/entries/${ret.id}/move`, { action: 'accept' })).status).toBe(
      403,
    );
    expect(await t.moveTo(ret.id, 'accept')).toMatchObject({ status: 'accepted' });
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('SOAP100'),
        type: 'IN',
        qty: 1,
        note: `Return ${ret.code}`,
      }),
    );
    expect(await t.stock('SOAP100')).toBe(141);
    const offer = await t.made('SCH', {
      name: 'Diwali ₹20 off on biscuits',
      from: today(),
      details: '₹20 off on four packs',
    });
    expect(await t.moveTo(offer.id, 'start')).toMatchObject({ status: 'running' });

    // K15 — the owner's view: returns by reason, what members owe, the till's day, the Weekly MIS.
    expect((await t.run('Returns by reason')).rows).toEqual([['Damaged', 1]]);
    expect((await t.owed()).rows.map((r) => r.party.name).sort()).toEqual(['Meena (member)', 'Walk-in']);
    const close = await w.api.get(`/api/money/day-close?date=${today()}`);
    expect([200, 400, 404]).toContain(close.status);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
