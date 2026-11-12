import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { at, entry, item, kitchens, ok, storeKeepers, today, total } from './stock-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Api = Awaited<ReturnType<typeof world>>['api'];
const act = (api: Api, id: string, action: string, body: object = {}) =>
  ok(api.post(`/api/ims/transfers/${id}/${action}`, body));
const guest = (w: Awaited<ReturnType<typeof world>>, name: string, kinds: string[]) =>
  ok<{ id: string }>(w.api.post('/api/money/parties', { name, kinds })).then((p) => p.id);

describe('inventory v2: the bar, valuation, price lists and the rate board (phase 13)', () => {
  it('I25, I26, I30: a case of whisky — received, indented to the bar, sold as 60 ml pegs, broken, counted: the right ml and variance', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await storeKeepers(ctx.prisma, w);
    const farah = await k.g.at('Farah Rooftop', k.g.b.rooftop.id, 'HOD');
    await ok(w.api.put('/api/ims/rules', { stock: { wasteApproveOverPaise: 2000_00 } }));
    const whisky = await item(
      w,
      { code: 'WH-RO', name: 'Royal Oak whisky', unit: 'ml', category: 'Liquor' },
      {
        brand: 'Royal Oak',
        purchaseUnit: 'case',
        units: [
          { unit: 'bottle', factor: 750 },
          { unit: 'case', factor: 9000 },
          { unit: 'peg', factor: 30, serve: true },
        ],
      },
    );
    const peg60 = await item(
      w,
      { code: 'PEG60', name: 'Royal Oak 60 ml', unit: 'peg', category: 'Liquor' },
      { made: 'DISH', sellPrice: 450_00 },
    );
    await ok(
      w.api.put('/api/ims/recipes', { itemId: peg60, lines: [{ itemId: whisky, qty: 2, unit: 'peg' }] }),
    );
    // A case received in the store …
    await ok(
      w.api.post('/api/ims/grn', {
        vendor: 'City Wines',
        locationId: k.store,
        lines: [{ itemId: whisky, qty: 1, unit: 'case', ratePaise: 12_000_00 }],
      }),
    );
    expect(await at(ctx.prisma, whisky, k.store)).toBe(9000);
    // … indented to the bar by the case …
    const indent = await ok<{ id: string }>(
      farah.api.post('/api/ims/transfers', {
        toLocationId: k.bar,
        fromLocationId: k.store,
        lines: [{ itemId: whisky, qty: 1, unit: 'case' }],
      }),
    );
    await act(w.api, indent.id, 'approve');
    await act(w.api, indent.id, 'dispatch');
    await act(farah.api, indent.id, 'receive');
    expect([await at(ctx.prisma, whisky, k.store), await at(ctx.prisma, whisky, k.bar)]).toEqual([0, 9000]);
    // … sold as five 60 ml pegs through the recipe …
    const walkIn = await guest(w, 'Bar guest', ['guest']);
    const sale = await ok<{ total: number }>(
      farah.api.post('/api/ims/sell', {
        partyId: walkIn,
        locationId: k.bar,
        lines: [{ itemId: peg60, qty: 5 }],
      }),
    );
    expect(sale.total).toBe(5 * 450_00);
    type Row = { qty: number; whole: { unit: string; whole: number; open: number } | null };
    const held = async () =>
      (await ok<{ rows: Row[] }>(farah.api.get(`/api/ims/stock?itemId=${whisky}`))).rows[0]!;
    // I25: 8 700 ml is eleven full bottles and one open with 450 ml.
    expect(await held()).toMatchObject({ qty: 8700, whole: { unit: 'bottle', whole: 11, open: 450 } });
    // I26: a bottle is dropped.
    await ok(
      farah.api.post('/api/ims/wastage', {
        itemId: whisky,
        locationId: k.bar,
        qty: 1,
        unit: 'bottle',
        reason: 'BREAKAGE',
      }),
    );
    expect((await held()).qty).toBe(7950);
    // … and counted at close: 50 ml are missing against 300 ml sold — a variance over the limit.
    const count = await ok<{ id: string }>(
      farah.api.post('/api/ims/closing', { locationId: k.bar, blind: true }),
    );
    await ok(farah.api.put(`/api/ims/closing/${count.id}`, { lines: [{ itemId: whisky, counted: 7900 }] }));
    const sent = await ok<{
      status: string;
      lines: { diff: number; theoretical: number; pct: number; flagged: boolean }[];
    }>(farah.api.post(`/api/ims/closing/${count.id}/submit`));
    expect(sent.lines[0]).toMatchObject({ diff: -50, theoretical: 300, pct: 16.7, flagged: true });
    await ok(w.api.post(`/api/ims/closing/${count.id}/approve`, {}));
    expect([await at(ctx.prisma, whisky, k.bar), await total(ctx.prisma, whisky)]).toEqual([7900, 7900]);
    // I26: the bar's register for the day, brand by brand, in ml, bottles and pegs.
    const reg = await ok<{ rows: Record<string, unknown>[] }>(
      farah.api.get(`/api/ims/register?locationId=${k.bar}&from=${today()}&to=${today()}`),
    );
    expect(reg.rows).toMatchObject([
      {
        brand: 'Royal Oak',
        opening: 0,
        received: 9000,
        sold: 300,
        wasted: 750,
        adjusted: -50,
        closing: 7900,
        pegsSold: 10,
        bottles: { unit: 'bottle', whole: 10, open: 400 },
      },
    ]);
    const variance = await ok<{ name: string; actual: number; theoretical: number; variance: number }[]>(
      w.api.get(`/api/ims/variance?locationId=${k.bar}`),
    );
    expect(variance[0]).toMatchObject({
      name: 'Royal Oak whisky',
      theoretical: 300,
      actual: 350,
      variance: -50,
    });
  });

  it('I27: stock value per location and branch — weighted average by default, or FIFO', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    const oil = await item(w, { code: 'OIL', name: 'Oil', unit: 'ltr' });
    await entry(w.api, { itemId: oil, type: 'IN', qty: 10, ratePaise: 100_00, locationId: k.store });
    await entry(w.api, { itemId: oil, type: 'IN', qty: 10, ratePaise: 120_00, locationId: k.store });
    await entry(w.api, { itemId: oil, type: 'OUT', qty: 8, locationId: k.store });
    await entry(w.api, { itemId: oil, type: 'IN', qty: 5, ratePaise: 130_00, locationId: k.bar });
    type Value = {
      method: string;
      total: number;
      locations: { location: string; value: number }[];
      branches: { branch: string; value: number }[];
    };
    const avg = await ok<Value>(w.api.get('/api/ims/valuation'));
    // 20 l worth ₹2 200 → ₹110 a litre; 12 l left.
    expect(avg).toMatchObject({ method: 'AVG', total: 12 * 110_00 + 5 * 130_00 });
    expect(avg.locations).toEqual(
      expect.arrayContaining([expect.objectContaining({ location: 'Central store', value: 12 * 110_00 })]),
    );
    expect(avg.branches.map((b) => [b.branch, b.value]).sort()).toEqual([
      ['Central Kitchen', 12 * 110_00],
      ['Rooftop Jaipur', 5 * 130_00],
    ]);
    await ok(w.api.put('/api/ims/rules', { stock: { valuation: 'FIFO' } }));
    // FIFO: the newest ten at ₹120 and two of the older at ₹100.
    const fifo = await ok<Value>(w.api.get('/api/ims/valuation'));
    expect(fifo).toMatchObject({ method: 'FIFO', total: 10 * 120_00 + 2 * 100_00 + 5 * 130_00 });
  });

  it('U27, U30: a dealer pays the wholesale list, a walk-in the counter price; a scanned lot is the one that leaves', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await ok(
      w.api.put('/api/ims/attributes', {
        category: 'Slabs',
        defs: [{ key: 'grade', label: 'Grade', type: 'text' }],
      }),
    );
    const slab = await item(
      w,
      { code: 'SLAB', name: 'Quartz slab', category: 'Slabs' },
      { tracking: 'LOT', sellPrice: 1000_00 },
    );
    const a1 = await entry(w.api, {
      itemId: slab,
      type: 'IN',
      qty: 10,
      locationId: k.store,
      batch: { code: 'L-A1', barcode: 'LOT-A1', attrs: { grade: 'A' } },
    });
    const b1 = await entry(w.api, {
      itemId: slab,
      type: 'IN',
      qty: 10,
      locationId: k.store,
      batch: { code: 'L-B1', barcode: 'LOT-B1', attrs: { grade: 'B' } },
    });
    const list = (body: object) =>
      ok<{ id: string }>(
        w.api.post('/api/ims/price-lists', {
          from: '2026-01-01',
          lines: [{ itemId: slab, price: 800_00 }],
          ...body,
        }),
      );
    await list({ name: 'Wholesale', partyKind: 'dealer' });
    await list({
      name: 'Wholesale at the central kitchen',
      partyKind: 'dealer',
      branchId: k.g.b.kitchen.id,
      lines: [{ itemId: slab, price: 760_00 }],
    });
    const dealer = await guest(w, 'Sharma Stones', ['dealer', 'customer']);
    const walkIn = await guest(w, 'Walk-in', ['customer']);
    type Quote = { price: number; source: string };
    const quote = (partyId: string, branchId?: string) =>
      ok<Quote>(w.api.post('/api/ims/quote', { itemId: slab, partyId, branchId }));
    expect(await quote(walkIn)).toMatchObject({ price: 1000_00, source: 'item' });
    expect(await quote(dealer)).toMatchObject({ price: 800_00, source: 'list' });
    expect(await quote(dealer, k.g.b.kitchen.id)).toMatchObject({ price: 760_00, source: 'list' });
    // A list that has not started yet is not used.
    await list({
      name: 'Next year',
      partyKind: 'dealer',
      from: '2030-01-01',
      lines: [{ itemId: slab, price: 1_00 }],
    });
    expect((await quote(dealer)).price).toBe(800_00);
    type Sale = { total: number; lines: { rate: number; source: string; batch: string | null }[] };
    // U30: the scanned lot is the one sold — at the dealer's price here.
    const sold = await ok<Sale>(
      w.api.post('/api/ims/sell', {
        partyId: dealer,
        locationId: k.store,
        lines: [{ barcode: 'LOT-B1', qty: 2 }],
      }),
    );
    expect([sold.total, sold.lines[0]]).toEqual([
      2 * 760_00,
      { itemId: slab, name: 'Quartz slab', qty: 2, rate: 760_00, source: 'list', batch: 'L-B1' },
    ]);
    const lot = async (id: string) =>
      Number(
        (await ctx.prisma.stockBalance.findFirstOrThrow({ where: { batchId: id, locationId: k.store } })).qty,
      );
    expect([await lot(a1.batchIds[0]!), await lot(b1.batchIds[0]!)]).toEqual([10, 8]);
    const counter = await ok<Sale>(
      w.api.post('/api/ims/sell', {
        partyId: walkIn,
        locationId: k.store,
        lines: [{ itemId: slab, qty: 1 }],
        paid: 500_00,
      }),
    );
    expect([counter.total, counter.lines[0]!.rate, counter.lines[0]!.source]).toEqual([
      1000_00,
      1000_00,
      'item',
    ]);
    // Money taken at the counter is a receipt against that invoice.
    expect(
      await ctx.prisma.bill.findFirstOrThrow({
        where: { companyId: w.companyId, type: 'INVOICE', partyId: walkIn },
      }),
    ).toMatchObject({ status: 'PART_PAID', settled: 500_00n });
    // An item with no price anywhere can't be sold until it has one (or one is typed at the counter).
    const chip = await item(w, { code: 'CHIP', name: 'Stone chips', unit: 'kg', openingQty: 50 });
    expect(
      (await w.api.post('/api/ims/sell', { partyId: walkIn, lines: [{ itemId: chip, qty: 1 }] })).status,
    ).toBe(409);
    expect(
      (
        await ok<Sale>(
          w.api.post('/api/ims/sell', { partyId: walkIn, lines: [{ itemId: chip, qty: 2, price: 30_00 }] }),
        )
      ).total,
    ).toBe(60_00);
  });

  it('U28, U29: a ring tracked by serial with weight and purity is received, moved between two branches and sold at the day’s rate', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await ok(
      w.api.put('/api/ims/attributes', {
        category: 'Jewellery',
        defs: [{ key: 'purity', label: 'Purity', type: 'choice', options: ['22K', '18K'] }],
      }),
    );
    const ring = await item(
      w,
      { code: 'RING', name: 'Gold ring', category: 'Jewellery' },
      { tracking: 'SERIAL', secondUnit: 'g', pricedBy: 'second', rateKey: 'GOLD24', rateFactor: 0.916 },
    );
    const walkIn = await guest(w, 'Walk-in', ['customer']);
    const piece = await entry(w.api, {
      itemId: ring,
      type: 'IN',
      locationId: k.store,
      serials: [
        { code: 'R-001', qty2: 4.25, ratePaise: 25_000_00, attrs: { purity: '22K' }, barcode: 'RB001' },
      ],
    });
    // U28: today's gold rate on the board; a day before any rate there is no price.
    await ok(w.api.put('/api/ims/rate-board', { key: 'gold24', rate: 7350_00, unit: 'g' }));
    expect((await w.api.post('/api/ims/quote', { itemId: ring, date: '2020-01-01' })).status).toBe(409);
    expect(
      await ok<{ price: number; amount: number; source: string }>(
        w.api.post('/api/ims/quote', { barcode: 'RB001' }),
      ),
    ).toMatchObject({
      source: 'board',
      price: Math.round(7350_00 * 0.916),
      amount: Math.round(Math.round(7350_00 * 0.916) * 4.25),
    });
    // A piece travels by its own number: dispatched, on the road, received at the outlet.
    expect(
      (
        await w.api.post('/api/ims/transfers', {
          kind: 'DIRECT',
          fromLocationId: k.store,
          toLocationId: k.pantry,
          lines: [{ itemId: ring, qty: 1 }],
        })
      ).status,
    ).toBe(200);
    const t = await ok<{ id: string }>(
      w.api.post('/api/ims/transfers', {
        kind: 'DIRECT',
        fromLocationId: k.store,
        toLocationId: k.pantry,
        lines: [{ itemId: ring, qty: 1, batchId: piece.batchIds[0] }],
      }),
    );
    await act(w.api, t.id, 'dispatch');
    expect([await at(ctx.prisma, ring, k.store), await at(ctx.prisma, ring, '~transit')]).toEqual([0, 1]);
    await act(w.api, t.id, 'receive');
    expect([await at(ctx.prisma, ring, k.pantry), await total(ctx.prisma, ring)]).toEqual([1, 1]);
    // U29: sold at the outlet by scanning it — the day's rate × its weight × its purity.
    const sale = await ok<{
      total: number;
      lines: { qty: number; rate: number; source: string; batch: string }[];
    }>(w.api.post('/api/ims/sell', { partyId: walkIn, locationId: k.pantry, lines: [{ barcode: 'RB001' }] }));
    expect(sale.lines[0]).toMatchObject({
      qty: 4.25,
      rate: Math.round(7350_00 * 0.916),
      source: 'board',
      batch: 'R-001',
    });
    expect(Math.abs(sale.total - Math.round(7350_00 * 0.916) * 4.25)).toBeLessThanOrEqual(50);
    expect(await total(ctx.prisma, ring)).toBe(0);
    // The piece's whole story is on its own number.
    const story = await ok<{ moves: { type: string; to: string | null }[]; at: unknown[] }>(
      w.api.get(`/api/ims/batches/${piece.batchIds[0]}`),
    );
    expect([story.moves.map((m) => m.type), story.at]).toEqual([['IN', 'TRANSFER', 'TRANSFER', 'OUT'], []]);
    // It can't be sold twice.
    expect(
      (
        await w.api.post('/api/ims/sell', {
          partyId: walkIn,
          locationId: k.pantry,
          lines: [{ barcode: 'RB001' }],
        })
      ).status,
    ).toBe(409);
  });
});
