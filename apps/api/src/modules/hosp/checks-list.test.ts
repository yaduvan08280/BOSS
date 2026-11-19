import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { checkView, listChecks } from './checks-read';
import { posOutlet } from './pos-core';
import { add, bill, ok, pay, restaurant, type CheckOut } from './pos-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('the day’s bills at an outlet (polled by every POS screen)', () => {
  it('lists the same as reading each bill by itself, and one order’s bills can be asked for by the order', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const made: { orderId: string; check: CheckOut }[] = [];
    for (let i = 0; i < 6; i++) {
      const o = await ok<{ id: string }>(s.post('/api/pos/orders', { outletId: r.outlet, type: 'TAKEAWAY' }));
      await add(s, o.id, [{ menuItemId: r.m.cola, qty: i + 1 }]);
      const c = await bill(s, o.id);
      // Half of them are paid, so paid and unpaid bills are both in the list.
      if (i % 2 === 0) await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
      made.push({ orderId: o.id, check: c });
    }
    const list = await ok<CheckOut[]>(s.get(`/api/pos/outlets/${r.outlet}/checks`));
    expect(list).toHaveLength(6);
    const actor = {
      companyId: w.companyId,
      userId: w.owner.id as string,
      permissions: ['*'],
    } as Parameters<typeof listChecks>[1];
    const outlet = await posOutlet(ctx.prisma, actor, r.outlet);
    for (const row of await listChecks(ctx.prisma, actor, r.outlet))
      expect(row).toEqual(await checkView(ctx.prisma, outlet, row.id));
    expect(list.filter((c) => c.status === 'PAID')).toHaveLength(3);
    expect(list.filter((c) => c.due > 0)).toHaveLength(3);

    const third = made[3]!;
    const own = await ok<CheckOut[]>(s.get(`/api/pos/outlets/${r.outlet}/checks?orderId=${third.orderId}`));
    expect(own.map((c) => c.id)).toEqual([third.check.id]);
    // Another outlet's address never shows this order's bill.
    const other = await ok<{ id: string }>(
      w.api.post('/api/hosp/outlets', { name: 'Second outlet', branchId: r.g.b.rooftop.id }),
    );
    expect(
      await ok<CheckOut[]>(w.api.get(`/api/pos/outlets/${other.id}/checks?orderId=${third.orderId}`)),
    ).toEqual([]);
  });
});
