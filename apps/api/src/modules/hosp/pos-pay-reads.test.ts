import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db, Tx } from '@mono/db';
import { counting, makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { actorFor } from '../work/actor';
import { payCheck } from './payments';
import { add, bill, open, order, restaurant } from './pos-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/** Every model call a payment makes: `outside` its transaction and `inside` it. */
function watching() {
  const outside = counting(ctx.prisma);
  let inside: string[] = [];
  const db = new Proxy(outside.db, {
    get(target, key) {
      if (key !== '$transaction') return (target as unknown as Record<string | symbol, unknown>)[key];
      return (fn: (tx: Tx) => Promise<unknown>) =>
        ctx.prisma.$transaction((tx) => {
          const w = counting(tx);
          inside = w.seen.calls;
          return fn(w.db as Tx);
        });
    },
  }) as unknown as Db;
  return { db, outside: () => outside.seen.calls, inside: () => inside };
}

/**
 * A payment is the longest thing a till does, and at a busy hour every statement in it waits its turn. So it
 * asks only what it needs: the invoice is read once (inside the transaction), and the company's items and
 * recipes are read only when something on the order is stocked.
 */
describe('what a payment reads', () => {
  it('reads the invoice once, and no recipes for an order with nothing stocked — but takes stock for a dish', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const owner = (await actorFor(ctx.prisma, w.companyId, w.owner.id))!;

    // Dal has no stock item: nothing to take.
    const plain = await open(w.api, r, 'T1');
    await add(w.api, plain.id, [{ menuItemId: r.m.dal, qty: 1 }]);
    const c1 = await bill(w.api, plain.id);
    const a = watching();
    const paid = await payCheck(a.db, owner, c1.id, {
      payments: [{ modeId: r.modes.cash, amount: c1.total }],
    });
    expect(paid.orderStatus).toBe('PAID');
    const reads = (calls: string[]) => calls.filter((c) => c === 'bill.findUniqueOrThrow').length;
    // Outside the transaction only the answer's read-back; inside it the invoice before the money and the
    // check after it (the receipt itself is not read back before its number).
    expect(reads(a.outside())).toBe(1);
    expect(reads(a.inside())).toBe(2);
    expect(a.inside()).not.toContain('item.findMany');
    expect(a.inside()).not.toContain('recipe.findMany');
    expect(a.inside()).not.toContain('stockBalance.groupBy');
    expect((await order(w.api, plain.id)).status).toBe('PAID');

    // Paneer tikka is a dish with a recipe: 200 g of paneer leave the kitchen.
    const before = await ctx.prisma.stockBalance.aggregate({
      where: { itemId: r.stock.paneer, locationId: r.kitchenLoc },
      _sum: { qty: true },
    });
    const dish = await open(w.api, r, 'T2');
    await add(w.api, dish.id, [{ menuItemId: r.m.tikka, variantKey: 'full', qty: 1 }]);
    const c2 = await bill(w.api, dish.id);
    const b = watching();
    await payCheck(b.db, owner, c2.id, { payments: [{ modeId: r.modes.cash, amount: c2.total }] });
    expect(b.inside()).toContain('recipe.findMany');
    const after = await ctx.prisma.stockBalance.aggregate({
      where: { itemId: r.stock.paneer, locationId: r.kitchenLoc },
      _sum: { qty: true },
    });
    expect(Number(before._sum.qty) - Number(after._sum.qty)).toBe(200);

    // More than is owed is still refused, and nothing is taken.
    const third = await open(w.api, r, 'T3');
    await add(w.api, third.id, [{ menuItemId: r.m.dal, qty: 1 }]);
    const c3 = await bill(w.api, third.id);
    await expect(
      payCheck(ctx.prisma, owner, c3.id, { payments: [{ modeId: r.modes.cash, amount: c3.total + 1 }] }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await ctx.prisma.posCheck.findUniqueOrThrow({ where: { id: c3.id } })).status).toBe('OPEN');
    // Company credit on a walk-in bill is refused as before.
    await expect(
      payCheck(ctx.prisma, owner, c3.id, { payments: [{ modeId: r.modes.company, amount: c3.total }] }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
