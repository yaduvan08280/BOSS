import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { itemsField, plant as plantIn, task } from './step-stock.fixture';

/**
 * A step that issues stock takes it from the main store. Its preview must count what the main store can give —
 * not the company's total, which may sit at another location. (Found in the browser: the preview said
 * "Now 11,250 → 11,248" and the step then refused with "Only 0 in stock".)
 */
let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('stock on a step, when the stock is kept somewhere else', () => {
  it('the preview shows what the main store holds, says it is short, and agrees with what marking done does', async () => {
    const p = await plantIn(ctx);
    // All 24 bearings but 1 are now kept on a shelf at another branch (taken out of the main store, taken in there).
    const branch = (await p.api.post('/api/org/branches', { name: 'Plant two', code: 'P2' })).body as {
      id: string;
    };
    const shelf = (
      await p.api.post('/api/branches/locations', { branchId: branch.id, name: 'Shelf', kind: 'STORE' })
    ).body as { id: string };
    for (const body of [
      { itemId: p.bearing.id, type: 'OUT', qty: 23 },
      { itemId: p.bearing.id, type: 'IN', qty: 23, locationId: shelf.id },
    ]) {
      const r = await p.api.post('/api/ims/stock/entry', body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    expect(await p.stock(p.bearing.id)).toBe(24); // the company's total is what it was

    const f = await p.flow('Issue from the main store', {
      startFields: [itemsField({ freeItems: false })],
      steps: [task('issue', p.doer.id, { stock: { action: 'ISSUE', short: 'block' } })],
    });
    const rec = (await p.start(f, { lines: [{ item: 'Bearing 6205', qty: 2, itemId: p.bearing.id }] })).body;
    const step = await p.open(rec.id);
    const plan = (await p.doer.api.post(`/api/fms/steps/${step.id}/stock-preview`, { data: {} })).body.stock;
    expect(plan.lines).toMatchObject([{ name: 'Bearing 6205', qty: 2, stock: 1, short: true, shortBy: 1 }]);
    expect(plan.blocked).toBe(true);
    // Marking done says the same thing, in the same words as any short step.
    const refused = await p.done(p.doer.api, step);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/Not enough stock: Bearing 6205 is short by 1 pcs/);
    expect(await p.stock(p.bearing.id)).toBe(24);

    // One that the main store can give goes through, and the preview said so.
    const one = (await p.start(f, { lines: [{ item: 'Bearing 6205', qty: 1, itemId: p.bearing.id }] })).body;
    const stepOne = await p.open(one.id);
    const fine = (await p.doer.api.post(`/api/fms/steps/${stepOne.id}/stock-preview`, { data: {} })).body
      .stock;
    expect(fine.lines).toMatchObject([{ stock: 1, after: 0, short: false }]);
    expect((await p.done(p.doer.api, stepOne)).status).toBe(200);
    expect(await p.stock(p.bearing.id)).toBe(23);
  });
});
