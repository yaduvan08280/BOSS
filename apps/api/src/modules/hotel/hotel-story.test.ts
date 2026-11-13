import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { add, bill, open, pay } from '../hosp/pos-kit';
import { world } from '../records/testkit';
import { ok, post, property, type FolioOut } from './hotel-kit';

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

describe('Hotel: registers and the stay story (phase 17)', { timeout: 60_000 }, () => {
  it('H49: the guest register and occupancy statistics', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const a = await h.booked({ depart: h.d(2), guest: { name: 'Ravi Kumar', mobile: '9829012345' } });
    await ok(
      h.checkIn(a.id, '101', {
        kyc: {
          ...h.kyc,
          address: '12 MI Road, Jaipur',
          arrivedFrom: 'Delhi',
          nextDestination: 'Udaipur',
          purpose: 'Business',
        },
      }),
    );
    const b = await h.booked({ depart: h.d(1), roomTypeId: h.types.suite });
    await ok(h.checkIn(b.id, '201'));
    await h.booked({ arrive: h.d(1), depart: h.d(2) });
    await h.audit();
    await h.audit();
    type Row = {
      number: string;
      name: string;
      idType: string;
      idNumber: string;
      address: string;
      rooms: string;
      arrive: string;
      depart: string;
      foreign: boolean;
      arrivedFrom: string;
    };
    const reg = await ok<Row[]>(
      h.desk.get(`/api/hotel/register?branchId=${h.branchId}&from=${h.d(0)}&to=${h.d(2)}`),
    );
    // Only guests who actually stayed (the second day's booking never arrived).
    expect(reg.map((r) => r.number).sort()).toEqual([a.number, b.number].sort());
    expect(reg.find((r) => r.number === a.number)).toMatchObject({
      name: 'Ravi Kumar',
      idType: 'Aadhaar',
      idNumber: '1234 5678 9012',
      address: '12 MI Road, Jaipur',
      rooms: '101',
      arrive: h.d(0),
      depart: h.d(2),
      foreign: false,
      arrivedFrom: 'Delhi',
    });
    type Occ = {
      days: { day: string; sold: number; rooms: number; occupancyPct: number }[];
      total: {
        audited: number;
        sold: number;
        occupancyPct: number;
        adr: number;
        revPar: number;
        roomRevenue: number;
      };
    };
    const occ = await ok<Occ>(
      h.desk.get(`/api/hotel/occupancy?branchId=${h.branchId}&from=${h.d(0)}&to=${h.d(1)}`),
    );
    expect(occ.days.map((d) => [d.day, d.sold, d.rooms, d.occupancyPct])).toEqual([
      [h.d(0), 2, 6, 33.3],
      [h.d(1), 1, 6, 16.7],
    ]);
    // Three room nights of twelve: ₹4,000 + ₹8,000 + ₹4,000.
    expect(occ.total).toEqual({
      nights: 2,
      audited: 2,
      sold: 3,
      occupancyPct: 25,
      adr: 5333_33,
      revPar: 1333_33,
      roomRevenue: 16000_00,
    });
  });

  it('H50: the story — a 3-night CP stay with a room move, two room-service bills, the minibar, a split folio (room to the company, extras to the guest) and a no-show the same night, closed through the night audit', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(
      w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
        minibar: [{ itemId: h.r.stock.cola, name: 'Cola', price: 150_00, taxCode: 'GST18' }],
        hkLocationId: h.r.kitchenLoc,
      }),
    );
    // Booked by Acme for Mr Rao: three nights with breakfast; Acme pays the room, he pays his extras.
    const stay = await h.booked({
      depart: h.d(3),
      companyPartyId: h.acme,
      guest: { name: 'Vikram Rao', mobile: '9829054321' },
    });
    const ghost = await h.booked({ depart: h.d(1), guest: { name: 'No Show', mobile: '9829000000' } });
    expect(stay.total).toBe(12000_00);
    await ok(h.checkIn(stay.id, '101'));
    // Night 1: dinner sent to the room; the other booking never arrives.
    const dinner = async (items: object[]) => {
      const o = await open(h.desk, h.r, 'T1', {
        type: 'ROOM_SERVICE',
        roomNo: (await h.stay(stay.id)).room,
      });
      await add(h.desk, o.id, items);
      const c = await bill(h.desk, o.id);
      await pay(h.desk, c.id, [{ modeId: h.r.modes.room, amount: c.total }]);
      return c.total;
    };
    const d1 = await dinner([{ menuItemId: h.r.m.dal }]);
    const night1 = (await h.audit()).pack as unknown as Pack;
    expect(night1).toMatchObject({
      sold: 1,
      roomRevenue: 4000_00,
      noShows: [{ number: ghost.number, charge: 4000_00 }],
    });
    // Day 2: the room is cleaned by housekeeping… but the shower fails, so he moves to 102; minibar; dinner again.
    await ok(
      h.desk.post(`/api/hotel/stays/${stay.id}/room`, {
        roomId: h.rooms['102'],
        reason: 'Shower not working',
      }),
    );
    await ok(
      h.desk.post(`/api/hotel/rooms/${h.rooms['102']}/minibar`, {
        items: [{ itemId: h.r.stock.cola, qty: 2 }],
      }),
    );
    const d2 = await dinner([{ menuItemId: h.r.m.tikka, variantKey: 'full' }]);
    await h.audit();
    await h.audit();
    // The morning he leaves: three nights charged, in the rooms he slept in.
    const s = await h.stay(stay.id);
    expect(s.nightly.map((n) => [n.room, n.posted])).toEqual([
      ['101', true],
      ['102', true],
      ['102', true],
    ]);
    const [guest, company] = s.folios as [FolioOut, FolioOut];
    // The company's folio: three room nights, ₹12,000 + 12 % = ₹13,440.
    expect(company.lines.map((l) => l.kind)).toEqual(['ROOM', 'ROOM', 'ROOM']);
    expect(company).toMatchObject({ name: 'Acme Corp', charges: 12000_00, tax: 1440_00, total: 13440_00 });
    // His own: two dinners (already invoiced by the restaurant) and the minibar ₹300 + 18 %.
    expect(guest.lines.map((l) => l.kind)).toEqual(['FOOD', 'MINIBAR', 'FOOD']);
    expect(guest).toMatchObject({
      restaurant: d1 + d2,
      charges: 300_00,
      tax: 54_00,
      total: d1 + d2 + 354_00,
    });
    // He cannot leave with his folio open; he pays by card; the company's is billed to Acme on credit.
    expect((await h.desk.post(`/api/hotel/stays/${stay.id}/check-out`, { leftMin: 600 })).status).toBe(409);
    const mine = await post<FolioOut>(h.desk, `/api/hotel/folios/${guest.id}/settle`, {
      payments: [{ modeId: h.r.modes.card, amount: d1 + d2 + 354_00, reference: 'AUTH-77' }],
    });
    expect(mine.invoice).toMatchObject({ total: 354_00, due: 0 });
    const theirs = await post<FolioOut>(h.desk, `/api/hotel/folios/${company.id}/settle`, {
      onCredit: true,
    });
    expect(theirs.invoice).toMatchObject({ total: 13440_00, due: 13440_00 });
    expect(await ok(h.desk.post(`/api/hotel/stays/${stay.id}/check-out`, { leftMin: 600 }))).toMatchObject({
      status: 'CHECKED_OUT',
    });
    // The no-show's first night is on its folio and is collected (here: written to the guest's account in cash).
    const lost = (await h.stay(ghost.id)).folios[0]!;
    expect(lost).toMatchObject({ total: 4480_00 });
    await post(h.desk, `/api/hotel/folios/${lost.id}/settle`, {
      payments: [{ modeId: h.r.modes.cash, amount: 4480_00 }],
    });
    // The books agree: every paper issued once, the restaurant's bills paid, only Acme's invoice owed.
    const invoices = await ctx.prisma.bill.findMany({ where: { companyId: w.companyId, type: 'INVOICE' } });
    expect(invoices.reduce((n, b) => n + Number(b.total), 0)).toBe(13440_00 + 354_00 + d1 + d2 + 4480_00);
    expect(
      invoices.filter((b) => b.status !== 'PAID').map((b) => [b.partyId, Number(b.total - b.settled)]),
    ).toEqual([[h.acme, 13440_00]]);
    // The last audit finds nothing left open, and both rooms he used are waiting for housekeeping.
    const last = (await h.audit()).pack as unknown as Pack;
    expect(last.checks).toEqual({ dueOuts: [], openFoliosOfDeparted: [], unpaidRestaurantBills: 0 });
    expect(last).toMatchObject({ sold: 0, departures: 1 });
    const rooms = await ctx.prisma.room.findMany({
      where: { id: { in: [h.rooms['101']!, h.rooms['102']!] } },
    });
    expect(rooms.map((r) => r.hkStatus)).toEqual(['DIRTY', 'DIRTY']);
    expect(
      (await ctx.prisma.item.findUniqueOrThrow({ where: { id: h.r.stock.cola } })).stock.toString(),
    ).toBe('46');
  });
});
