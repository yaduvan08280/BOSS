import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { at, entry, loc } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { add, bill, ok, open, pay, restaurant } from './pos-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Menu = { categories: { name: string; items: { name: string; out: string | null }[] }[] };

describe('an outlet with a kitchen and a bar', () => {
  it('takes drinks from the bar and food from the kitchen, and switches a drink off when the bar is out', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const bar = await loc(w, r.g.b.rooftop.id, 'Rooftop bar', 'BAR');
    const outlet = (
      await ok<{ id: string; name: string; branchId: string; locationId: string }[]>(
        w.api.get('/api/hosp/outlets'),
      )
    ).find((o) => o.id === r.outlet)!;
    const save = (stockRoutes: object[]) =>
      w.api.put(`/api/hosp/outlets/${r.outlet}`, {
        name: outlet.name,
        branchId: outlet.branchId,
        locationId: outlet.locationId,
        stockRoutes,
      });
    // A location of another branch is refused.
    const far = await loc(w, r.g.b.lake.id, 'Lake bar', 'BAR');
    expect((await save([{ category: 'Drinks', locationId: far }])).status).toBe(400);
    await ok(save([{ category: 'Drinks', locationId: bar }]));

    const cola = async () =>
      (await ok<Menu>(w.api.get(`/api/hosp/outlets/${r.outlet}/menu`))).categories
        .flatMap((c) => c.items)
        .find((i) => i.name === 'Cola')!;
    // The kitchen still holds 48 cans, but drinks now come from the bar — which has none.
    expect((await cola()).out).toBe('stock');
    await entry(w.api, { itemId: r.stock.cola, type: 'IN', qty: 10, ratePaise: 25_00, locationId: bar });
    expect((await cola()).out).toBeNull();

    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.cola, qty: 2 },
      { menuItemId: r.m.tikka, variantKey: 'full' },
    ]);
    const c = await bill(s, o.id);
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
    expect(await at(ctx.prisma, r.stock.cola, bar)).toBe(8);
    expect(await at(ctx.prisma, r.stock.cola, r.kitchenLoc)).toBe(48);
    // The tikka's paneer left the kitchen as before.
    expect(await at(ctx.prisma, r.stock.paneer, r.kitchenLoc)).toBe(4800);
  }, 60_000);
});
