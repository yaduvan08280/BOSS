import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { ok, property } from './hotel-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('Hotel: the room calendar (phase 17)', { timeout: 60_000 }, () => {
  it('H7, H8: the room calendar — a room for a booking, no two stays in a room on a night, a longer and a shorter stay', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const a = await h.booked({ arrive: h.d(1), depart: h.d(3) });
    const b = await h.booked({ arrive: h.d(2), depart: h.d(4) });
    const room = (id: string, n: string, more: object = {}) =>
      h.desk.post(`/api/hotel/stays/${id}/room`, { roomId: h.rooms[n], ...more });
    expect(await ok(room(a.id, '101'))).toMatchObject({ room: '101', upgraded: false });
    // The same room on an overlapping night is refused — for a person and in the database.
    const clash = await room(b.id, '101');
    expect(clash.status).toBe(409);
    expect((clash.body as { error: { message: string } }).error.message).toContain('101');
    await expect(
      ctx.prisma.roomNight.create({
        data: {
          companyId: w.companyId,
          branchId: h.branchId,
          roomTypeId: h.types.deluxe,
          roomId: h.rooms['101']!,
          day: h.d(1),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await ok(room(b.id, '102'));
    type Tape = {
      days: string[];
      rooms: { number: string; state: string; cells: { day: string; stayId: string | null }[] }[];
      stays: { id: string }[];
      unassigned: string[];
    };
    const tape = await ok<Tape>(h.desk.get(`/api/hotel/tape?branchId=${h.branchId}&days=5`));
    expect(tape.days).toEqual([0, 1, 2, 3, 4].map((n) => h.d(n)));
    expect(tape.rooms.find((r) => r.number === '101')).toMatchObject({
      state: 'VACANT_CLEAN',
      cells: [
        { day: h.d(1), stayId: a.id },
        { day: h.d(2), stayId: a.id },
      ],
    });
    expect(tape.rooms.find((r) => r.number === '102')!.cells.map((c) => c.day)).toEqual([h.d(2), h.d(3)]);
    expect(tape.unassigned).toEqual([]);
    const c = await h.booked({ arrive: h.d(1), depart: h.d(2) });
    expect((await ok<Tape>(h.desk.get(`/api/hotel/tape?branchId=${h.branchId}&days=5`))).unassigned).toEqual([
      c.id,
    ]);
    // A is extended by a night: room 101 is free then; a second extra night would run into nothing either.
    expect(await ok(h.desk.post(`/api/hotel/stays/${a.id}/dates`, { depart: h.d(4) }))).toMatchObject({
      added: 1,
      dropped: 0,
    });
    expect((await h.stay(a.id)).nightly.map((n) => [n.day, n.room, n.rate])).toEqual([
      [h.d(1), '101', 4000_00],
      [h.d(2), '101', 4000_00],
      [h.d(3), '101', 4000_00],
    ]);
    // B cannot move into 101 on those nights, nor A be extended into a night when B then holds its room.
    await ok(room(b.id, '103'));
    await ok(room(c.id, '102'));
    const d = await h.booked({ arrive: h.d(4), depart: h.d(5), roomId: h.rooms['101'] });
    expect((await h.desk.post(`/api/hotel/stays/${a.id}/dates`, { depart: h.d(5) })).status).toBe(409);
    // Shorter: the night given up is on sale again.
    expect(await ok(h.desk.post(`/api/hotel/stays/${a.id}/dates`, { depart: h.d(2) }))).toMatchObject({
      dropped: 2,
    });
    expect((await h.stay(a.id)).total).toBe(4000_00);
    expect((await room(d.id, '101', {})).status).toBe(400);
    expect((await h.book({ arrive: h.d(2), depart: h.d(4), roomId: h.rooms['101'] })).status).toBe(200);
  });
});
