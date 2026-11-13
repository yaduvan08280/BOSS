import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a jeweller (phase 21)', { timeout: 120_000 }, () => {
  it('K6–K10: set up from the pack; pieces received by their own number; sold at the day’s rate with making charges; old gold and certificates; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'gold_gems');
    const { companyId } = t;

    // K6 — set up from the pack: pieces tracked one by one with a weight, priced by the gold rate; purity on every piece.
    expect(await ctx.prisma.item.findFirstOrThrow({ where: { companyId, code: 'RING22' } })).toMatchObject({
      tracking: 'SERIAL',
      secondUnit: 'g',
      pricedBy: 'second',
      rateKey: 'GOLD24',
    });
    expect(await ctx.prisma.itemAttribute.count({ where: { companyId, category: 'Jewellery' } })).toBe(1);
    await t.rate('GOLD3', 3);
    await t.rate('MAKING5', 5);

    // K7 — buy and receive: two rings from the workshop, each with its number, weight, purity and cost; the workshop's bill.
    const piece = (code: string, grams: number, cost: number) => ({
      code,
      qty2: grams,
      ratePaise: cost,
      attrs: { purity: '22K', huid: `H${code}` },
      barcode: `B${code}`,
    });
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('RING22'),
        type: 'IN',
        serials: [piece('R-001', 4.25, 27_000_00), piece('R-002', 6.1, 39_000_00)],
      }),
    );
    expect(await t.stock('RING22')).toBe(2);
    const workshop = await t.party('Shree Karigar', ['vendor']);
    const bill = await ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'PURCHASE_BILL',
        partyId: workshop,
        date: today(),
        branchId: null,
        lines: [
          { item: 'Gold rings 22K, 2 pcs, 10.35 g', hsn: '7113', qty: 1, rate: 66_000_00, taxCode: 'GOLD3' },
        ],
      }),
    );
    await ok(w.api.post(`/api/money/bills/${bill.id}/issue`));
    expect((await t.owed('payable')).rows).toMatchObject([
      { party: { name: 'Shree Karigar' }, due: 67_980_00 },
    ]);

    // K8 — sell and bill: no rate on the board, no sale; then the ring is scanned and sold at today's rate × its weight × 22K, with making charges.
    const buyer = await t.party('Sunita Jain', ['customer']);
    expect((await t.sell({ partyId: buyer, lines: [{ barcode: 'BR-001' }] })).status).toBe(409);
    await ok(w.api.put('/api/ims/rate-board', { key: 'gold24', rate: 7400_00, unit: 'g' }));
    const perGram = Math.round(7400_00 * 0.916);
    const sale = await t.sold({
      partyId: buyer,
      lines: [{ barcode: 'BR-001' }],
      charges: [{ name: 'Making charges', amount: 2500_00, taxCode: 'MAKING5' }],
    });
    expect(sale.lines[0]).toMatchObject({ qty: 4.25, rate: perGram, source: 'board', batch: 'R-001' });
    const gold = Math.round(perGram * 4.25);
    // Gold at 3 %, making at 5 %, rounded to a whole rupee.
    expect(Math.abs(sale.total - Math.round(gold * 1.03 + 2500_00 * 1.05))).toBeLessThanOrEqual(100);
    const invoice = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: sale.billId } });
    expect(JSON.stringify(invoice.lines)).toContain('R-001');
    expect(JSON.stringify(invoice.charges)).toContain('Making charges');
    expect(await t.stock('RING22')).toBe(1);
    // The same piece cannot be sold twice; tomorrow's rate changes the other ring's price.
    expect((await t.sell({ partyId: buyer, lines: [{ barcode: 'BR-001' }] })).status).not.toBe(200);
    const quote = () => ok<{ amount: number }>(w.api.post('/api/ims/quote', { barcode: 'BR-002' }));
    const before = (await quote()).amount;
    await ok(w.api.put('/api/ims/rate-board', { key: 'gold24', rate: 7500_00, unit: 'g', date: today(1) }));
    expect((await quote()).amount).toBe(before);
    expect(
      (await ok<{ amount: number }>(w.api.post('/api/ims/quote', { barcode: 'BR-002', date: today(1) })))
        .amount,
    ).toBeGreaterThan(before);

    // K9 — the trade's own: old gold is weighed and valued by MONO; a piece has one certificate.
    const old = await t.made('OG', { customer: 'Sunita Jain', weight_g: 8.5, purity: '22K', rate: 6500 });
    expect(Number(old.data.value)).toBe(55_250);
    expect((await t.record('OG', { customer: 'No weight', purity: '22K', rate: 6500 })).status).toBe(400);
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('OLDGOLD'),
        type: 'IN',
        qty: 8.5,
        ratePaise: 6500_00,
      }),
    );
    expect(await t.moveTo(old.id, 'pay')).toMatchObject({ status: 'paid' });
    await t.made('CERT', {
      piece: 'R-002',
      purity: '22K',
      weight_g: 6.1,
      huid: 'HR-002',
      lab: 'Jaipur Assay Centre',
    });
    expect((await t.record('CERT', { piece: 'R-002', purity: '22K' })).status).not.toBe(200);
    expect((await t.record('CERT', { piece: 'R-003', purity: '22K', huid: 'HR-002' })).status).not.toBe(200);

    // K10 — the owner's view: old gold by purity, the value in the vault, what the workshop is owed, the Weekly MIS.
    expect((await t.run('Old gold bought, by purity')).rows).toEqual([['22K', 8.5]]);
    expect((await w.api.get('/api/ims/valuation')).status).toBe(200);
    expect((await t.owed()).rows.find((r) => r.party.name === 'Sunita Jain')!.due).toBe(sale.total);
    await t.receipt(buyer, sale.total);
    expect((await t.owed()).rows).toEqual([]);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
