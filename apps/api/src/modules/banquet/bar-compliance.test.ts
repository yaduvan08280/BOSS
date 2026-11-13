import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays, localDate } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { add, bill, ok, open, pay, post, restaurant } from '../hosp/pos-kit';
import { entry, item } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { exciseExport } from './bar';
import { complianceSweep } from './compliance';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;
const today = localDate(new Date(), 'Asia/Kolkata');

/** A whisky kept in ml (bottles of 750, pegs of 60), sold as a peg through its recipe at the Rooftop restaurant. */
async function bar(w: Awaited<ReturnType<typeof world>>) {
  const r = await restaurant(ctx.prisma, w);
  const branchId = r.g.b.rooftop.id;
  const whisky = await item(
    w,
    { code: 'RO', name: 'Royal Oak', unit: 'ml', category: 'Liquor' },
    {
      brand: 'Royal Oak',
      units: [
        { unit: 'bottle', factor: 750 },
        { unit: 'peg', factor: 60, serve: true },
      ],
    },
  );
  const peg = await item(w, { code: 'D-PEG', name: 'Royal Oak 60 ml (dish)', unit: 'peg' }, { made: 'DISH' });
  await ok(w.api.put('/api/ims/recipes', { itemId: peg, lines: [{ itemId: whisky, qty: 60 }] }));
  await entry(w.api, { itemId: whisky, type: 'IN', qty: 9000, ratePaise: 1, locationId: r.kitchenLoc });
  const drinks = await ctx.prisma.menuCategory.findFirstOrThrow({
    where: { companyId: w.companyId, name: 'Drinks' },
  });
  const menu = await post(w.api, '/api/hosp/menu/items', {
    categoryId: drinks.id,
    name: 'Royal Oak 60 ml',
    itemId: peg,
    price: 450_00,
  });
  const rules = (body: object) => ok(w.api.put(`/api/hosp/branch-rules?branchId=${branchId}`, body));
  return { r, branchId, whisky, pegMenu: menu.id, rules };
}

describe('Bar and excise, compliance (phase 18)', { timeout: 60_000 }, () => {
  it('B13, B14, B15: the licence, a brand-wise daily register in bottles and ml, and the state-format file', async () => {
    const w = await world(ctx.app);
    const b = await bar(w);
    // Only set-up people change a branch's rules; only what is sent changes.
    expect(
      (
        await b.r.manager.api.put(`/api/hosp/branch-rules?branchId=${b.branchId}`, {
          bar: { licenceNo: 'X' },
        })
      ).status,
    ).toBe(403);
    await b.rules({
      bar: {
        licenceNo: 'RJ/HBL/2026/114',
        permitNo: 'P-77',
        licensee: 'GGM Hotels Rajasthan',
        liquorCategories: ['Liquor'],
      },
    });
    await b.rules({ banquet: { advancePct: 30 } });
    const saved = await ok<{
      rules: { bar: { licenceNo: string; format: string }; banquet: { advancePct: number } };
    }>(b.r.steward.api.get(`/api/hosp/branch-rules?branchId=${b.branchId}`));
    expect(saved.rules).toMatchObject({
      bar: { licenceNo: 'RJ/HBL/2026/114', format: 'RAJASTHAN' },
      banquet: { advancePct: 30 },
    });
    // Today: 12 bottles came in, two pegs were sold at the table, one bottle broke.
    const o = await open(b.r.steward.api, b.r, 'T1');
    await add(b.r.steward.api, o.id, [{ menuItemId: b.pegMenu, qty: 2 }]);
    const c = await bill(b.r.steward.api, o.id);
    await pay(b.r.steward.api, c.id, [{ modeId: b.r.modes.cash, amount: c.total }]);
    await ok(
      w.api.post('/api/ims/wastage', {
        itemId: b.whisky,
        locationId: b.r.kitchenLoc,
        qty: 750,
        reason: 'BREAKAGE',
        note: 'Bottle dropped',
      }),
    );
    type Reg = { licenceNo: string; rows: Record<string, unknown>[] };
    const reg = await ok<Reg>(b.r.steward.api.get(`/api/bar/excise?branchId=${b.branchId}&from=${today}`));
    expect(reg.licenceNo).toBe('RJ/HBL/2026/114');
    // Only liquor is on it (the cola and paneer of the kitchen are not).
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({
      brand: 'Royal Oak',
      sizeMl: 750,
      location: 'Rooftop kitchen',
      opening: { bottles: 0, ml: 0 },
      received: { bottles: 12, ml: 0 },
      sold: { bottles: 0, ml: 120 },
      breakage: { bottles: 1, ml: 0 },
      closing: { bottles: 10, ml: 630 },
      ml: { received: 9000, sold: 120, breakage: 750, closing: 8130 },
    });
    // Tomorrow opens with today's closing.
    const next = await ok<Reg>(
      b.r.steward.api.get(`/api/bar/excise?branchId=${b.branchId}&from=${addDays(today, 1)}`),
    );
    expect(next.rows[0]).toMatchObject({
      opening: { bottles: 10, ml: 630 },
      closing: { bottles: 10, ml: 630 },
    });
    // The file: the licence in the heading, bottles and ml side by side.
    const csv = await exciseExport(
      ctx.prisma,
      { companyId: w.companyId, userId: b.r.steward.id, permissions: ['hosp.view'] },
      { branchId: b.branchId, from: today },
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Daily stock register of liquor (brand-wise)"');
    expect(lines[1]).toContain('"Licence no.","RJ/HBL/2026/114","Permit no.","P-77"');
    expect(lines[5]).toBe(
      `"${today.split('-').reverse().join('/')}","Rooftop kitchen","Royal Oak","750","0","0","12","0","0","120","1","0","10","630",""`,
    );
  });

  it('B16: a dry day blocks liquor sales at the branch — food still sells', async () => {
    const w = await world(ctx.app);
    const b = await bar(w);
    await b.rules({
      bar: { liquorCategories: ['Liquor'], dryDays: [{ date: today, reason: 'Election day' }] },
    });
    const s = b.r.steward.api;
    const o = await open(s, b.r, 'T1');
    const refused = await s.post(`/api/pos/orders/${o.id}/items`, {
      items: [{ menuItemId: b.pegMenu }],
      fire: true,
    });
    const got = refused.status === 200 ? (refused.body as { added: number; skipped: number }) : null;
    // The liquor is not sold (refused, or skipped with nothing added), whatever else is on the order.
    expect(got ? got.added : 0).toBe(0);
    expect((await add(s, o.id, [{ menuItemId: b.r.m.dal }])).added).toBe(1);
    type Menu = { categories: { items: { id: string; out: string | null; outReason: string | null }[] }[] };
    const menu = await ok<Menu>(s.get(`/api/hosp/outlets/${b.r.outlet}/menu`));
    const peg = menu.categories.flatMap((c) => c.items).find((i) => i.id === b.pegMenu)!;
    expect(peg).toMatchObject({ out: 'off', outReason: 'Dry day — Election day' });
    expect(menu.categories.flatMap((c) => c.items).find((i) => i.id === b.r.m.dal)!.out).toBeNull();
    // The next day it sells again.
    await b.rules({ bar: { dryDays: [{ date: addDays(today, 1), reason: 'Election day' }] } });
    expect((await add(s, o.id, [{ menuItemId: b.pegMenu }])).added).toBe(1);
  });

  it('B17, B18, B20: licences with their state, reminders at each step once, renewal, and a recurring duty (pest control)', async () => {
    const w = await world(ctx.app);
    const b = await bar(w);
    const item_ = (body: object, api = b.r.manager.api) =>
      api.post('/api/compliance', { branchId: b.branchId, ...body });
    expect(
      (await item_({ kind: 'FSSAI', name: 'FSSAI licence', expiresOn: addDays(today, 200) }, b.r.steward.api))
        .status,
    ).toBe(403);
    const fssai = await ok<{ id: string }>(
      item_({
        kind: 'FSSAI',
        name: 'FSSAI licence',
        number: '12226999000111',
        authority: 'FSSAI',
        expiresOn: addDays(today, 200),
      }),
    );
    const liquor = await ok<{ id: string }>(
      item_({
        kind: 'LIQUOR',
        name: 'Bar licence',
        number: 'RJ/HBL/2026/114',
        expiresOn: addDays(today, 25),
      }),
    );
    await ok(item_({ kind: 'FIRE_NOC', name: 'Fire NOC', expiresOn: addDays(today, -3) }));
    const pest = await ok<{ id: string }>(
      item_({ kind: 'PEST_CONTROL', name: 'Pest control', expiresOn: today, everyDays: 30, remindDays: [3] }),
    );
    type List = {
      counts: Record<string, number>;
      items: {
        id: string;
        name: string;
        state: string;
        daysLeft: number;
        expiresOn: string;
        history: { next: string }[];
      }[];
    };
    const list = () => ok<List>(b.r.steward.api.get(`/api/compliance?branchId=${b.branchId}`));
    const first = await list();
    expect(first.counts).toEqual({ valid: 1, expiring: 2, expired: 1 });
    expect(first.items.map((i) => [i.name, i.state, i.daysLeft])).toEqual([
      ['Fire NOC', 'EXPIRED', -3],
      ['Pest control', 'EXPIRING', 0],
      ['Bar licence', 'EXPIRING', 25],
      ['FSSAI licence', 'VALID', 200],
    ]);
    // The reminders: the bar licence is inside 30 days, pest control is due today, the fire NOC has run out.
    expect(await complianceSweep(ctx.prisma, w.companyId)).toBe(3);
    expect(await complianceSweep(ctx.prisma, w.companyId)).toBe(0);
    const told = (
      await ctx.prisma.domainEvent.findMany({
        where: { companyId: w.companyId, name: 'compliance.expiring' },
      })
    ).map((e) => e.payload as { name: string; state: string });
    expect(told.map((t) => [t.name, t.state]).sort()).toEqual([
      ['Bar licence', 'runs out in 25 days'],
      ['Fire NOC', 'has run out'],
      ['Pest control', 'runs out today'],
    ]);
    // Renewing a licence needs its new last day; a duty done every 30 days moves on by itself.
    expect((await b.r.steward.api.post(`/api/compliance/${liquor.id}/renew`, {})).status).toBe(400);
    await ok(
      b.r.steward.api.post(`/api/compliance/${liquor.id}/renew`, {
        expiresOn: addDays(today, 390),
        number: 'RJ/HBL/2027/031',
      }),
    );
    await ok(
      b.r.steward.api.post(`/api/compliance/${pest.id}/renew`, { note: 'Sprayed kitchen and stores' }),
    );
    const after = await list();
    expect(after.counts).toEqual({ valid: 3, expiring: 0, expired: 1 });
    const done = after.items.find((i) => i.id === pest.id)!;
    expect(done).toMatchObject({ expiresOn: addDays(today, 30), state: 'VALID' });
    expect(done.history).toMatchObject([{ next: addDays(today, 30) }]);
    // A renewed licence is reminded again when its new day nears — not now.
    expect(await complianceSweep(ctx.prisma, w.companyId)).toBe(0);
    expect((await b.r.steward.api.del(`/api/compliance/${fssai.id}`)).status).toBe(403);
    await ok(b.r.manager.api.del(`/api/compliance/${fssai.id}`));
    expect((await list()).items).toHaveLength(3);
  });

  it('B19: HACCP temperature logs — a reading outside its limits needs what was done, and the managers are told', async () => {
    const w = await world(ctx.app);
    const b = await bar(w);
    const point = (body: object) =>
      ok<{ id: string }>(b.r.manager.api.post('/api/compliance/temps', { branchId: b.branchId, ...body }));
    const chiller = await point({ name: 'Walk-in chiller', min: 0, max: 5 });
    const hot = await point({ name: 'Hot holding', min: 63 });
    expect(
      (await b.r.steward.api.post('/api/compliance/temps', { branchId: b.branchId, name: 'X' })).status,
    ).toBe(403);
    const log = (id: string, body: object) =>
      b.r.steward.api.post(`/api/compliance/temps/${id}/readings`, body);
    expect(await ok(log(chiller.id, { value: 3.5 }))).toMatchObject({ ok: true });
    expect(msg(await log(chiller.id, { value: 8 }))).toBe(
      '8°C is outside the limits — write what was done about it',
    );
    expect(
      await ok(log(chiller.id, { value: 8, action: 'Door seal fixed, stock moved to chiller 2' })),
    ).toMatchObject({ ok: false });
    expect(await ok(log(hot.id, { value: 70 }))).toMatchObject({ ok: true });
    const alerts = (
      await ctx.prisma.domainEvent.findMany({
        where: { companyId: w.companyId, name: 'compliance.out_of_range' },
      })
    ).map((e) => e.payload as Record<string, unknown>);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      point: 'Walk-in chiller',
      value: '8°C',
      limits: '0 to 5°C',
      action: 'Door seal fixed, stock moved to chiller 2',
    });
    type Board = {
      points: {
        name: string;
        outOfRange: number;
        last: { value: number; ok: boolean } | null;
        readings: unknown[];
      }[];
    };
    const board = await ok<Board>(b.r.steward.api.get(`/api/compliance/temps?branchId=${b.branchId}`));
    expect(board.points.map((p) => [p.name, p.outOfRange, p.last?.value, p.readings.length])).toEqual([
      ['Hot holding', 0, 70, 1],
      ['Walk-in chiller', 1, 8, 2],
    ]);
  });
});
