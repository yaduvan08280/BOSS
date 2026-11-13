import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { group, ok } from '../branches/testkit';
import { entry, item, loc } from '../ims/stock-kit';
import { world } from '../records/testkit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type World = Awaited<ReturnType<typeof world>>;
const post = <T = { id: string }>(w: { api: World['api'] }, url: string, body: object) =>
  ok<T>(w.api.post(url, body));
type Live = {
  categories: {
    name: string;
    stationId: string | null;
    items: {
      id: string;
      name: string;
      price: number;
      label: string | null;
      available: boolean;
      out: 'off' | 'stock' | null;
      outReason: string | null;
      diet: string;
      variants: { key: string; name: string; price: number; out: boolean }[];
      modifierGroups: { name: string; options: { name: string; price: number }[] }[];
      combo: { menuItemId: string; qty: number }[];
    }[];
  }[];
};
/** A UTC instant for a wall-clock time in India on Tuesday 17/11/2026. */
const ist = (hhmm: string) => new Date(`2026-11-17T${hhmm}:00+05:30`).toISOString();

describe('the menu (phase 14)', () => {
  it('S12–S15: items linked to stock, variants, modifiers, combos, prices by outlet and time band, windows, 86 by hand and by stock', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    await ok(w.api.put('/api/hosp/settings', { enabled: true }));
    await ok(
      w.api.put('/api/money/tax-rates', { code: 'GST5', name: 'GST 5%', percent: 5, from: '2020-01-01' }),
    );
    const kitchen = await loc(w, g.b.rooftop.id, 'Rooftop kitchen', 'KITCHEN');
    const outlet = await post(w, '/api/hosp/outlets', {
      name: 'Rooftop',
      branchId: g.b.rooftop.id,
      locationId: kitchen,
    });
    const pool = await post(w, '/api/hosp/outlets', {
      name: 'Pool bar',
      kind: 'POOL_BAR',
      branchId: g.b.rooftop.id,
      locationId: kitchen,
    });
    const station = await post(w, '/api/hosp/stations', { outletId: outlet.id, name: 'Kitchen' });
    await ok(
      w.api.put('/api/hosp/routes', {
        outletId: outlet.id,
        routes: [{ category: '', stationId: station.id }],
      }),
    );
    // Stock: paneer in grams, a dish with a recipe, cheese for an add-on.
    const paneer = await item(w, { code: 'PAN', name: 'Paneer', unit: 'g' });
    const cheese = await item(w, { code: 'CHS', name: 'Cheese', unit: 'g' });
    const tikka = await item(
      w,
      { code: 'D-TIK', name: 'Paneer tikka (dish)', unit: 'plate' },
      { made: 'DISH' },
    );
    await ok(w.api.put('/api/ims/recipes', { itemId: tikka, lines: [{ itemId: paneer, qty: 200 }] }));
    await entry(w.api, { itemId: paneer, type: 'IN', qty: 250, ratePaise: 40, locationId: kitchen });

    const starters = await post(w, '/api/hosp/menu/categories', { name: 'Starters', nameHi: 'स्टार्टर' });
    const breakfast = await post(w, '/api/hosp/menu/categories', { name: 'Breakfast', sort: 1 });
    expect((await w.api.post('/api/hosp/menu/categories', { name: 'starters' })).status).toBe(409);
    // S13: a modifier group; an option with a stock effect needs its quantity.
    const group1 = {
      name: 'Add-ons',
      min: 0,
      max: 2,
      options: [
        { key: 'cheese', name: 'Extra cheese', price: 40_00, itemId: cheese, qty: 20 },
        { key: 'spicy', name: 'Make it spicy' },
      ],
    };
    expect(
      (
        await w.api.post('/api/hosp/menu/groups', {
          ...group1,
          options: [{ key: 'c', name: 'Cheese', itemId: cheese }],
        })
      ).status,
    ).toBe(400);
    const addOns = await post(w, '/api/hosp/menu/groups', group1);
    // S12: an item with its stock dish, marks, allergens, Hindi name, HSN and a tax code that must exist.
    const base = {
      categoryId: starters.id,
      name: 'Paneer tikka',
      nameHi: 'पनीर टिक्का',
      itemId: tikka,
      diet: 'VEG',
      allergens: ['Milk'],
      spice: 2,
      hsn: '996331',
      taxCode: 'GST5',
      price: 320_00,
    };
    expect((await w.api.post('/api/hosp/menu/items', { ...base, taxCode: 'GST99' })).status).toBe(400);
    expect((await w.api.post('/api/hosp/menu/items', { ...base, itemId: 'no-such-item' })).status).toBe(400);
    const variants = [
      { key: 'half', name: 'Half', price: 180_00, factor: 0.5 },
      { key: 'full', name: 'Full', price: 320_00, factor: 1 },
    ];
    const menuTikka = await post(w, '/api/hosp/menu/items', {
      ...base,
      variants,
      modifierGroupIds: [addOns.id],
    });
    expect(
      (
        await w.api.post('/api/hosp/menu/items', {
          ...base,
          name: 'Twice',
          variants: [variants[0], variants[0]],
        })
      ).status,
    ).toBe(400);
    const poha = await post(w, '/api/hosp/menu/items', {
      categoryId: breakfast.id,
      name: 'Poha',
      price: 90_00,
      windows: [{ fromMin: 7 * 60, toMin: 10 * 60 + 30 }],
      outletIds: [outlet.id],
    });
    const tea = await post(w, '/api/hosp/menu/items', {
      categoryId: breakfast.id,
      name: 'Masala chai',
      price: 40_00,
    });
    // A combo sells menu items together; it can't hold itself, another combo, or variants of its own.
    const combo = await post(w, '/api/hosp/menu/items', {
      categoryId: breakfast.id,
      name: 'Breakfast combo',
      price: 110_00,
      combo: [{ menuItemId: poha.id }, { menuItemId: tea.id }],
    });
    expect(
      (
        await w.api.post('/api/hosp/menu/items', {
          categoryId: breakfast.id,
          name: 'Combo of combos',
          price: 1,
          combo: [{ menuItemId: combo.id }],
        })
      ).status,
    ).toBe(400);
    expect((await w.api.del(`/api/hosp/menu/items/${tea.id}`)).status).toBe(409);

    // S14: a price for the pool bar, and a happy hour everywhere, for one variant.
    await ok(
      w.api.put(`/api/hosp/menu/items/${menuTikka.id}/prices`, {
        prices: [
          { variantKey: 'full', outletId: pool.id, price: 380_00 },
          {
            variantKey: 'full',
            label: 'Happy hour',
            window: { fromMin: 17 * 60, toMin: 19 * 60 },
            price: 260_00,
          },
        ],
      }),
    );
    expect(
      (
        await w.api.put(`/api/hosp/menu/items/${menuTikka.id}/prices`, {
          prices: [{ variantKey: 'jumbo', price: 1 }],
        })
      ).status,
    ).toBe(400);
    const live = async (outletId: string, at: string) => {
      const m = await ok<Live>(w.api.get(`/api/hosp/outlets/${outletId}/menu?at=${encodeURIComponent(at)}`));
      return { m, find: (name: string) => m.categories.flatMap((c) => c.items).find((i) => i.name === name) };
    };
    const noon = await live(outlet.id, ist('12:00'));
    const full = (l: Awaited<ReturnType<typeof live>>) =>
      l.find('Paneer tikka')!.variants.find((v) => v.key === 'full')!.price;
    expect([
      full(noon),
      full(await live(pool.id, ist('12:00'))),
      full(await live(outlet.id, ist('18:00'))),
      full(await live(pool.id, ist('18:00'))),
    ]).toEqual([320_00, 380_00, 260_00, 260_00]);
    expect(noon.m.categories.map((c) => [c.name, c.stationId])).toEqual([
      ['Starters', station.id],
      ['Breakfast', station.id],
    ]);
    expect(noon.find('Paneer tikka')).toMatchObject({
      diet: 'VEG',
      modifierGroups: [
        {
          name: 'Add-ons',
          options: [
            { name: 'Extra cheese', price: 40_00 },
            { name: 'Make it spicy', price: 0 },
          ],
        },
      ],
    });
    // Breakfast is on at 08:00 and off at noon; an item of one outlet is not on another's menu.
    expect([
      (await live(outlet.id, ist('08:00'))).find('Poha')!.available,
      noon.find('Poha')!.available,
      (await live(pool.id, ist('08:00'))).find('Poha'),
    ]).toEqual([true, false, undefined]);

    // S15: 250 g of paneer makes a full plate (200 g) — nothing is 86. After 100 g is used only a half can be made.
    expect(noon.find('Paneer tikka')).toMatchObject({
      out: null,
      variants: [
        { key: 'half', out: false },
        { key: 'full', out: false },
      ],
    });
    await entry(w.api, { itemId: paneer, type: 'OUT', qty: 100, locationId: kitchen });
    expect((await live(outlet.id, ist('12:00'))).find('Paneer tikka')).toMatchObject({
      out: null,
      variants: [
        { key: 'half', out: false },
        { key: 'full', out: true },
      ],
    });
    await entry(w.api, { itemId: paneer, type: 'OUT', qty: 100, locationId: kitchen });
    expect((await live(outlet.id, ist('12:00'))).find('Paneer tikka')).toMatchObject({
      out: 'stock',
      outReason: 'Paneer',
    });
    // By hand: the kitchen switches an item off with a reason, and on again.
    const steward = await w.person('Asha Steward');
    await ok(steward.api.post(`/api/hosp/menu/items/${tea.id}/86`, { off: true, reason: 'Milk finished' }));
    expect((await live(outlet.id, ist('12:00'))).find('Masala chai')).toMatchObject({
      out: 'off',
      outReason: 'Milk finished',
    });
    await ok(steward.api.post(`/api/hosp/menu/items/${tea.id}/86`, { off: false }));
    expect((await live(outlet.id, ist('12:00'))).find('Masala chai')!.out).toBeNull();
    // A steward can 86 an item but not change the menu.
    expect((await steward.api.post('/api/hosp/menu/categories', { name: 'Mine' })).status).toBe(403);
  });

  it('S16: an outlet with 3 stations, a floor of 20 tables, 40 rooms of 4 types and a menu of 120 items with variants and modifiers', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    await ok(w.api.put('/api/hosp/settings', { enabled: true }));
    const outlet = await post(w, '/api/hosp/outlets', {
      name: 'The Courtyard',
      branchId: g.b.rooftop.id,
      charges: { serviceChargePct: 5 },
    });
    for (const [name, kind] of [
      ['Kitchen', 'KITCHEN'],
      ['Tandoor', 'TANDOOR'],
      ['Bar', 'BAR'],
    ])
      await post(w, '/api/hosp/stations', { outletId: outlet.id, name, kind });
    const floor = await post(w, '/api/hosp/floors', { outletId: outlet.id, name: 'Courtyard' });
    await post(w, '/api/hosp/tables/bulk', { floorId: floor.id, count: 20 });
    for (const [i, [name, code]] of [
      ['Standard', 'STD'],
      ['Deluxe', 'DLX'],
      ['Suite', 'STE'],
      ['Family', 'FAM'],
    ].entries()) {
      const type = await post(w, '/api/hosp/room-types', {
        branchId: g.b.rooftop.id,
        name,
        code,
        tariff: (3000 + i * 1500) * 100,
      });
      await post(w, '/api/hosp/rooms/bulk', {
        typeId: type.id,
        from: (i + 1) * 100 + 1,
        to: (i + 1) * 100 + 10,
        floor: String(i + 1),
      });
    }
    // A pasted menu of 120 lines: every third item has two variants.
    const cats = ['Soups', 'Starters', 'Mains', 'Breads', 'Desserts', 'Drinks'];
    const lines = Array.from(
      { length: 120 },
      (_, i) =>
        `${cats[i % 6]}, Dish ${i + 1}, ${100 + i}, ${i % 4 === 0 ? 'non-veg' : 'veg'}${i % 3 === 0 ? `, Half=${60 + i}|Full=${100 + i}` : ''}`,
    );
    // One bad line refuses the whole paste and says which.
    const bad = await w.api.post('/api/hosp/menu/import', {
      text: [...lines, 'Mains, Broken, x'].join('\n'),
    });
    expect([bad.status, bad.body.error.details.problems]).toEqual([
      400,
      [{ line: 121, message: '"x" is not a price' }],
    ]);
    expect(await ctx.prisma.menuItem.count({ where: { companyId: w.companyId } })).toBe(0);
    expect(
      await post<{ items: number; categories: number }>(w, '/api/hosp/menu/import', {
        text: lines.join('\n'),
      }),
    ).toEqual({ items: 120, categories: 6 });
    expect((await w.api.post('/api/hosp/menu/import', { text: lines[0]! })).status).toBe(400);
    // Modifiers are added to the items that take them.
    type Setup = {
      categories: { name: string; items: number }[];
      items: {
        id: string;
        name: string;
        categoryId: string;
        price: number;
        diet: string;
        variants: { key: string; price: number }[];
      }[];
    };
    const setup = await ok<Setup>(w.api.get('/api/hosp/menu'));
    const addOns = await post(w, '/api/hosp/menu/groups', {
      name: 'Add-ons',
      max: 2,
      options: [{ key: 'butter', name: 'Extra butter', price: 20_00 }],
    });
    const dish1 = setup.items.find((i) => i.name === 'Dish 1')!;
    await ok(
      w.api.put(`/api/hosp/menu/items/${dish1.id}`, {
        categoryId: dish1.categoryId,
        name: dish1.name,
        price: dish1.price,
        diet: dish1.diet,
        variants: dish1.variants,
        modifierGroupIds: [addOns.id],
      }),
    );

    const outlets = await ok<
      { name: string; stations: unknown[]; tables: number; charges: { serviceChargePct: number } }[]
    >(w.api.get('/api/hosp/outlets'));
    expect(outlets).toMatchObject([{ name: 'The Courtyard', tables: 20, charges: { serviceChargePct: 5 } }]);
    expect(outlets[0]!.stations).toHaveLength(3);
    const rooms = await ok<{ types: { rooms: number }[]; rooms: unknown[] }>(w.api.get('/api/hosp/rooms'));
    expect([rooms.types.map((t) => t.rooms), rooms.rooms.length]).toEqual([[10, 10, 10, 10], 40]);
    expect(setup.categories.map((c) => c.items)).toEqual([20, 20, 20, 20, 20, 20]);
    expect([
      setup.items.length,
      setup.items.filter((i) => i.variants.length === 2).length,
      dish1.variants.map((v) => v.price),
    ]).toEqual([120, 40, [60_00, 100_00]]);
    // The outlet's live menu carries all of it.
    const live = await ok<{ categories: { items: { name: string; modifierGroups: unknown[] }[] }[] }>(
      w.api.get(`/api/hosp/outlets/${outlet.id}/menu`),
    );
    const all = live.categories.flatMap((c) => c.items);
    expect([all.length, all.find((i) => i.name === 'Dish 1')!.modifierGroups.length]).toEqual([120, 1]);
  });
});
