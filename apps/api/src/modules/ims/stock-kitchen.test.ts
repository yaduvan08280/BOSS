import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { at, entry, item, kitchens, ok, today, total } from './stock-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('inventory v2: recipes, production, goods receipts, levels, wastage, counts (phase 13)', () => {
  it('I7, I8, I12, I22: versioned recipes with cost, production with yield variance, a sale uses the recipe', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    const onion = await item(w, { code: 'ONI', name: 'Onion', unit: 'g' });
    const cream = await item(w, { code: 'CRM', name: 'Cream', unit: 'ml' });
    const paneer = await item(w, { code: 'PAN', name: 'Paneer', unit: 'g' });
    const gravy = await item(
      w,
      { code: 'GRV', name: 'Makhani gravy', unit: 'ml' },
      { made: 'MAKE', tracking: 'BATCH', shelfLifeDays: 3 },
    );
    const dish = await item(
      w,
      { code: 'BPM', name: 'Butter paneer', unit: 'plate' },
      { made: 'DISH', sellPrice: 320_00 },
    );
    await entry(w.api, { itemId: onion, type: 'IN', qty: 5000, ratePaise: 4, locationId: k.hot });
    await entry(w.api, { itemId: cream, type: 'IN', qty: 1000, ratePaise: 30, locationId: k.hot });
    await entry(w.api, { itemId: paneer, type: 'IN', qty: 2000, ratePaise: 40, locationId: k.hot });
    const save = (body: object) => w.api.put('/api/ims/recipes', body);
    // A bought item has no recipe.
    expect((await save({ itemId: paneer, lines: [{ itemId: onion, qty: 1 }] })).status).toBe(409);
    // I7: saving again makes a new version; the old one is kept, switched off.
    await ok(
      save({
        itemId: gravy,
        outputQty: 1000,
        lines: [
          { itemId: onion, qty: 850, yieldPct: 85 },
          { itemId: cream, qty: 250 },
        ],
      }),
    );
    expect(
      await ok<{ version: number }>(
        save({
          itemId: gravy,
          outputQty: 1000,
          lines: [
            { itemId: onion, qty: 850, yieldPct: 85 },
            { itemId: cream, qty: 200 },
          ],
        }),
      ),
    ).toMatchObject({ version: 2 });
    type Recipe = {
      name: string;
      version: number;
      active: boolean;
      cost: number | null;
      foodCostPct: number | null;
    };
    expect(
      (await ok<Recipe[]>(w.api.get(`/api/ims/recipes?itemId=${gravy}`))).map((r) => [r.version, r.active]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    await ok(
      save({
        itemId: dish,
        lines: [
          { itemId: paneer, qty: 150, wastagePct: 4 },
          { itemId: gravy, qty: 200 },
        ],
      }),
    );
    // I8: cost from the latest rates, through the sub-recipe; food cost % against the selling price.
    const book = await ok<Recipe[]>(w.api.get('/api/ims/recipes'));
    expect(book.map((r) => [r.name, r.cost, r.foodCostPct])).toEqual([
      ['Butter paneer', 8240, 25.8],
      ['Makhani gravy', 10, null],
    ]);
    // A recipe that would contain itself is refused; so is a unit the ingredient does not have.
    expect((await save({ itemId: gravy, lines: [{ itemId: dish, qty: 1 }] })).status).toBe(400);
    expect((await save({ itemId: dish, lines: [{ itemId: paneer, qty: 1, unit: 'kg' }] })).status).toBe(400);

    // I12: production takes the raw material, makes a batch with an expiry and its real cost, keeps the yield variance.
    expect(
      (await w.api.post('/api/ims/production', { itemId: dish, qty: 1, locationId: k.hot })).status,
    ).toBe(409);
    const order = await ok<{ id: string; number: string }>(
      w.api.post('/api/ims/production', { itemId: gravy, qty: 2000, locationId: k.hot }),
    );
    const made = await ok<{
      cost: number;
      rate: number;
      variance: number;
      variancePct: number;
      batchId: string;
    }>(w.api.post(`/api/ims/production/${order.id}/finish`, { actualQty: 1900 }));
    expect(made).toMatchObject({ cost: 2000 * 4 + 400 * 30, rate: 11, variance: -100, variancePct: -5 });
    expect([
      await at(ctx.prisma, onion, k.hot),
      await at(ctx.prisma, cream, k.hot),
      await at(ctx.prisma, gravy, k.hot),
    ]).toEqual([3000, 600, 1900]);
    expect(await ctx.prisma.stockBatch.findUniqueOrThrow({ where: { id: made.batchId } })).toMatchObject({
      code: order.number,
      expiry: today(3),
    });
    expect((await w.api.post(`/api/ims/production/${order.id}/finish`, { actualQty: 1 })).status).not.toBe(
      200,
    );
    // Not enough raw material: nothing is made and nothing is taken.
    const big = await ok<{ id: string }>(
      w.api.post('/api/ims/production', { itemId: gravy, qty: 99000, locationId: k.hot }),
    );
    expect((await w.api.post(`/api/ims/production/${big.id}/finish`, { actualQty: 99000 })).status).toBe(409);
    expect(await at(ctx.prisma, onion, k.hot)).toBe(3000);

    // I22: selling the dish takes its ingredients from the kitchen (the gravy from its batch) and raises one invoice.
    const guest = await ok<{ id: string }>(
      w.api.post('/api/money/parties', { name: 'Walk-in guest', kinds: ['guest'] }),
    );
    const sale = await ok<{ total: number; cost: number; billId: string }>(
      w.api.post('/api/ims/sell', {
        partyId: guest.id,
        locationId: k.hot,
        lines: [{ itemId: dish, qty: 2 }],
      }),
    );
    expect(sale.total).toBe(640_00);
    expect(sale.cost).toBeGreaterThan(312 * 40);
    expect([
      await at(ctx.prisma, paneer, k.hot),
      await at(ctx.prisma, gravy, k.hot),
      await total(ctx.prisma, dish),
    ]).toEqual([1688, 1500, 0]);
    const bills = await ctx.prisma.bill.count({ where: { companyId: w.companyId } });
    expect(
      (
        await w.api.post('/api/ims/sell', {
          partyId: guest.id,
          locationId: k.hot,
          lines: [{ itemId: dish, qty: 100 }],
        })
      ).status,
    ).toBe(409);
    expect([
      await ctx.prisma.bill.count({ where: { companyId: w.companyId } }),
      await at(ctx.prisma, paneer, k.hot),
    ]).toEqual([bills, 1688]);
  });

  it('I16–I18, I20: goods received against an order — variances, batch, rejected, the purchase bill, a return to the vendor', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    const milk = await item(
      w,
      { code: 'MILK', name: 'Milk', unit: 'ltr', ratePaise: 60_00 },
      { tracking: 'BATCH', units: [{ unit: 'can', factor: 40 }] },
    );
    // I20: the order says where the goods are delivered.
    const po = await ok<{ id: string; number: string }>(
      w.api.post('/api/ims/po', {
        vendor: 'Jaipur Dairy',
        locationId: k.store,
        lines: [{ itemId: milk, qty: 400, ratePaise: 60_00 }],
      }),
    );
    await ok(w.api.post(`/api/ims/po/${po.id}/send`, {}));
    const grn = (body: object) =>
      w.api.post('/api/ims/grn', { poId: po.id, invoiceNo: 'JD/881', invoiceDate: today(), ...body });
    const line = {
      itemId: milk,
      qty: 8,
      unit: 'can',
      ratePaise: 2480_00,
      rejected: 1,
      rejectReason: 'Leaking can',
      batch: { code: 'JD-1', expiry: today(4) },
    };
    // I18: a bill needs the vendor to be a party a person matched — never a guess.
    const unmatched = await grn({ raiseBill: true, lines: [line] });
    expect(unmatched.status).toBe(409);
    const dairy = await ok<{ id: string }>(
      w.api.post('/api/money/parties', { name: 'Jaipur Dairy Pvt Ltd', kinds: ['vendor'] }),
    );
    await ok(w.api.post('/api/money/vendors/match', { name: 'Jaipur Dairy', partyId: dairy.id }));
    type Grn = {
      id: string;
      billId: string;
      poStatus: string;
      lines: {
        received: number;
        rate: number;
        poRate: number;
        qtyVariance: number;
        rateVariance: number;
        rejected: number;
      }[];
    };
    const got = await ok<Grn>(grn({ raiseBill: true, lines: [line] }));
    // I16: 8 cans of 40 l at ₹62 a litre against 400 l at ₹60: 80 l short, ₹2 over, one can rejected at the gate.
    expect(got.lines[0]).toMatchObject({
      received: 320,
      rate: 62_00,
      poRate: 60_00,
      qtyVariance: -80,
      rateVariance: 2_00,
      rejected: 40,
    });
    expect(got.poStatus).toBe('PARTLY_RECEIVED');
    expect([await at(ctx.prisma, milk, k.store), await at(ctx.prisma, milk, '')]).toEqual([320, 0]);
    const batch = await ctx.prisma.stockBatch.findFirstOrThrow({ where: { itemId: milk, code: 'JD-1' } });
    expect([batch.expiry, Number(batch.rate)]).toEqual([today(4), 62_00]);
    // The latest purchase rate becomes the item's rate.
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: milk } })).rate)).toBe(62_00);
    // I18: the vendor's purchase bill for what was accepted.
    const bill = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: got.billId } });
    expect(bill).toMatchObject({
      type: 'PURCHASE_BILL',
      status: 'ISSUED',
      partyId: dairy.id,
      reference: 'JD/881',
      total: BigInt(320 * 62_00),
    });
    // More than was still due is taken in and shown as an excess; the order is then complete.
    const extra = await ok<Grn>(
      grn({ lines: [{ itemId: milk, qty: 5, unit: 'can', batch: { code: 'JD-2', expiry: today(6) } }] }),
    );
    expect([extra.lines[0]!.qtyVariance, extra.lines[0]!.rateVariance, extra.poStatus]).toEqual([
      120,
      0,
      'RECEIVED',
    ]);
    expect(await at(ctx.prisma, milk, k.store)).toBe(520);

    // I17: 40 l go back to the vendor: stock out, and the bill is credited.
    const back = await ok<{ credit: number; noteId: string }>(
      w.api.post(`/api/ims/grn/${got.id}/return`, {
        lines: [{ itemId: milk, qty: 40 }],
        reason: 'Sour on arrival',
      }),
    );
    expect(back.credit).toBe(40 * 62_00);
    expect(await at(ctx.prisma, milk, k.store)).toBe(480);
    expect(await ctx.prisma.bill.findUniqueOrThrow({ where: { id: got.billId } })).toMatchObject({
      credited: BigInt(40 * 62_00),
    });
    expect(
      (
        await w.api.post(`/api/ims/grn/${got.id}/return`, {
          lines: [{ itemId: milk, qty: 300 }],
          reason: 'Too much',
        })
      ).status,
    ).toBe(409);
    // Goods can also be received with no order at all.
    const loose = await ok<Grn>(
      w.api.post('/api/ims/grn', {
        vendor: 'Local market',
        locationId: k.hot,
        lines: [{ itemId: milk, qty: 10, ratePaise: 65_00, batch: { code: 'LM-1' } }],
      }),
    );
    expect([loose.lines[0]!.qtyVariance, await at(ctx.prisma, milk, k.hot)]).toEqual([null, 10]);
  });
});
