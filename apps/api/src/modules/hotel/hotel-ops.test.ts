import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { add, bill, open, pay } from '../hosp/pos-kit';
import { world } from '../records/testkit';
import { ok, post, property } from './hotel-kit';
import { hotelSweep } from './reports';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Pack = {
  day: string;
  rooms: number;
  sold: number;
  outOfOrder: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  roomRevenue: number;
  arrivals: number;
  noShows: { number: string; charge: number }[];
  revenueByOutlet: { outlet: string; bills: number; amount: number }[];
  money: { mode: string; amount: number }[];
  checks: {
    dueOuts: { number: string; room: string | null }[];
    openFoliosOfDeparted: { number: string }[];
    unpaidRestaurantBills: number;
  };
};
const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;

describe(
  'Hotel: night audit, housekeeping, maintenance, requests, registers (phase 17)',
  { timeout: 60_000 },
  () => {
    it('H36–H40: the night audit — no-shows, room and tax charges, what is still open, the date rolled, the audit pack', async () => {
      const w = await world(ctx.app);
      const h = await property(ctx.prisma, w);
      const a = await h.booked({ depart: h.d(2) });
      const b = await h.booked({ depart: h.d(1), roomTypeId: h.types.suite });
      const ghost = await h.booked({ depart: h.d(3) });
      await ok(h.checkIn(a.id, '101'));
      await ok(h.checkIn(b.id, '201'));
      await post(h.desk, `/api/hotel/stays/${a.id}/advance`, { modeId: h.r.modes.cash, amount: 3000_00 });
      // A dinner paid in cash at the restaurant, and one bill left open.
      const o = await open(h.desk, h.r, 'T1');
      await add(h.desk, o.id, [{ menuItemId: h.r.m.dal }]);
      const c = await bill(h.desk, o.id);
      await pay(h.desk, c.id, [{ modeId: h.r.modes.cash, amount: c.total }]);
      const o2 = await open(h.desk, h.r, 'T2');
      await add(h.desk, o2.id, [{ menuItemId: h.r.m.naan }]);
      const c2 = await bill(h.desk, o2.id);
      // Only a supervisor runs it.
      expect((await h.desk.post('/api/hotel/night-audit', { branchId: h.branchId })).status).toBe(403);
      const first = await h.audit();
      const pack = first.pack as unknown as Pack;
      expect(first.businessDate).toBe(h.d(1));
      // Two of six rooms sold: ₹4,000 + ₹8,000.
      expect(pack).toMatchObject({
        day: h.d(0),
        rooms: 6,
        outOfOrder: 0,
        sold: 2,
        roomRevenue: 12000_00,
        occupancyPct: 33.3,
        adr: 6000_00,
        revPar: 2000_00,
        arrivals: 2,
      });
      expect(pack.noShows).toEqual([{ number: ghost.number, guest: expect.any(String), charge: 4000_00 }]);
      expect(pack.revenueByOutlet).toEqual([{ outlet: 'Rooftop', bills: 2, amount: c.total + c2.total }]);
      expect(pack.money).toEqual([{ mode: 'Cash', amount: 3000_00 + c.total }]);
      expect(pack.checks).toMatchObject({ dueOuts: [], unpaidRestaurantBills: 1 });
      // The no-show's charge waits on its folio; its nights are on sale again.
      expect((await h.stay(ghost.id)).status).toBe('NO_SHOW');
      expect(pack.checks.openFoliosOfDeparted).toEqual([{ number: ghost.number, folio: expect.any(String) }]);
      expect((await h.stay(ghost.id)).folios[0]).toMatchObject({ charges: 4000_00, total: 4480_00 });
      // Each guest's folio has tonight's room, once; both rooms need cleaning.
      expect((await h.stay(a.id)).folios[0]!.lines.filter((l) => l.kind === 'ROOM')).toMatchObject([
        { amount: 4000_00, day: h.d(0) },
      ]);
      expect((await h.stay(a.id)).nightly.map((n) => n.posted)).toEqual([true, false]);
      expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['201']! } })).hkStatus).toBe(
        'DIRTY',
      );
      // The next night: B should have left (a due-out), A's second night is charged; nothing is charged twice.
      const second = (await h.audit()).pack as unknown as Pack;
      expect(second).toMatchObject({ day: h.d(1), sold: 1, roomRevenue: 4000_00, noShows: [] });
      expect(second.checks.dueOuts).toEqual([{ number: b.number, room: null }]);
      expect((await h.stay(a.id)).folios[0]!.lines.filter((l) => l.kind === 'ROOM')).toHaveLength(2);
      expect((await h.stay(b.id)).folios[0]!.lines.filter((l) => l.kind === 'ROOM')).toHaveLength(1);
      // One pack a day is kept; the same day can never be audited twice.
      const kept = await ok<{ businessDate: string; audits: Pack[] }>(
        h.sup.get(`/api/hotel/night-audits?branchId=${h.branchId}`),
      );
      expect(kept.audits.map((p) => p.day)).toEqual([h.d(1), h.d(0)]);
      expect(kept.businessDate).toBe(h.d(2));
      await expect(
        ctx.prisma.nightAudit.create({
          data: { companyId: w.companyId, branchId: h.branchId, day: h.d(0), pack: {} },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('H47: a room out of order is a help ticket and a block — off sale until the ticket closes, then back, dirty', async () => {
      const w = await world(ctx.app);
      const h = await property(ctx.prisma, w);
      await ok(
        w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, { maintenanceSolverId: h.r.steward2.id }),
      );
      const booked = await h.booked({ arrive: h.d(1), depart: h.d(2), roomId: h.rooms['101'] });
      const block = (room: string, body: object = {}) =>
        h.sup.post(`/api/hotel/rooms/${h.rooms[room]}/block`, {
          to: h.d(2),
          reason: 'AC compressor failed',
          ...body,
        });
      expect(
        (
          await h.desk.post(`/api/hotel/rooms/${h.rooms['102']}/block`, {
            to: h.d(2),
            reason: 'AC compressor failed',
          })
        ).status,
      ).toBe(403);
      // A room with a booking on those days cannot be blocked (the booking is moved first).
      expect(msg(await block('101'))).toContain('Room 101 has a booking');
      const made = await ok<{ id: string; ticket: { number: number; status: string }; ticketId: string }>(
        block('102'),
      );
      expect(made.ticket).toMatchObject({ status: 'OPEN' });
      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: made.ticketId } });
      expect(ticket).toMatchObject({
        title: 'Room 102: AC compressor failed',
        solverId: h.r.steward2.id,
        raiserId: h.r.manager.id,
      });
      expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['102']! } })).hkStatus).toBe(
        'OUT_OF_ORDER',
      );
      // It is off sale for those days and cannot take a guest.
      type Inv = { roomTypeId: string; day: string; outOfOrder: number; left: number };
      const inv = async () =>
        (
          await ok<{ days: Inv[] }>(
            h.desk.get(`/api/hotel/availability?branchId=${h.branchId}&from=${h.d(0)}&to=${h.d(4)}`),
          )
        ).days.filter((x) => x.roomTypeId === h.types.deluxe);
      expect((await inv()).map((x) => [x.outOfOrder, x.left])).toEqual([
        [1, 3],
        [1, 2],
        [1, 3],
        [0, 4],
      ]);
      expect((await h.book({ roomId: h.rooms['102'] })).status).toBe(409);
      expect(
        (await h.desk.post(`/api/hotel/stays/${booked.id}/room`, { roomId: h.rooms['102'] })).status,
      ).toBe(409);
      // While the ticket is open the room stays blocked; once it closes the room is back — to be cleaned.
      expect(msg(await h.sup.post(`/api/hotel/room-blocks/${made.id}/release`))).toContain('is still open');
      expect(await hotelSweep(ctx.prisma, new Date(), w.companyId)).toMatchObject({ rooms: 0 });
      await ctx.prisma.ticket.update({ where: { id: made.ticketId }, data: { status: 'CLOSED' } });
      expect(await hotelSweep(ctx.prisma, new Date(), w.companyId)).toMatchObject({ rooms: 1 });
      expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['102']! } })).hkStatus).toBe(
        'DIRTY',
      );
      expect((await inv()).map((x) => x.outOfOrder)).toEqual([0, 0, 0, 0]);
      expect(await ok(h.desk.get(`/api/hotel/room-blocks?branchId=${h.branchId}`))).toEqual([]);
      // A block with nobody to fix it (out of service for a deep clean) is released by hand.
      await ok(w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, { maintenanceSolverId: null }));
      const plain = await ok<{ id: string; ticketId: string | null }>(
        block('103', { kind: 'OUT_OF_SERVICE', reason: 'Deep cleaning' }),
      );
      expect(plain.ticketId).toBeNull();
      expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['103']! } })).hkStatus).toBe(
        'OUT_OF_SERVICE',
      );
      await ok(h.sup.post(`/api/hotel/room-blocks/${plain.id}/release`));
      expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['103']! } })).hkStatus).toBe(
        'DIRTY',
      );
    });

    it('H48: a guest request is a ticket with a time limit — from the desk, or from the QR in the room', async () => {
      const w = await world(ctx.app);
      const h = await property(ctx.prisma, w);
      const a = await h.booked({ depart: h.d(1) });
      await ok(h.checkIn(a.id, '101'));
      const ask = (text: string) => h.desk.post(`/api/hotel/stays/${a.id}/request`, { text });
      expect(msg(await ask('Two extra towels'))).toContain('Choose who handles guest requests');
      await ok(
        w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
          requestSolverId: h.r.steward2.id,
          requestSlaMin: 20,
        }),
      );
      const made = await ok<{ ticketId: string; number: number; dueAt: string }>(ask('Two extra towels'));
      const t = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: made.ticketId } });
      expect(t).toMatchObject({
        title: 'Room 101: Two extra towels',
        solverId: h.r.steward2.id,
        raiserId: h.r.steward.id,
        status: 'OPEN',
      });
      const minutes = (t.plannedFixAt.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(19);
      expect(minutes).toBeLessThan(21);
      // The QR in the room: a link made once by a supervisor; no sign-in; only while a guest is in the room.
      const link = await ok<{ token: string; path: string }>(
        h.sup.post(`/api/hotel/rooms/${h.rooms['101']}/link`),
      );
      expect((await ok<{ token: string }>(h.sup.post(`/api/hotel/rooms/${h.rooms['101']}/link`))).token).toBe(
        link.token,
      );
      const url = `/api/public/room/${link.token}`;
      expect((await ctx.app.inject({ method: 'GET', url })).json()).toMatchObject({
        room: '101',
        minutes: 20,
      });
      const sent = await ctx.app.inject({
        method: 'POST',
        url: `${url}/request`,
        payload: { text: 'An iron, please' },
      });
      expect(sent.json()).toMatchObject({ ok: true, minutes: 20 });
      const fromRoom = await ctx.prisma.ticket.findFirstOrThrow({
        where: { companyId: w.companyId, title: 'Room 101: An iron, please' },
      });
      // It is raised in the name of whoever checked the guest in, so someone at the desk confirms it.
      expect(fromRoom).toMatchObject({ raiserId: h.r.steward.id, solverId: h.r.steward2.id });
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `${url}/request`,
            payload: { text: 'Spam', website: 'x.example' },
          })
        ).json(),
      ).toEqual({ ok: true, number: null });
      const empty = await ok<{ token: string }>(h.sup.post(`/api/hotel/rooms/${h.rooms['102']}/link`));
      expect(
        (
          await ctx.app.inject({
            method: 'POST',
            url: `/api/public/room/${empty.token}/request`,
            payload: { text: 'Anyone there?' },
          })
        ).statusCode,
      ).toBe(409);
    });
  },
);
