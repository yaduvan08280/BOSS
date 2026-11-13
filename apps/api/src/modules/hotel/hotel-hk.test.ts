import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { entry, item } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { ok, post, property } from './hotel-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Board = {
  counts: Record<'toClean' | 'toInspect' | 'vacantClean' | 'vacantDirty' | 'occupied' | 'outOfOrder', number>;
  rooms: {
    id: string;
    number: string;
    state: string;
    guest: string | null;
    tasks: {
      id: string;
      kind: string;
      status: string;
      assigneeId: string | null;
      checklist: { text: string; done: boolean }[];
    }[];
  }[];
};
const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;

describe('Hotel: housekeeping (phase 17)', { timeout: 60_000 }, () => {
  it('H41, H42, H43, H45, H46: the housekeeping board — statuses, assignments by floor, the checklist, inspection, linen from stock, turndown, lost & found', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    // Linen comes from the housekeeping store (the main store here).
    const towel = await item(w, { code: 'TWL', name: 'Bath towel' });
    await entry(w.api, { itemId: towel, type: 'IN', qty: 10, ratePaise: 200_00 });
    await ok(
      w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
        amenities: [{ itemId: towel, name: 'Bath towel', qty: 2 }],
        hkChecklist: ['Bed made', 'Bathroom cleaned'],
      }),
    );
    const a = await h.booked({ depart: h.d(2) });
    await ok(h.checkIn(a.id, '101'));
    await ctx.prisma.room.update({ where: { id: h.rooms['202']! }, data: { hkStatus: 'DIRTY' } });
    await h.audit();
    const board = () => ok<Board>(h.desk.get(`/api/hotel/housekeeping?branchId=${h.branchId}`));
    let bd = await board();
    const room = (n: string) => bd.rooms.find((r) => r.number === n)!;
    // The audit laid out today's cleaning: the occupied room and the dirty one.
    expect(bd.counts).toMatchObject({
      toClean: 2,
      occupied: 1,
      vacantDirty: 1,
      vacantClean: 4,
      outOfOrder: 0,
    });
    expect(room('101')).toMatchObject({ state: 'OCCUPIED_DIRTY', guest: expect.any(String) });
    expect(room('102')).toMatchObject({ state: 'VACANT_CLEAN', tasks: [] });
    expect(room('202')).toMatchObject({
      state: 'VACANT_DIRTY',
      tasks: [{ kind: 'CLEAN', status: 'OPEN' }],
    });
    // A supervisor gives floor 1 to an attendant; a desk person cannot.
    const assign = { branchId: h.branchId, assigneeId: h.r.steward2.id, floor: '1' };
    expect((await h.desk.post('/api/hotel/housekeeping/assign', assign)).status).toBe(403);
    expect(await ok(h.sup.post('/api/hotel/housekeeping/assign', assign))).toEqual({ assigned: 1 });
    bd = await board();
    const task = room('101').tasks[0]!;
    expect(task.assigneeId).toBe(h.r.steward2.id);
    // The attendant cannot mark it done until every line is ticked; then the room is clean and the towels are issued.
    const act = (body: object, api = h.r.steward2.api) =>
      api.post(`/api/hotel/housekeeping/tasks/${task.id}`, body);
    expect((await act({ action: 'done' })).status).toBe(409);
    await ok(act({ action: 'tick', index: 0 }));
    await ok(act({ action: 'tick', index: 1 }));
    expect(await ok(act({ action: 'done' }))).toMatchObject({ status: 'DONE' });
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['101']! } })).hkStatus).toBe(
      'CLEAN',
    );
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: towel } })).stock)).toBe(8);
    // Inspection is the supervisor's: sent back once (the room is dirty again), then passed.
    expect((await act({ action: 'inspect' })).status).toBe(403);
    expect(await ok(act({ action: 'redo', note: 'Dust on the desk' }, h.sup))).toMatchObject({
      status: 'OPEN',
    });
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['101']! } })).hkStatus).toBe(
      'DIRTY',
    );
    await ok(act({ action: 'tick', index: 0 }));
    await ok(act({ action: 'tick', index: 1 }));
    await ok(act({ action: 'done' }));
    expect(await ok(act({ action: 'inspect' }, h.sup))).toMatchObject({ status: 'INSPECTED' });
    bd = await board();
    expect(room('101').state).toBe('OCCUPIED');
    expect(bd.counts).toMatchObject({ toClean: 1, toInspect: 0 });
    // Turndown for the rooms with a guest tonight; planning twice makes nothing twice.
    expect(
      await ok(h.sup.post('/api/hotel/housekeeping/plan', { branchId: h.branchId, turndown: true })),
    ).toEqual({ cleaning: 0, turndown: 1 });
    expect(
      await ok(h.sup.post('/api/hotel/housekeeping/plan', { branchId: h.branchId, turndown: true })),
    ).toEqual({ cleaning: 0, turndown: 0 });
    expect(
      (await board()).rooms
        .find((r) => r.number === '101')!
        .tasks.map((t) => t.kind)
        .sort(),
    ).toEqual(['CLEAN', 'TURNDOWN']);
    // Lost & found: logged, returned with the name of who took it.
    const found = await post<{ id: string }>(h.desk, '/api/hotel/lost-found', {
      branchId: h.branchId,
      roomId: h.rooms['102'],
      item: 'Phone charger',
    });
    expect(
      (await h.desk.post(`/api/hotel/lost-found/${found.id}/close`, { status: 'RETURNED' })).status,
    ).toBe(400);
    await ok(
      h.desk.post(`/api/hotel/lost-found/${found.id}/close`, {
        status: 'RETURNED',
        returnedTo: 'Mr Rao, by courier',
      }),
    );
    expect(await ok(h.desk.get(`/api/hotel/lost-found?branchId=${h.branchId}`))).toMatchObject([
      {
        item: 'Phone charger',
        room: '102',
        status: 'RETURNED',
        returnedTo: 'Mr Rao, by courier',
        foundOn: h.d(1),
      },
    ]);
  });

  it('H44: the minibar check charges what was taken to the folio and takes it off the stock', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(
      w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
        minibar: [{ itemId: h.r.stock.cola, name: 'Cola', price: 150_00, taxCode: 'GST18' }],
        hkLocationId: h.r.kitchenLoc,
      }),
    );
    const minibar = (room: string, items: object[]) =>
      h.desk.post(`/api/hotel/rooms/${h.rooms[room]}/minibar`, { items });
    expect(msg(await minibar('101', [{ itemId: h.r.stock.cola, qty: 1 }]))).toBe(
      'Nobody is checked in to room 101',
    );
    const a = await h.booked({ depart: h.d(1) });
    await ok(h.checkIn(a.id, '101'));
    expect((await minibar('101', [{ itemId: h.r.stock.paneer, qty: 1 }])).status).toBe(400);
    await ok(minibar('101', [{ itemId: h.r.stock.cola, qty: 2 }]));
    const f = (await h.stay(a.id)).folios[0]!;
    expect(f.lines).toMatchObject([{ kind: 'MINIBAR', text: 'Minibar — Cola', qty: 2, amount: 300_00 }]);
    expect(f).toMatchObject({ charges: 300_00, tax: 54_00, total: 354_00 });
    expect(Number((await ctx.prisma.item.findUniqueOrThrow({ where: { id: h.r.stock.cola } })).stock)).toBe(
      46,
    );
  });
});
