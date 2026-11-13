import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { group, ok } from '../branches/testkit';
import { loc } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { stationFor } from './outlets';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type World = Awaited<ReturnType<typeof world>>;
const post = <T = { id: string }>(w: { api: World['api'] }, url: string, body: object) =>
  ok<T>(w.api.post(url, body));
type Outlet = {
  id: string;
  name: string;
  branch: string;
  stations: { id: string; name: string }[];
  routes: { category: string; stationId: string }[];
  tables: number;
  charges: { serviceChargePct: number };
};

describe('hospitality set-up (phase 14)', () => {
  it('S1, S2, S3, S7, S8: the module switch; outlets with stations, charges, printers and ticket routing; only a branch’s own', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    // S1: off until the company switches it on; the menu follows.
    expect(
      (await ok<{ company: { hospitality: boolean } }>(w.api.get('/api/auth/me'))).company.hospitality,
    ).toBe(false);
    const member = await w.person('Asha Steward');
    expect((await member.api.put('/api/hosp/settings', { enabled: true })).status).toBe(403);
    await ok(w.api.put('/api/hosp/settings', { enabled: true }));
    expect(
      (await ok<{ company: { hospitality: boolean } }>(member.api.get('/api/auth/me'))).company.hospitality,
    ).toBe(true);

    // S2: an outlet belongs to a branch, takes stock from one of that branch's locations, and has its charges.
    const bar = await loc(w, g.b.rooftop.id, 'Rooftop bar', 'BAR');
    const far = await loc(w, g.b.lake.id, 'Lake store');
    await ok(
      w.api.put('/api/money/tax-rates', { code: 'GST5', name: 'GST 5%', percent: 5, from: '2020-01-01' }),
    );
    const body = {
      name: 'Sky Lounge',
      kind: 'BAR',
      branchId: g.b.rooftop.id,
      locationId: bar,
      openMin: 17 * 60,
      closeMin: 60,
      charges: { serviceChargePct: 5, packagingPaise: 20_00, chargeTaxCode: 'GST5' },
    };
    expect((await w.api.post('/api/hosp/outlets', { ...body, locationId: far })).status).toBe(400);
    // S7: a charge's tax code must be one the accountant typed — nothing is built in.
    expect(
      (await w.api.post('/api/hosp/outlets', { ...body, charges: { chargeTaxCode: 'GST18' } })).status,
    ).toBe(400);
    const sky = await post(w, '/api/hosp/outlets', body);
    expect((await w.api.post('/api/hosp/outlets', body)).status).toBe(409);
    const cafe = await post(w, '/api/hosp/outlets', {
      name: 'Lake Café',
      kind: 'CAFE',
      branchId: g.b.lake.id,
    });

    // S3, S8: stations, a printer, and which category's tickets go where.
    const printer = await post(w, '/api/hosp/printers', {
      name: 'Bar KOT',
      kind: 'KOT',
      address: '192.168.1.50:9100',
      branchId: g.b.rooftop.id,
    });
    expect((await w.api.post('/api/hosp/printers', { name: 'Bad', address: 'not a printer!' })).status).toBe(
      400,
    );
    const kitchen = await post(w, '/api/hosp/stations', {
      outletId: sky.id,
      name: 'Kitchen',
      kind: 'KITCHEN',
    });
    const tandoor = await post(w, '/api/hosp/stations', {
      outletId: sky.id,
      name: 'Tandoor',
      kind: 'TANDOOR',
    });
    const barStation = await post(w, '/api/hosp/stations', {
      outletId: sky.id,
      name: 'Bar',
      kind: 'BAR',
      printerId: printer.id,
    });
    const other = await post(w, '/api/hosp/stations', { outletId: cafe.id, name: 'Counter' });
    // With no routes, tickets go to the outlet's first station.
    expect(await stationFor(ctx.prisma, w.companyId, sky.id, 'Drinks')).toBe(kitchen.id);
    const routes = [
      { category: '', stationId: kitchen.id },
      { category: 'Drinks', stationId: barStation.id },
      { category: 'Tandoor', stationId: tandoor.id },
    ];
    expect(
      (
        await w.api.put('/api/hosp/routes', {
          outletId: sky.id,
          routes: [{ category: 'Drinks', stationId: other.id }],
        })
      ).status,
    ).toBe(400);
    await ok(w.api.put('/api/hosp/routes', { outletId: sky.id, routes }));
    expect([
      await stationFor(ctx.prisma, w.companyId, sky.id, 'drinks'),
      await stationFor(ctx.prisma, w.companyId, sky.id, 'Soups'),
    ]).toEqual([barStation.id, kitchen.id]);
    // A deleted station's tickets fall back to the default.
    await ok(w.api.del(`/api/hosp/stations/${barStation.id}`));
    expect(await stationFor(ctx.prisma, w.companyId, sky.id, 'Drinks')).toBe(kitchen.id);

    const all = await ok<Outlet[]>(w.api.get('/api/hosp/outlets'));
    expect(all.map((o) => [o.name, o.branch, o.stations.length])).toEqual([
      ['Lake Café', 'Lake View Ajmer', 1],
      ['Sky Lounge', 'Rooftop Jaipur', 2],
    ]);
    expect(all[1]!.charges).toMatchObject({ serviceChargePct: 5, packagingPaise: 20_00, roundTo: 1 });
    // An outlet manager limited to their branch sees and changes only that branch's outlets.
    const hod = await ctx.prisma.role.findUniqueOrThrow({ where: { id: w.role('HOD') } });
    await ok(
      w.api.patch(`/api/org/roles/${hod.id}`, {
        permissions: [...new Set([...hod.permissions, 'hosp.admin'])],
        reach: 'branches',
      }),
    );
    const leela = await g.at('Leela Lake', g.b.lake.id, 'HOD');
    expect((await ok<Outlet[]>(leela.api.get('/api/hosp/outlets'))).map((o) => o.name)).toEqual([
      'Lake Café',
    ]);
    expect((await leela.api.put(`/api/hosp/outlets/${sky.id}`, body)).status).toBe(403);
    expect((await leela.api.post('/api/hosp/outlets', { ...body, name: 'Mine now' })).status).toBe(403);
    expect((await leela.api.get(`/api/hosp/outlets/${sky.id}/plan`)).status).toBe(404);
  });

  it('S4, S5, S6: a floor plan with tables (one by one, many at once, dragged); room types and rooms with connecting doors', async () => {
    const w = await world(ctx.app);
    const g = await group(w);
    const outlet = await post(w, '/api/hosp/outlets', { name: 'Dining hall', branchId: g.b.rooftop.id });
    const floor = await post(w, '/api/hosp/floors', { outletId: outlet.id, name: 'Ground floor' });
    const steward = await w.person('Ravi Steward');
    const vip = await post(w, '/api/hosp/tables', {
      floorId: floor.id,
      name: 'VIP',
      seats: 8,
      shape: 'ROUND',
      x: 20,
      y: 0,
      section: 'Window',
      combinable: true,
      stewardIds: [steward.id],
    });
    expect((await w.api.post('/api/hosp/tables', { floorId: floor.id, name: 'vip' })).status).toBe(409);
    expect(
      (await w.api.post('/api/hosp/tables', { floorId: floor.id, name: 'T9', stewardIds: ['nobody'] }))
        .status,
    ).toBe(400);
    // Many at once, set out on a grid after what is there.
    expect(
      await post<{ added: number }>(w, '/api/hosp/tables/bulk', {
        floorId: floor.id,
        count: 19,
        prefix: 'T',
        seats: 4,
      }),
    ).toEqual({ added: 19 });
    expect(
      (await w.api.post('/api/hosp/tables/bulk', { floorId: floor.id, count: 3, prefix: 'T', from: 18 }))
        .status,
    ).toBe(409);
    type Plan = {
      name: string;
      tables: {
        id: string;
        name: string;
        seats: number;
        x: number;
        y: number;
        shape: string;
        section: string | null;
        combinable: boolean;
        stewardIds: string[];
      }[];
    }[];
    const plan = async () => (await ok<Plan>(w.api.get(`/api/hosp/outlets/${outlet.id}/plan`)))[0]!.tables;
    const tables = await plan();
    expect(tables).toHaveLength(20);
    expect(tables.find((t) => t.name === 'VIP')).toMatchObject({
      seats: 8,
      shape: 'ROUND',
      section: 'Window',
      combinable: true,
      stewardIds: [steward.id],
    });
    expect(tables.find((t) => t.name === 'T1')).toMatchObject({ x: 4, y: 0 });
    // Dragging saves the new places.
    const t1 = tables.find((t) => t.name === 'T1')!;
    await ok(
      w.api.post('/api/hosp/tables/move', {
        moves: [
          { id: t1.id, x: 12, y: 30 },
          { id: vip.id, x: 0, y: 0 },
        ],
      }),
    );
    expect((await plan()).find((t) => t.id === t1.id)).toMatchObject({ x: 12, y: 30 });
    await ok(w.api.del(`/api/hosp/tables/${t1.id}`));
    expect(await plan()).toHaveLength(19);

    // S5: room types with occupancy, beds, amenities and the declared tariff.
    const type = (name: string, code: string, tariff: number) =>
      post(w, '/api/hosp/room-types', {
        branchId: g.b.lake.id,
        name,
        code,
        occupancy: 2,
        maxOccupancy: 3,
        beds: '1 king',
        amenities: ['AC', 'Lake view'],
        tariff,
      });
    const deluxe = await type('Deluxe', 'DLX', 4500_00);
    expect(
      (await w.api.post('/api/hosp/room-types', { branchId: g.b.lake.id, name: 'Other', code: 'dlx' }))
        .status,
    ).toBe(409);
    expect(
      (
        await w.api.post('/api/hosp/room-types', {
          branchId: g.b.lake.id,
          name: 'Odd',
          code: 'ODD',
          occupancy: 4,
          maxOccupancy: 2,
        })
      ).status,
    ).toBe(400);
    // S6: rooms by number, with a connecting door that both rooms know of.
    expect(
      await post<{ added: number }>(w, '/api/hosp/rooms/bulk', {
        typeId: deluxe.id,
        from: 101,
        to: 110,
        floor: '1',
      }),
    ).toEqual({ added: 10 });
    expect((await w.api.post('/api/hosp/rooms/bulk', { typeId: deluxe.id, from: 110, to: 112 })).status).toBe(
      409,
    );
    const r111 = await post(w, '/api/hosp/rooms', {
      typeId: deluxe.id,
      number: '111',
      floor: '1',
      features: ['Corner'],
      connectsTo: ['110'],
    });
    expect(
      (await w.api.post('/api/hosp/rooms', { typeId: deluxe.id, number: '112', connectsTo: ['999'] })).status,
    ).toBe(400);
    type Rooms = {
      types: { name: string; rooms: number; tariff: number }[];
      rooms: { number: string; connectsTo: string[]; features: string[] }[];
    };
    const rooms = await ok<Rooms>(w.api.get(`/api/hosp/rooms?branchId=${g.b.lake.id}`));
    expect(rooms.types).toMatchObject([{ name: 'Deluxe', rooms: 11, tariff: 4500_00 }]);
    expect(
      rooms.rooms.filter((r) => ['110', '111'].includes(r.number)).map((r) => [r.number, r.connectsTo]),
    ).toEqual([
      ['110', ['111']],
      ['111', ['110']],
    ]);
    // A type with rooms can't be deleted; a deleted room leaves its neighbour's door list.
    expect((await w.api.del(`/api/hosp/room-types/${deluxe.id}`)).status).toBe(409);
    await ok(w.api.del(`/api/hosp/rooms/${r111.id}`));
    expect(
      (await ok<Rooms>(w.api.get('/api/hosp/rooms'))).rooms.find((r) => r.number === '110')!.connectsTo,
    ).toEqual([]);
  });

  it('S9, S10, S11: payment modes that need a reference; discount types, limits per role, no-charge reasons; day-close rules', async () => {
    const w = await world(ctx.app);
    // S9: hospitality's ways of taking money, and which need a reference.
    for (const [name, kind, needsRef] of [
      ['Paytm wallet', 'WALLET', true],
      ['Room charge', 'ROOM', true],
      ['Company credit', 'COMPANY', false],
      ['Complimentary', 'COMPLIMENTARY', false],
    ] as const)
      await ok(w.api.post('/api/money/modes', { name, kind, needsRef }));
    expect((await w.api.post('/api/money/modes', { name: 'Barter', kind: 'BARTER' })).status).toBe(400);
    const modes = await ctx.prisma.paymentMode.findMany({
      where: { companyId: w.companyId },
      orderBy: { name: 'asc' },
    });
    expect(modes.map((m) => [m.kind, m.needsRef])).toEqual([
      ['COMPANY', false],
      ['COMPLIMENTARY', false],
      ['WALLET', true],
      ['ROOM', true],
    ]);

    // S10: discount types, what each role may give by itself, who approves above it, and why a bill may be no-charge.
    const manager = await w.person('Meera Manager', 'HOD');
    const rules = {
      discounts: [
        { key: 'staff', name: 'Staff 10%', kind: 'PERCENT', on: 'BILL', value: 10 },
        { key: 'open', name: 'Manager’s discount', kind: 'PERCENT', on: 'BILL' },
        { key: 'item_off', name: 'Item ₹ off', kind: 'AMOUNT', on: 'ITEM' },
      ],
      limits: [
        { roleId: w.role('MEMBER'), maxPct: 5 },
        { roleId: w.role('HOD'), maxPct: 20, maxPaise: 2000_00, nc: true },
      ],
      approverIds: [manager.id],
      ncReasons: ['Owner’s guest', 'Food critic'],
    };
    type Settings = {
      enabled: boolean;
      rules: typeof rules & {
        dayClose: { cutoffMin: number; closerIds: string[]; denominations: number[]; blindCash: boolean };
      };
    };
    const saved = await ok<Settings>(w.api.put('/api/hosp/settings', { rules }));
    expect(saved.rules).toMatchObject({
      approverIds: [manager.id],
      ncReasons: ['Owner’s guest', 'Food critic'],
    });
    expect(saved.rules.limits.map((l) => [l.maxPct, l.nc])).toEqual([
      [5, false],
      [20, true],
    ]);
    expect(
      (await w.api.put('/api/hosp/settings', { rules: { limits: [{ roleId: 'no-such-role', maxPct: 5 }] } }))
        .status,
    ).toBe(400);
    expect(
      (
        await w.api.put('/api/hosp/settings', {
          rules: { discounts: [rules.discounts[0], rules.discounts[0]] },
        })
      ).status,
    ).toBe(400);
    expect((await w.api.put('/api/hosp/settings', { rules: { approverIds: ['nobody'] } })).status).toBe(400);

    // S11: the business day's cut-off, who closes, the notes counted, a blind cash count. Only what is sent changes.
    const day = await ok<Settings>(
      w.api.put('/api/hosp/settings', {
        rules: { dayClose: { cutoffMin: 180, closerIds: [manager.id], blindCash: false } },
      }),
    );
    expect(day.rules.dayClose).toEqual({
      cutoffMin: 180,
      closerIds: [manager.id],
      denominations: [500, 200, 100, 50, 20, 10, 5, 2, 1],
      blindCash: false,
    });
    expect(day.rules.discounts).toHaveLength(3);
  });
});
