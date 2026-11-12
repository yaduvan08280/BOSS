import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { expiryAlert } from './jobs';
import { at, entry, item, kitchens, ok, storeKeepers, today, total } from './stock-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Row = {
  itemId: string;
  location: string;
  locationId: string;
  qty: number;
  qty2: number;
  whole: { unit: string; whole: number; open: number } | null;
  batches: {
    batchId: string;
    code: string;
    qty: number;
    expired: boolean;
    daysLeft: number | null;
    expiry: string | null;
  }[];
};
const stock = (api: Awaited<ReturnType<typeof world>>['api'], q = '') =>
  ok<{ rows: Row[] }>(api.get(`/api/ims/stock${q}`)).then((r) => r.rows);

describe('inventory v2: stock per location, units, batches, pieces (phase 13)', () => {
  it('I1–I3, I29: stock is kept per location in one stock unit; transfers move it; people see their own places', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    // Opening stock lands in the main store; the item's stock is the total of its locations.
    const rice = await item(
      w,
      { code: 'RICE', name: 'Basmati rice', unit: 'g', ratePaise: 5, openingQty: 1000 },
      { units: [{ unit: 'sack', factor: 25000 }], purchaseUnit: 'sack' },
    );
    expect(await stock(w.api, `?itemId=${rice}`)).toMatchObject([{ location: 'Main store', qty: 1000 }]);
    // Stock from before locations (written straight into the item) is the main store's the first time it moves.
    const old = await item(w, { code: 'OLD', name: 'Old stock item' });
    await ctx.prisma.item.update({ where: { id: old }, data: { stock: 40 } });
    await ok(w.api.post('/api/ims/moves', { itemId: old, type: 'OUT', qty: 10 }));
    expect([await at(ctx.prisma, old, ''), await total(ctx.prisma, old)]).toEqual([30, 30]);

    // Two sacks received at the central store: kept in grams, the move remembers "2 sack".
    const got = await entry(w.api, {
      itemId: rice,
      type: 'IN',
      qty: 2,
      unit: 'sack',
      ratePaise: 150_000,
      locationId: k.store,
    });
    const move = await ctx.prisma.stockMove.findUniqueOrThrow({ where: { id: got.moveIds[0]! } });
    expect(move).toMatchObject({ unit: 'sack', locationId: k.store });
    expect([Number(move.qty), Number(move.unitQty), Number(move.rate)]).toEqual([50000, 2, 6]);
    expect(await at(ctx.prisma, rice, k.store)).toBe(50000);
    expect(
      (
        await w.api.post('/api/ims/stock/entry', {
          itemId: rice,
          type: 'IN',
          qty: 1,
          unit: 'crate',
          locationId: k.store,
        })
      ).status,
    ).toBe(400);

    // A transfer inside the branch really moves the quantity; the total does not change.
    await entry(w.api, {
      itemId: rice,
      type: 'TRANSFER',
      qty: 10000,
      locationId: k.store,
      toLocationId: k.hot,
    });
    expect([
      await at(ctx.prisma, rice, k.store),
      await at(ctx.prisma, rice, k.hot),
      await total(ctx.prisma, rice),
    ]).toEqual([40000, 10000, 51000]);
    const over = await w.api.post('/api/ims/stock/entry', {
      itemId: rice,
      type: 'TRANSFER',
      qty: 99999,
      locationId: k.hot,
      toLocationId: k.store,
    });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toContain('Only 10000 g');
    // An issue can't take more than the location holds, even when the company has more elsewhere.
    expect(
      (await w.api.post('/api/ims/stock/entry', { itemId: rice, type: 'OUT', qty: 10001, locationId: k.hot }))
        .status,
    ).toBe(409);
    // Between branches goods travel: one entry is refused.
    const far = await w.api.post('/api/ims/stock/entry', {
      itemId: rice,
      type: 'TRANSFER',
      qty: 100,
      locationId: k.store,
      toLocationId: k.bar,
    });
    expect(far.status).toBe(409);
    expect(far.body.error.message).toContain('raise a transfer');

    // I29: an outlet's store keeper sees and touches only their own branch's locations.
    await storeKeepers(ctx.prisma, w);
    const farah = await k.g.at('Farah Rooftop', k.g.b.rooftop.id, 'HOD');
    await entry(w.api, { itemId: rice, type: 'IN', qty: 500, locationId: k.bar });
    expect((await stock(farah.api)).map((r) => r.location)).toEqual(['Rooftop bar']);
    expect((await farah.api.get(`/api/ims/stock?locationId=${k.store}`)).status).toBe(403);
    expect(
      (
        await farah.api.post('/api/ims/stock/entry', {
          itemId: rice,
          type: 'OUT',
          qty: 1,
          locationId: k.store,
        })
      ).status,
    ).toBe(403);
    await entry(farah.api, { itemId: rice, type: 'OUT', qty: 100, locationId: k.bar });
    expect(await at(ctx.prisma, rice, k.bar)).toBe(400);
  });

  it('I4–I6: batches with expiry, first expired first out, an expired batch is blocked, expiry list', async () => {
    const w = await world(ctx.app);
    const milk = await item(
      w,
      { code: 'MILK', name: 'Milk', unit: 'ltr', ratePaise: 6000 },
      { tracking: 'BATCH' },
    );
    const inn = (code: string, qty: number, expiry: string | null) =>
      entry(w.api, { itemId: milk, type: 'IN', qty, batch: { code, expiry } });
    const old = await inn('B-OLD', 5, today(-1));
    const soon = await inn('B-SOON', 10, today(3));
    const late = await inn('B-LATE', 10, today(30));
    // A batch item can't come in without its batch.
    expect((await w.api.post('/api/ims/stock/entry', { itemId: milk, type: 'IN', qty: 1 })).status).toBe(400);
    // Soonest expiry first; the expired batch is never touched.
    const out = await entry(w.api, { itemId: milk, type: 'OUT', qty: 12 });
    expect(out.picks).toEqual([
      { batchId: soon.batchIds[0], qty: 10 },
      { batchId: late.batchIds[0], qty: 2 },
    ]);
    const short = await w.api.post('/api/ims/stock/entry', { itemId: milk, type: 'OUT', qty: 9 });
    expect(short.status).toBe(409);
    expect(short.body.error.message).toContain('5 ltr has expired');
    // Asking for the expired batch by name is refused too.
    expect(
      (
        await w.api.post('/api/ims/stock/entry', {
          itemId: milk,
          type: 'OUT',
          qty: 1,
          batchId: old.batchIds[0],
        })
      ).status,
    ).toBe(409);
    expect(await total(ctx.prisma, milk)).toBe(13);

    // The expiry list: what has expired and what will within the days asked for.
    const list = await ok<{ batch: string; expired: boolean; daysLeft: number }[]>(
      w.api.get('/api/ims/expiry?days=7'),
    );
    expect(list.map((b) => [b.batch, b.expired])).toEqual([['B-OLD', true]]);
    await entry(w.api, { itemId: milk, type: 'IN', qty: 4, batch: { code: 'B-NEXT', expiry: today(5) } });
    expect((await ok<{ batch: string }[]>(w.api.get('/api/ims/expiry?days=7'))).map((b) => b.batch)).toEqual([
      'B-OLD',
      'B-NEXT',
    ]);
    // The daily warning names what is about to expire (one message a branch; here the group's main store).
    expect(await expiryAlert(ctx.prisma, w.companyId, today())).toBe(1);
    const told = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: w.companyId, name: 'ims.expiry_soon' },
    });
    expect(told.payload).toMatchObject({ count: 2, days: 7 });
    // With a shelf life, a batch without an expiry gets one.
    const curd = await item(
      w,
      { code: 'CURD', name: 'Curd', unit: 'kg' },
      { tracking: 'BATCH', shelfLifeDays: 5 },
    );
    const c = await entry(w.api, { itemId: curd, type: 'IN', qty: 2, batch: { code: 'C1' } });
    expect((await ctx.prisma.stockBatch.findUniqueOrThrow({ where: { id: c.batchIds[0]! } })).expiry).toBe(
      today(5),
    );
    // The expired batch leaves through the wastage register (that is allowed to take it).
    const waste = await ok<{ pending: boolean }>(
      w.api.post('/api/ims/wastage', { itemId: milk, qty: 5, batchId: old.batchIds[0], reason: 'EXPIRED' }),
    );
    expect(waste.pending).toBe(false);
    expect(await total(ctx.prisma, milk)).toBe(12);
  });

  it('U23–U26: pieces by serial with weight and attributes, lots filtered by attribute, a second unit, barcodes', async () => {
    const w = await world(ctx.app);
    await ok(
      w.api.put('/api/ims/attributes', {
        category: 'Jewellery',
        defs: [
          { key: 'purity', label: 'Purity', type: 'choice', options: ['22K', '18K'] },
          { key: 'size', label: 'Size', type: 'number' },
        ],
      }),
    );
    const ring = await item(
      w,
      { code: 'RING', name: 'Gold ring', category: 'Jewellery' },
      { tracking: 'SERIAL', secondUnit: 'g', pricedBy: 'second' },
    );
    // U23: each piece has its own number, cost, weight and attributes.
    const pieces = await entry(w.api, {
      itemId: ring,
      type: 'IN',
      serials: [
        {
          code: 'R-001',
          qty2: 4.25,
          ratePaise: 25_000_00,
          attrs: { purity: '22K', size: 12 },
          barcode: 'RB001',
        },
        { code: 'R-002', qty2: 3.1, ratePaise: 16_000_00, attrs: { purity: '18K' } },
      ],
    });
    expect(pieces.batchIds).toHaveLength(2);
    const held = (await stock(w.api, `?itemId=${ring}`))[0]!;
    expect([held.qty, held.qty2, held.batches.map((b) => b.code)]).toEqual([2, 7.35, ['R-001', 'R-002']]);
    const again = await w.api.post('/api/ims/stock/entry', {
      itemId: ring,
      type: 'IN',
      serials: [{ code: 'R-001', qty2: 4 }],
    });
    expect(again.status).toBe(409);
    const bad = await w.api.post('/api/ims/stock/entry', {
      itemId: ring,
      type: 'IN',
      serials: [{ code: 'R-003', attrs: { purity: '24K' } }],
    });
    expect(bad.status).toBe(400);
    // A piece can't leave without saying which one.
    expect((await w.api.post('/api/ims/stock/entry', { itemId: ring, type: 'OUT', qty: 1 })).status).toBe(
      400,
    );
    // U26: the piece's barcode finds it, and issues exactly that piece.
    const found = await ok<{ item: { id: string }; batch: { code: string; qty2: number } }>(
      w.api.get('/api/ims/scan?code=RB001'),
    );
    expect([found.item.id, found.batch.code, found.batch.qty2]).toEqual([ring, 'R-001', 4.25]);
    await entry(w.api, { barcode: 'RB001', type: 'OUT', qty: 1 });
    const left = (await stock(w.api, `?itemId=${ring}`))[0]!;
    expect([left.qty, left.qty2, left.batches.map((b) => b.code)]).toEqual([1, 3.1, ['R-002']]);
    const story = await ok<{ moves: { type: string }[]; at: unknown[] }>(
      w.api.get(`/api/ims/batches/${pieces.batchIds[0]}`),
    );
    expect([story.moves.map((m) => m.type), story.at]).toEqual([['IN', 'OUT'], []]);
    // How an item is tracked is chosen once.
    expect((await w.api.put(`/api/ims/items/${ring}/extras`, { tracking: 'QTY' })).status).toBe(409);

    // U24: lots carry the category's attributes and stock can be filtered by them.
    await ok(
      w.api.put('/api/ims/attributes', {
        category: 'Slabs',
        defs: [
          { key: 'grade', label: 'Grade', type: 'choice', options: ['A', 'B'] },
          { key: 'thickness', label: 'Thickness', type: 'number' },
        ],
      }),
    );
    const slab = await item(w, { code: 'SLAB', name: 'Quartz slab', category: 'Slabs' }, { tracking: 'LOT' });
    await entry(w.api, {
      itemId: slab,
      type: 'IN',
      qty: 10,
      batch: { code: 'L1', attrs: { grade: 'A', thickness: 20 } },
    });
    await entry(w.api, {
      itemId: slab,
      type: 'IN',
      qty: 5,
      batch: { code: 'L2', attrs: { grade: 'B', thickness: 15 } },
    });
    const gradeA = await stock(
      w.api,
      `?itemId=${slab}&attrs=${encodeURIComponent(JSON.stringify({ grade: 'A' }))}`,
    );
    expect([gradeA[0]!.qty, gradeA[0]!.batches.map((b) => b.code)]).toEqual([10, ['L1']]);

    // U25: a second unit beside the quantity (bags and kilograms) follows the stock.
    const cement = await item(w, { code: 'CEM', name: 'Cement', unit: 'bag' }, { secondUnit: 'kg' });
    await entry(w.api, { itemId: cement, type: 'IN', qty: 40, qty2: 2000 });
    await entry(w.api, { itemId: cement, type: 'OUT', qty: 10 });
    const bags = (await stock(w.api, `?itemId=${cement}`))[0]!;
    expect([bags.qty, bags.qty2]).toEqual([30, 1500]);

    // U26: an item's own barcode; one code belongs to one item.
    await ok(w.api.put(`/api/ims/items/${cement}/extras`, { barcode: '8901234567890' }));
    expect((await w.api.put(`/api/ims/items/${slab}/extras`, { barcode: '8901234567890' })).status).toBe(409);
    await entry(w.api, { barcode: '8901234567890', type: 'OUT', qty: 5 });
    expect(await total(ctx.prisma, cement)).toBe(25);
    expect((await w.api.get('/api/ims/scan?code=NOPE')).status).toBe(404);
  });
});
