import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { at, entry, item, kitchens, ok, storeKeepers, total } from './stock-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('inventory v2: levels, wastage and closing counts (phase 13)', () => {
  it('I19, I21, I23, I24, I28: levels and reorder per location, the wastage register, blind closing counts with variance', async () => {
    const w = await world(ctx.app);
    const k = await kitchens(w);
    await storeKeepers(ctx.prisma, w);
    const farah = await k.g.at('Farah Rooftop', k.g.b.rooftop.id, 'HOD');
    const lime = await item(w, { code: 'LIME', name: 'Lime', category: 'Veg' });
    const saffron = await item(w, { code: 'SAF', name: 'Saffron', unit: 'g' });
    await entry(w.api, { itemId: lime, type: 'IN', qty: 30, ratePaise: 2_00, locationId: k.bar });
    await entry(w.api, { itemId: saffron, type: 'IN', qty: 10, ratePaise: 300_00, locationId: k.bar });
    await entry(w.api, { itemId: lime, type: 'IN', qty: 500, ratePaise: 2_00, locationId: k.store });

    // I19: the bar's own levels; what is under them is on the bar's list, with where it comes from.
    type Reorder = {
      rows: {
        name: string;
        short: boolean;
        ask: number;
        coming: number;
        source: { type: string; from?: string };
      }[];
    };
    const list = () => ok<Reorder>(farah.api.get(`/api/ims/par?locationId=${k.bar}`));
    await ok(
      farah.api.put('/api/ims/par', {
        locationId: k.bar,
        levels: [
          { itemId: lime, par: 100, min: 40 },
          { itemId: saffron, par: 8 },
        ],
      }),
    );
    expect((await list()).rows).toMatchObject([
      { name: 'Lime', short: true, ask: 70, source: { type: 'purchase' } },
      { name: 'Saffron', short: false, ask: 0 },
    ]);
    await ok(w.api.put('/api/ims/routes', { toBranchId: k.g.b.rooftop.id, fromLocationId: k.store }));
    expect((await list()).rows[0]!.source).toEqual({
      type: 'indent',
      fromLocationId: k.store,
      from: 'the supplying store',
    });
    // What is already asked for counts as coming.
    await ok(
      farah.api.post('/api/ims/transfers', { toLocationId: k.bar, lines: [{ itemId: lime, qty: 70 }] }),
    );
    expect((await list()).rows.find((r) => r.name === 'Lime')).toMatchObject({
      short: false,
      coming: 70,
      ask: 0,
    });
    // The store has no levels of its own: its list is empty, and the bar's people can't set the store's.
    expect(
      (await farah.api.put('/api/ims/par', { locationId: k.store, levels: [{ itemId: lime, par: 1 }] }))
        .status,
    ).toBe(403);

    // I21: small waste leaves stock at once; above the value limit it waits for an approver.
    type Waste = { id: string; pending: boolean; value: number };
    const small = await ok<Waste>(
      farah.api.post('/api/ims/wastage', { itemId: lime, locationId: k.bar, qty: 5, reason: 'SPOILED' }),
    );
    expect([small.pending, small.value, await at(ctx.prisma, lime, k.bar)]).toEqual([false, 10_00, 25]);
    const big = await ok<Waste>(
      farah.api.post('/api/ims/wastage', {
        itemId: saffron,
        locationId: k.bar,
        qty: 3,
        reason: 'BREAKAGE',
        note: 'Jar dropped',
      }),
    );
    expect([big.pending, big.value, await at(ctx.prisma, saffron, k.bar)]).toEqual([true, 900_00, 10]);
    expect(
      (
        await farah.api.post('/api/ims/wastage', {
          itemId: saffron,
          locationId: k.bar,
          qty: 30,
          reason: 'SPOILED',
        })
      ).status,
    ).toBe(409);
    type Register = {
      rows: { id: string; status: string; reason: string; canDecide: boolean }[];
      byReason: { reason: string; value: number }[];
    };
    const mine = await ok<Register>(farah.api.get('/api/ims/wastage'));
    expect(mine.rows.map((r) => [r.reason, r.status, r.canDecide])).toEqual([
      ['BREAKAGE', 'PENDING', false],
      ['SPOILED', 'APPLIED', false],
    ]);
    expect((await ok<Register>(w.api.get('/api/ims/wastage'))).rows[0]!.canDecide).toBe(true);
    await ok(w.api.post(`/api/ims/moves/${big.id}/decide`, { approve: true }));
    expect(await at(ctx.prisma, saffron, k.bar)).toBe(7);
    expect((await ok<Register>(w.api.get('/api/ims/wastage'))).byReason).toEqual(
      expect.arrayContaining([
        { reason: 'BREAKAGE', value: 900_00 },
        { reason: 'SPOILED', value: 10_00 },
      ]),
    );

    // I24: a blind closing count of the bar — the counter does not see the system figure.
    type Count = {
      id: string;
      status: string;
      canDecide: boolean;
      lines: { name: string; system: number | null; diff: number | null; flagged: boolean }[];
    };
    const opened = await ok<{ id: string }>(
      farah.api.post('/api/ims/closing', { locationId: k.bar, blind: true }),
    );
    expect((await farah.api.post('/api/ims/closing', { locationId: k.bar })).status).toBe(409);
    expect(
      (await ok<Count>(farah.api.get(`/api/ims/closing/${opened.id}`))).lines.map((l) => [l.name, l.system]),
    ).toEqual([
      ['Lime', null],
      ['Saffron', null],
    ]);
    expect((await ok<Count>(w.api.get(`/api/ims/closing/${opened.id}`))).lines.map((l) => l.system)).toEqual([
      25, 7,
    ]);
    await ok(farah.api.put(`/api/ims/closing/${opened.id}`, { lines: [{ itemId: lime, counted: 25 }] }));
    expect((await farah.api.post(`/api/ims/closing/${opened.id}/submit`)).status).toBe(400);
    await ok(farah.api.put(`/api/ims/closing/${opened.id}`, { lines: [{ itemId: saffron, counted: 6 }] }));
    const sent = await ok<Count>(farah.api.post(`/api/ims/closing/${opened.id}/submit`));
    // I23: a gram is missing that no recipe explains: it is flagged.
    expect([sent.status, sent.lines.map((l) => [l.diff, l.flagged])]).toEqual([
      'SUBMITTED',
      [
        [0, false],
        [-1, true],
      ],
    ]);
    // I28: the count is the location's own, and it is not approved by whoever counted.
    expect((await farah.api.post(`/api/ims/closing/${opened.id}/approve`, {})).status).toBe(403);
    expect((await ok<Count>(w.api.post(`/api/ims/closing/${opened.id}/approve`, {}))).status).toBe(
      'APPROVED',
    );
    expect([await at(ctx.prisma, saffron, k.bar), await total(ctx.prisma, saffron)]).toEqual([6, 6]);
    const report = await ok<{ name: string; variance: number; flagged: boolean; value: number }[]>(
      w.api.get(`/api/ims/variance?locationId=${k.bar}`),
    );
    expect(report[0]).toMatchObject({ name: 'Saffron', variance: -1, flagged: true, value: -300_00 });
    // A count with nothing different is approved as it is submitted.
    const second = await ok<{ id: string }>(farah.api.post('/api/ims/closing', { locationId: k.bar }));
    await ok(
      farah.api.put(`/api/ims/closing/${second.id}`, {
        lines: [
          { itemId: lime, counted: 25 },
          { itemId: saffron, counted: 6 },
        ],
      }),
    );
    expect((await ok<Count>(farah.api.post(`/api/ims/closing/${second.id}/submit`))).status).toBe('APPROVED');
  });
});
