import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a factory (phase 21)', { timeout: 120_000 }, () => {
  it('K21–K25: set up from the pack; raw material received by batch; slabs made from the bill of material and invoiced; quality check; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'manufacturing');
    const { companyId } = t;

    // K21 — set up from the pack: raw material and a finished item that is made, its bill of material, the QC record, the process.
    expect(await ctx.prisma.item.findFirstOrThrow({ where: { companyId, code: 'SLAB20' } })).toMatchObject({
      made: 'MAKE',
      tracking: 'BATCH',
    });
    const recipe = await ctx.prisma.recipe.findFirstOrThrow({
      where: { companyId, itemId: t.item('SLAB20'), active: true },
    });
    expect((recipe.lines as unknown[]).length).toBe(2);
    await t.rate('GST18', 18);

    // K22 — buy and receive: grit and resin by batch; the vendor's bill.
    await t.buy('Rajasthan Minerals', [
      { code: 'QTZ', qty: 5000, ratePaise: 8_00, batch: { code: 'Q-0711' } },
      { code: 'RESIN', qty: 600, ratePaise: 150_00, batch: { code: 'RS-22', expiry: today(150) } },
    ]);
    expect([await t.stock('QTZ'), await t.stock('RESIN')]).toEqual([5000, 600]);

    // K23 — make and sell: an order for 40 slabs takes 3,600 kg of grit and 400 kg of resin; 38 come out good; they are invoiced to a dealer.
    const order = await ok<{ id: string; number: string }>(
      w.api.post('/api/ims/production', { itemId: t.item('SLAB20'), qty: 40 }),
    );
    // An order for more than the raw material allows cannot be finished; it is cancelled.
    const tooBig = await ok<{ id: string }>(
      w.api.post('/api/ims/production', { itemId: t.item('SLAB20'), qty: 100 }),
    );
    expect((await w.api.post(`/api/ims/production/${tooBig.id}/finish`, { actualQty: 100 })).status).toBe(
      409,
    );
    await ok(w.api.post(`/api/ims/production/${tooBig.id}/cancel`, {}));
    const made = await ok<{ status: string }>(
      w.api.post(`/api/ims/production/${order.id}/finish`, { actualQty: 38 }),
    );
    expect(made.status).toBe('DONE');
    expect([await t.stock('QTZ'), await t.stock('RESIN'), await t.stock('SLAB20')]).toEqual([1400, 200, 38]);
    const lot = await ctx.prisma.stockBatch.findFirstOrThrow({
      where: { companyId, itemId: t.item('SLAB20') },
    });
    // The batch carries what it really cost: (3,600 × ₹8 + 400 × ₹150) over 38 slabs.
    expect(Math.round(Number(lot.rate))).toBe(Math.round((3600 * 8_00 + 400 * 150_00) / 38));
    const dealer = await t.party('Stone World', ['dealer', 'customer'], { creditDays: 45 });
    const bill = await t.sold({ partyId: dealer, lines: [{ itemId: t.item('SLAB20'), qty: 30 }] });
    expect(bill.total).toBe(Math.round(30 * 9500_00 * 1.18));
    expect(await t.stock('SLAB20')).toBe(8);

    // K24 — the trade's own: every batch has a quality check; only an approver releases or holds it; the production order runs through its process.
    const qc = await t.made('QC', {
      batch: order.number,
      item: 'Quartz slab 20 mm',
      checked: 40,
      rejected: 2,
      result: 'Pass',
      defects: 'Two with pinholes',
    });
    const inspector = await w.person('Line Inspector');
    expect(
      (await inspector.api.post(`/api/records/entries/${qc.id}/move`, { action: 'release' })).status,
    ).toBe(403);
    expect(await t.moveTo(qc.id, 'release')).toMatchObject({ status: 'released' });
    expect((await t.record('QC', { batch: 'X', item: 'Y', checked: 1 })).status).toBe(400);
    expect(
      await t.through('Production order', { item: 'Quartz slab 20 mm', qty: 40, needed: today(3) }),
    ).toBe('CLOSED');

    // K25 — the owner's view: quality by result, the value of stock, what dealers owe, the Weekly MIS.
    expect((await t.run('Quality checks by result')).rows).toEqual([['Pass', 1]]);
    expect((await w.api.get('/api/ims/valuation')).status).toBe(200);
    expect((await t.owed()).rows).toMatchObject([
      { party: { name: 'Stone World' }, due: bill.total, overdue: 0 },
    ]);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
