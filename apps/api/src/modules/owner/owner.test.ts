import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, ownerClient } from '../../test/helpers';
import { add, bill, ok, open, pay, restaurant } from '../hosp/pos-kit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

describe("the owner's desk", () => {
  it('ranks branches, lists what broke its range, and shows where money leaks', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // A table that pays with a 5 % discount, and a fired dish voided by the manager.
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.dal, qty: 2 },
      { menuItemId: r.m.naan, qty: 4 },
    ]);
    const c = await bill(s, o.id, { discount: { kind: 'PERCENT', value: 5, reason: 'Regular guest' } });
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
    const o2 = await open(s, r, 'T2');
    await add(s, o2.id, [{ menuItemId: r.m.dal }, { menuItemId: r.m.kulfi }]);
    const items = (await ok<{ items: { id: string; name: string }[] }>(s.get(`/api/pos/orders/${o2.id}`)))
      .items;
    await ok(
      r.manager.api.post(
        `/api/pos/orders/${o2.id}/items/${items.find((i) => i.name === 'Dal makhani')!.id}/void`,
        {
          reason: 'Guest changed their mind',
          cooked: false,
        },
      ),
    );
    const span = `?from=${today()}&to=${today()}`;
    const league = await ok<{
      branches: {
        branch: string;
        sales: number;
        discountPct: number;
        voidPct: number;
        score: number | null;
      }[];
    }>(w.api.get(`/api/owner/league${span}`));
    const roof = league.branches.find((b) => b.branch === 'Rooftop Jaipur')!;
    expect(roof.sales).toBe(c.total);
    expect(roof.discountPct).toBeGreaterThan(0);
    expect(roof.voidPct).toBeGreaterThan(2);
    expect(league.branches[0]!.score).not.toBeNull();

    // Voids over the usual 2 % are an exception, named with the branch's manager; a wider range clears it.
    type Ex = { exceptions: { branch: string; key: string; value: number; limit: number }[] };
    const ex = await ok<Ex>(w.api.get(`/api/owner/exceptions${span}`));
    expect(ex.exceptions.find((e) => e.branch === 'Rooftop Jaipur' && e.key === 'voidPct')).toMatchObject({
      limit: 2,
    });
    await ok(w.api.put('/api/owner/ranges', { branchId: r.g.b.rooftop.id, ranges: { voidPct: 90 } }));
    const after = await ok<Ex>(w.api.get(`/api/owner/exceptions${span}`));
    expect(after.exceptions.some((e) => e.branch === 'Rooftop Jaipur' && e.key === 'voidPct')).toBe(false);

    const leak = await ok<{
      totals: { voids: number; discounts: number };
      people: { name: string; voids: number; discounts: number }[];
      voidReasons: { reason: string }[];
    }>(w.api.get(`/api/owner/leaks${span}`));
    expect(leak.totals.voids).toBe(280_00);
    expect(leak.totals.discounts).toBeGreaterThan(0);
    expect(leak.people.find((p) => p.name === 'Meera Manager')!.voids).toBe(280_00);
    expect(leak.voidReasons[0]!.reason).toBe('Guest changed their mind');

    // The other pages answer, and none of it is open to a steward.
    for (const path of ['promises', 'delay', 'bus-factor', 'vendors', 'cash-flow', 'morning'])
      expect((await w.api.get(`/api/owner/${path}`)).status, path).toBe(200);
    expect((await s.get('/api/owner/leaks')).status).toBe(403);
    expect((await s.get('/api/owner/morning')).status).toBe(403);
  }, 90_000);

  it('promises: work done by its date is kept, late work and moved dates are not', async () => {
    const w = await world(ctx.app);
    const asha = await w.person('Asha Keeper');
    const ravi = await w.person('Ravi Slipper');
    const give = async (doerId: string, hours: number) =>
      (
        await ok<{ id: string }>(
          w.api.post('/api/tasks', {
            doerId,
            plannedAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
            description: 'Count the store',
          }),
        )
      ).id;
    const a = await give(asha.id, 5);
    await ok(asha.api.post(`/api/tasks/${a}/actions`, { action: 'accept' }));
    await ok(asha.api.post(`/api/tasks/${a}/actions`, { action: 'markDone', note: 'Counted and matched' }));
    const b = await give(ravi.id, -5); // already late
    await ok(ravi.api.post(`/api/tasks/${b}/actions`, { action: 'accept' }));
    await ok(
      ravi.api.post(`/api/tasks/${b}/actions`, {
        action: 'moveDate',
        plannedAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        reason: 'Waiting for the vendor',
      }),
    );
    const far = new Date(Date.now() + 5 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const p = await ok<{
      people: { name: string; due: number; kept: number; moved: number; keptPct: number | null }[];
    }>(w.api.get(`/api/owner/promises?from=${today()}&to=${far}`));
    expect(p.people.find((x) => x.name === 'Asha Keeper')).toMatchObject({ due: 1, kept: 1, keptPct: 100 });
    expect(p.people.find((x) => x.name === 'Ravi Slipper')).toMatchObject({ moved: 1 });
  }, 60_000);

  it('a second company is shown only after its owner signs in to it from here', async () => {
    const one = await ownerClient(ctx.app);
    const two = await ownerClient(ctx.app);
    type Morning = { companies: { name: string; mine: boolean }[]; linked: number };
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).companies).toHaveLength(1);
    // A wrong password links nothing.
    expect(
      (await one.api.post('/api/owner/companies', { identifier: two.mobile, password: 'wrong-password' }))
        .status,
    ).toBe(401);
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).linked).toBe(0);
    await ok(one.api.post('/api/owner/companies', { identifier: two.mobile, password: two.password }));
    const both = await ok<Morning>(one.api.get('/api/owner/morning'));
    expect(both.companies.map((c) => c.mine)).toEqual([true, false]);
    expect(both.companies[1]!.name).toBe(two.company.name);
    // The other side sees nothing of the first until it links back itself.
    expect((await ok<Morning>(two.api.get('/api/owner/morning'))).companies).toHaveLength(1);
    await ok(one.api.del(`/api/owner/companies/${two.company.id}`));
    expect((await ok<Morning>(one.api.get('/api/owner/morning'))).companies).toHaveLength(1);
  }, 60_000);
});
