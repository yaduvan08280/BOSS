import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { at } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { add, ok, open, order, post, restaurant } from './pos-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Floor = {
  floors: { tables: { name: string; state: string; order: { number: number } | null }[] }[];
  others: { type: string }[];
};
type Kds = {
  tickets: {
    id: string;
    number: number;
    status: string;
    station: string | null;
    tone: string;
    order: { table: string } | null;
    items: { id: string; name: string; status: string; mods: string[] }[];
  }[];
  allDay: { name: string; qty: number }[];
};

describe('POS: orders, kitchen tickets, kitchen display, voids, table operations (phase 15)', () => {
  it('P1–P6, P33, P39: an order with variants, add-ons, notes, courses and seats; held and fired; one numbered ticket a station', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // P2: a table order needs its table; a table has one running order; a retried request makes it once.
    expect((await s.post('/api/pos/orders', { outletId: r.outlet })).status).toBe(400);
    const o = await open(s, r, 'T1', { clientId: 'device-1-order-0001' });
    expect((await s.post('/api/pos/orders', { outletId: r.outlet, tableIds: [r.t.T1] })).status).toBe(409);
    expect(await open(s, r, 'T1', { clientId: 'device-1-order-0001' })).toMatchObject({
      id: o.id,
      again: true,
    });
    // P3: a size must be chosen; an add-on must be one the item offers.
    expect(
      (await s.post(`/api/pos/orders/${o.id}/items`, { items: [{ menuItemId: r.m.tikka }] })).status,
    ).toBe(400);
    expect(
      (
        await s.post(`/api/pos/orders/${o.id}/items`, {
          items: [{ menuItemId: r.m.dal, modifiers: [{ groupId: r.m.addOns, key: 'cheese' }] }],
        })
      ).status,
    ).toBe(400);
    // P4, P5: the starter and drinks are fired, the main is held; each station gets its own numbered ticket.
    const lines = [
      {
        menuItemId: r.m.tikka,
        variantKey: 'full',
        modifiers: [{ groupId: r.m.addOns, key: 'cheese' }],
        note: 'Less spicy',
        course: 'STARTER',
        seat: 1,
        clientId: 'device-1-line-0001',
      },
      { menuItemId: r.m.dal, course: 'MAIN', seat: 2, hold: true, clientId: 'device-1-line-0002' },
      { menuItemId: r.m.cola, qty: 2, course: 'DRINK', clientId: 'device-1-line-0003' },
    ];
    const fired = await add(s, o.id, lines);
    expect(fired.kots.map((k) => [k.number, k.stationId, k.items])).toEqual([
      [1, r.stations.kitchen, 1],
      [2, r.stations.bar, 1],
    ]);
    // P33: the same lines sent again by a queue that retried are not added twice.
    expect(await add(s, o.id, lines)).toMatchObject({ added: 0, skipped: 3, kots: [] });
    const now = await order(s, o.id);
    expect(now.items.map((i) => [i.name, i.variantName, i.price, i.status, i.course, i.seat])).toEqual([
      ['Paneer tikka', 'Full', 360_00, 'FIRED', 'STARTER', 1],
      ['Dal makhani', null, 280_00, 'HELD', 'MAIN', 2],
      ['Cola', null, 80_00, 'FIRED', 'DRINK', null],
    ]);
    expect([now.total, now.items[0]!.modifiers]).toEqual([
      360_00 + 280_00 + 160_00,
      [{ name: 'Extra cheese', price: 40_00 }],
    ]);
    // P6: the bar's ticket went to its printer; the kitchen has none and shows it on the display only.
    const jobs = await ctx.prisma.printJob.findMany({ where: { companyId: w.companyId } });
    expect(jobs.map((j) => [j.kind, j.refId])).toEqual([['KOT', fired.kots[1]!.id]]);
    expect(Buffer.from(jobs[0]!.payload, 'base64').toString('latin1')).toContain('2 x Cola');
    // The held course is fired later: the next ticket number of the day.
    expect(
      (
        await post<{ kots: { number: number }[] }>(s, `/api/pos/orders/${o.id}/fire`, { course: 'MAIN' })
      ).kots.map((k) => k.number),
    ).toEqual([3]);
    expect((await s.post(`/api/pos/orders/${o.id}/fire`, {})).status).toBe(409);

    // P1: the floor shows each table's state; orders without a table are listed beside it.
    await post(s, '/api/pos/orders', { outletId: r.outlet, type: 'TAKEAWAY', guestName: 'Anil' });
    expect((await s.post('/api/pos/orders', { outletId: r.outlet, type: 'ROOM_SERVICE' })).status).toBe(400);
    const seated = await open(s, r, 'T2');
    const floor = await ok<Floor>(s.get(`/api/pos/outlets/${r.outlet}/floor`));
    expect(floor.floors[0]!.tables.map((t) => [t.name, t.state]).slice(0, 3)).toEqual([
      ['T1', 'ORDERED'],
      ['T2', 'SEATED'],
      ['T3', 'FREE'],
    ]);
    expect(floor.others.map((x) => x.type)).toEqual(['TAKEAWAY']);
    // An item that is 86 or outside its hours can't be ordered.
    await ok(s.post(`/api/hosp/menu/items/${r.m.kulfi}/86`, { off: true, reason: 'Finished' }));
    const out = await s.post(`/api/pos/orders/${seated.id}/items`, { items: [{ menuItemId: r.m.kulfi }] });
    expect([out.status, out.body.error.message]).toEqual([409, 'Kulfi is out (Finished)']);
    // An order with nothing fired is simply cancelled; one with fired items is not.
    expect((await ok<{ status: string }>(s.post(`/api/pos/orders/${seated.id}/cancel`))).status).toBe(
      'CANCELLED',
    );
    expect((await s.post(`/api/pos/orders/${o.id}/cancel`)).status).not.toBe(200);
    // P39: a steward of another branch can't reach this outlet.
    const far = await r.g.at('Leela Lake', r.g.b.lake.id, 'HOD');
    await ok(w.api.patch(`/api/org/roles/${w.role('HOD')}`, { reach: 'branches' }));
    expect((await far.api.post('/api/pos/orders', { outletId: r.outlet, tableIds: [r.t.T3] })).status).toBe(
      404,
    );
    expect((await far.api.get(`/api/pos/outlets/${r.outlet}/floor`)).status).toBe(404);
  });

  it('P8–P10: the kitchen display — tickets per station, ready, bump, recall, all-day counts, the expo view', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const o1 = await open(s, r, 'T1');
    await add(s, o1.id, [
      { menuItemId: r.m.naan, qty: 4 },
      { menuItemId: r.m.dal },
      { menuItemId: r.m.cola },
    ]);
    const o2 = await open(s, r, 'T2');
    await add(s, o2.id, [{ menuItemId: r.m.naan, qty: 2 }]);
    const kds = (q = '') => ok<Kds>(s.get(`/api/pos/outlets/${r.outlet}/kds${q}`));
    const kitchen = await kds(`?stationId=${r.stations.kitchen}`);
    expect(kitchen.tickets.map((t) => [t.number, t.order?.table, t.station, t.tone, t.items.length])).toEqual(
      [
        [1, 'T1', 'Kitchen', 'ok', 2],
        [3, 'T2', 'Kitchen', 'ok', 1],
      ],
    );
    // "All day": six naan still to make across the tickets.
    expect(kitchen.allDay).toEqual([
      { name: 'Butter naan', qty: 6 },
      { name: 'Dal makhani', qty: 1 },
    ]);
    // The expo view shows every station together.
    expect((await kds()).tickets.map((t) => t.number)).toEqual([1, 2, 3]);
    // One item ready, then the other: the ticket is ready by itself.
    const [naan, dal] = kitchen.tickets[0]!.items;
    await ok(s.post(`/api/pos/items/${naan!.id}/ready`, { ready: true }));
    expect((await kds(`?stationId=${r.stations.kitchen}`)).tickets[0]!.status).toBe('NEW');
    await ok(s.post(`/api/pos/items/${dal!.id}/ready`, { ready: true }));
    expect((await kds(`?stationId=${r.stations.kitchen}`)).tickets[0]!.status).toBe('READY');
    expect((await kds(`?stationId=${r.stations.kitchen}`)).allDay).toEqual([{ name: 'Butter naan', qty: 2 }]);
    // Bumped off the display, then recalled: it is back, and its items are to be made again.
    await ok(s.post(`/api/pos/kots/${kitchen.tickets[0]!.id}/bump`));
    expect((await kds(`?stationId=${r.stations.kitchen}`)).tickets.map((t) => t.number)).toEqual([3]);
    expect((await kds('?show=bumped')).tickets.map((t) => t.number)).toEqual([1]);
    await ok(s.post(`/api/pos/kots/${kitchen.tickets[0]!.id}/recall`));
    const back = await kds(`?stationId=${r.stations.kitchen}`);
    expect([back.tickets[0]!.status, back.tickets[0]!.items.map((i) => i.status)]).toEqual([
      'NEW',
      ['FIRED', 'FIRED'],
    ]);
    // A ticket can be bumped in one go.
    await ok(s.post(`/api/pos/kots/${back.tickets[1]!.id}/bump`));
    expect((await order(s, o2.id)).items[0]!.status).toBe('READY');
  });

  it('P7: voids — nothing asked before firing; a reason after; above the limit an approval; a cooked dish is written off; the void report', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const o = await open(s, r, 'T1');
    await add(s, o.id, [
      { menuItemId: r.m.tikka, variantKey: 'full' },
      { menuItemId: r.m.naan },
      { menuItemId: r.m.cola, qty: 2 },
      { menuItemId: r.m.dal, hold: true },
    ]);
    const items = (await order(s, o.id)).items;
    const [tikka, naan, cola, dal] = items.map((i) => i.id);
    const voidIt = (api: typeof s, itemId: string, body: object = {}) =>
      api.post(`/api/pos/orders/${o.id}/items/${itemId}/void`, body);
    // Never sent to the kitchen: simply taken off.
    expect((await voidIt(s, dal!)).body).toMatchObject({ status: 'VOID', pending: false });
    // Fired: a reason is needed. ₹60 is within the steward's ₹100; not cooked yet, so no stock is touched.
    expect((await voidIt(s, naan!)).status).toBe(400);
    expect((await voidIt(s, naan!, { reason: 'Guest changed their mind' })).body).toMatchObject({
      status: 'VOID',
      pending: false,
    });
    // ₹160 of cola is above the steward's limit: it waits for an approver — who is not the steward.
    const asked = (await voidIt(s, cola!, { reason: 'Wrong table' })).body as {
      pending: boolean;
      approvalId: string;
    };
    expect(asked.pending).toBe(true);
    expect((await order(s, o.id)).items.find((i) => i.id === cola)).toMatchObject({
      status: 'FIRED',
      voidAsked: true,
    });
    // A bill can't be made while a void waits.
    expect((await s.post(`/api/pos/orders/${o.id}/check`, {})).status).toBe(409);
    expect((await s.post(`/api/pos/approvals/${asked.approvalId}/decide`, { approve: true })).status).toBe(
      403,
    );
    type Approval = { id: string; kind: string; canDecide: boolean; askedBy: string };
    expect(await ok<Approval[]>(r.manager.api.get(`/api/pos/outlets/${r.outlet}/approvals`))).toMatchObject([
      { kind: 'VOID', canDecide: true, askedBy: 'Ravi Steward' },
    ]);
    await ok(r.manager.api.post(`/api/pos/approvals/${asked.approvalId}/decide`, { approve: true }));
    expect((await order(s, o.id)).items.find((i) => i.id === cola)!.status).toBe('VOID');
    // The bar's ticket had only the cola: it is cancelled. The kitchen's still has the tikka.
    const kots = await ctx.prisma.kot.findMany({ where: { orderId: o.id }, orderBy: { number: 'asc' } });
    expect(kots.map((k) => k.status)).toEqual(['NEW', 'CANCELLED']);
    // A dish cooked and then cancelled: its paneer is gone — written off as a returned dish.
    await ok(voidIt(r.manager.api, tikka!, { reason: 'Guest left', cooked: true }));
    expect(await at(ctx.prisma, r.stock.paneer, r.kitchenLoc)).toBe(4800);
    expect(
      await ctx.prisma.stockMove.findFirstOrThrow({ where: { itemId: r.stock.paneer, refType: 'wastage' } }),
    ).toMatchObject({ reason: 'RETURNED_DISH', type: 'ADJUST' });
    // The cola was not cooked: its stock is untouched.
    expect(await at(ctx.prisma, r.stock.cola, r.kitchenLoc)).toBe(48);
    const report = await ok<{
      count: number;
      value: number;
      rows: { name: string; reason: string; cooked: boolean; by: string }[];
    }>(s.get(`/api/pos/outlets/${r.outlet}/voids`));
    expect([report.count, report.value]).toEqual([3, 60_00 + 160_00 + 320_00]);
    expect(report.rows.map((x) => [x.name, x.cooked, x.by])).toEqual([
      ['Paneer tikka', true, 'Meera Manager'],
      ['Butter naan', false, 'Ravi Steward'],
      ['Cola', false, 'Meera Manager'],
    ]);
    // A rejected void leaves the item as it was.
    await add(s, o.id, [{ menuItemId: r.m.cola, qty: 2 }]);
    const again = (await order(s, o.id)).items.at(-1)!;
    const ask2 = (await voidIt(s, again.id, { reason: 'Changed mind' })).body as { approvalId: string };
    await ok(
      r.manager.api.post(`/api/pos/approvals/${ask2.approvalId}/decide`, {
        approve: false,
        note: 'Already poured',
      }),
    );
    expect((await order(s, o.id)).items.at(-1)).toMatchObject({ status: 'FIRED', voidAsked: false });
  });

  it('P11–P14: move a table, merge two, send items to another table, change the steward', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const a = await open(s, r, 'T1');
    await add(s, a.id, [{ menuItemId: r.m.naan, qty: 2 }, { menuItemId: r.m.dal }]);
    const b = await open(s, r, 'T2');
    await add(s, b.id, [{ menuItemId: r.m.cola }]);
    const op = (id: string, body: object) => s.post(`/api/pos/orders/${id}/table`, body);
    // P11: T1 moves to T3; a table that is taken is refused.
    expect((await op(a.id, { op: 'MOVE', tableIds: [r.t.T2] })).status).toBe(409);
    await ok(op(a.id, { op: 'MOVE', tableIds: [r.t.T3] }));
    expect((await order(s, a.id)).tableIds).toEqual([r.t.T3]);
    // P12: T2's order joins it — one order over both tables, with every item and ticket.
    await ok(op(a.id, { op: 'MERGE', fromOrderId: b.id }));
    const joined = await order(s, a.id);
    expect([joined.tableIds.sort(), joined.items.map((i) => i.name)]).toEqual([
      [r.t.T2, r.t.T3].sort(),
      ['Butter naan', 'Dal makhani', 'Cola'],
    ]);
    expect((await order(s, b.id)).status).toBe('CANCELLED');
    expect(await ctx.prisma.kot.count({ where: { orderId: a.id } })).toBe(2);
    // P13: the cola goes to T5 — a new order there.
    const cola = joined.items.find((i) => i.name === 'Cola')!;
    const moved = await ok<{ toOrderId: string }>(
      op(a.id, { op: 'TRANSFER', itemIds: [cola.id], toTableId: r.t.T5 }),
    );
    expect([
      (await order(s, a.id)).items.length,
      (await order(s, moved.toOrderId)).items.map((i) => i.name),
      (await order(s, moved.toOrderId)).tableIds,
    ]).toEqual([2, ['Cola'], [r.t.T5]]);
    // P14: another steward takes the table over.
    await ok(op(a.id, { op: 'STEWARD', stewardId: r.steward2.id }));
    expect((await order(s, a.id)).stewardId).toBe(r.steward2.id);
    expect((await op(a.id, { op: 'STEWARD', stewardId: 'nobody' })).status).toBe(404);
  });
});
