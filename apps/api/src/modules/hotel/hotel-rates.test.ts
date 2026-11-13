import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { ok, post, property, type FolioOut } from './hotel-kit';
import { hotelSweep } from './reports';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Inv = {
  roomTypeId: string;
  day: string;
  rooms: number;
  sold: number;
  held: number;
  outOfOrder: number;
  left: number;
};
type Quote = { nights: { day: string; rate: number }[]; total: number; meal: string; problem: string | null };

describe('Hotel: rates, availability, bookings, the room calendar (phase 17)', { timeout: 40_000 }, () => {
  it('H1, H2, H3, H6: rate plans price a stay night by night — meal plan, extra guests, seasons, length of stay, minimum stay', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const quote = (q: string) => ok<Quote>(h.desk.get(`/api/hotel/quote?${q}`));
    const base = `ratePlanId=${h.plans.cp}&roomTypeId=${h.types.deluxe}&arrive=${h.d(1)}&depart=${h.d(3)}`;
    expect(await quote(`${base}&adults=2`)).toMatchObject({ total: 8000_00, meal: 'CP', problem: null });
    // A third adult and a child in a Deluxe (usual 2, most 3): refused above the most; priced within it.
    expect((await quote(`${base}&adults=3`)).nights.map((n) => n.rate)).toEqual([5000_00, 5000_00]);
    expect((await h.desk.get(`/api/hotel/quote?${base}&adults=3&children=1`)).status).toBe(400);
    // The EP plan sells no Suite.
    expect(
      (
        await h.desk.get(
          `/api/hotel/quote?ratePlanId=${h.plans.ep}&roomTypeId=${h.types.suite}&arrive=${h.d(1)}&depart=${h.d(2)}`,
        )
      ).status,
    ).toBe(400);
    // Only set-up people make plans; a season, a length-of-stay tier and a minimum stay change the quote.
    expect(
      (await h.sup.post('/api/hotel/plans', { branchId: h.branchId, code: 'X', name: 'X', rates: h.rates }))
        .status,
    ).toBe(403);
    const peak = await post(w.api, '/api/hotel/plans', {
      branchId: h.branchId,
      code: 'PEAK',
      name: 'Festive',
      meal: 'MAP',
      rates: h.rates,
      weekendDays: [],
      seasons: [{ name: 'Festival', from: h.d(10), to: h.d(11), pct: 50 }],
      los: [{ nights: 3, pctOff: 10 }],
      minStay: 2,
    });
    const festive = (a: number, b: number) =>
      quote(`ratePlanId=${peak.id}&roomTypeId=${h.types.deluxe}&arrive=${h.d(a)}&depart=${h.d(b)}&adults=2`);
    expect((await festive(9, 11)).nights.map((n) => n.rate)).toEqual([4000_00, 6000_00]);
    expect((await festive(9, 12)).nights.map((n) => n.rate)).toEqual([3600_00, 5400_00, 5400_00]);
    expect((await festive(9, 10)).problem).toBe('MIN_STAY');
    expect(
      (
        await w.api.post('/api/hotel/plans', {
          branchId: h.branchId,
          code: 'PEAK',
          name: 'Again',
          rates: h.rates,
        })
      ).status,
    ).toBe(409);
    type Plan = { code: string; meal: string; minStay: number };
    expect(
      (await ok<Plan[]>(h.desk.get(`/api/hotel/plans?branchId=${h.branchId}`))).map((p) => p.code),
    ).toEqual(['CP', 'EP', 'PEAK']);
    await ok(w.api.del(`/api/hotel/plans/${peak.id}`));
    expect(
      (await ok<Plan[]>(h.desk.get(`/api/hotel/plans?branchId=${h.branchId}`))).map((p) => p.code),
    ).toEqual(['CP', 'EP']);
  });

  it('H3, H5: rooms left per type per day; stop-sell, closed to arrival and a minimum stay refuse a booking', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const inv = async (from: number, to: number) =>
      (
        await ok<{ days: Inv[] }>(
          h.desk.get(`/api/hotel/availability?branchId=${h.branchId}&from=${h.d(from)}&to=${h.d(to)}`),
        )
      ).days;
    const at = (days: Inv[], type: string, day: string) =>
      days.find((x) => x.roomTypeId === type && x.day === day)!;
    expect(at(await inv(0, 3), h.types.deluxe, h.d(1))).toMatchObject({ rooms: 4, sold: 0, left: 4 });
    await h.booked({ arrive: h.d(1), depart: h.d(3) });
    await h.booked({ arrive: h.d(2), depart: h.d(4) });
    const days = await inv(0, 5);
    expect([1, 2, 3, 4].map((n) => at(days, h.types.deluxe, h.d(n)).left)).toEqual([3, 2, 3, 4]);
    expect(at(days, h.types.suite, h.d(2)).left).toBe(2);
    // Restrictions: a desk person cannot set them; each one stops what it should.
    const rule = (body: object) =>
      h.sup.put('/api/hotel/room-days', { branchId: h.branchId, roomTypeIds: [h.types.suite], ...body });
    expect(
      (
        await h.desk.put('/api/hotel/room-days', {
          branchId: h.branchId,
          roomTypeIds: [h.types.suite],
          from: h.d(5),
          to: h.d(5),
          stopSell: true,
        })
      ).status,
    ).toBe(403);
    await ok(rule({ from: h.d(5), to: h.d(5), stopSell: true }));
    await ok(rule({ from: h.d(7), to: h.d(7), closedToArrival: true }));
    await ok(rule({ from: h.d(9), to: h.d(9), minStay: 3 }));
    const suite = (a: number, b: number) =>
      h.book({ roomTypeId: h.types.suite, arrive: h.d(a), depart: h.d(b) });
    const why = async (a: number, b: number) =>
      ((await suite(a, b)).body as { error: { details: { problem: string } } }).error.details.problem;
    expect(await why(4, 6)).toBe('STOP_SELL');
    expect(await why(7, 8)).toBe('CLOSED_TO_ARRIVAL');
    expect(await why(9, 11)).toBe('MIN_STAY');
    expect((await suite(6, 8)).status).toBe(200);
    expect((await suite(9, 12)).status).toBe(200);
    // Lifting a restriction puts the day back on sale; sold out refuses with the day.
    await ok(rule({ from: h.d(5), to: h.d(5), stopSell: false }));
    expect((await suite(4, 6)).status).toBe(200);
    expect((await suite(4, 6)).status).toBe(200);
    const full = await suite(5, 6);
    expect(full.status).toBe(409);
    expect((full.body as { error: { details: { problem: string; day: string } } }).error.details).toEqual({
      problem: 'SOLD_OUT',
      day: h.d(5),
    });
  });

  it('H9, H13, H16: an individual booking — the guest by mobile, a number, a rate for every night, a voucher, an advance', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const b = await h.booked({
      arrive: h.d(3),
      depart: h.d(6),
      roomId: h.rooms['102'],
      guest: { name: 'Asha Mehta', mobile: '98290 11111', email: 'asha@example.com' },
    });
    expect(b.number).toMatch(/^BK-\d{5}$/);
    expect(b).toMatchObject({ total: 12000_00 });
    const s = await h.stay(b.id);
    expect(s).toMatchObject({
      status: 'BOOKED',
      room: '102',
      roomType: 'Deluxe',
      nights: 3,
      kind: 'INDIVIDUAL',
    });
    expect(s.nightly.map((n) => [n.day, n.rate, n.room])).toEqual([
      [h.d(3), 4000_00, '102'],
      [h.d(4), 4000_00, '102'],
      [h.d(5), 4000_00, '102'],
    ]);
    // The guest is the same profile the restaurant uses (one per mobile).
    const guest = await ctx.prisma.guest.findFirstOrThrow({
      where: { companyId: w.companyId, mobile: '+919829011111' },
    });
    expect(s.guest).toMatchObject({ id: guest.id, name: 'Asha Mehta' });
    // The voucher goes to the guest, with a link that shows the booking without signing in.
    const told = (await h.events('hotel.booked'))[0]!;
    expect(told).toMatchObject({
      customerMobile: '+919829011111',
      customerEmail: 'asha@example.com',
      number: b.number,
      nights: 3,
      roomType: 'Deluxe',
      amount: '₹12,000.00',
    });
    const voucher = (await ctx.app.inject({ method: 'GET', url: `/api/public${String(told.link)}` })).json();
    expect(voucher).toMatchObject({
      number: b.number,
      name: 'Asha Mehta',
      roomType: 'Deluxe',
      meal: 'CP',
      total: 12000_00,
      status: 'BOOKED',
    });
    // A past day and a room of another type are refused.
    expect((await h.book({ arrive: '2020-01-01', depart: '2020-01-03' })).status).toBe(400);
    expect((await h.book({ roomId: h.rooms['201'] })).status).toBe(400);
    // An advance is an ADVANCE paper in the guest's name, shown as money on the folio.
    expect(
      (await h.desk.post(`/api/hotel/stays/${b.id}/advance`, { modeId: h.r.modes.upi, amount: 5000_00 }))
        .status,
    ).toBe(400);
    const adv = await post<{ billId: string; number: string }>(h.desk, `/api/hotel/stays/${b.id}/advance`, {
      modeId: h.r.modes.upi,
      amount: 5000_00,
      reference: 'UPI-91',
    });
    const paper = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: adv.billId } });
    expect(paper).toMatchObject({
      type: 'ADVANCE',
      status: 'ISSUED',
      total: 5000_00n,
      sourceType: 'stay',
      sourceId: b.id,
    });
    const folio = (await h.stay(b.id)).folios[0]!;
    expect(folio).toMatchObject({ no: 1, name: 'Asha Mehta', paid: 5000_00, due: -5000_00 });
  });

  it('H10: a group block holds rooms until its release date; bookings are picked up from it; the rest goes back on sale', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const left = async () =>
      (
        await ok<{ days: Inv[] }>(
          h.desk.get(`/api/hotel/availability?branchId=${h.branchId}&from=${h.d(5)}&to=${h.d(6)}`),
        )
      ).days.find((x) => x.roomTypeId === h.types.deluxe)!;
    const block = await post<{ id: string; rooms: { count: number; pickedUp: number }[] }>(
      h.desk,
      '/api/hotel/blocks',
      {
        branchId: h.branchId,
        name: 'Sharma wedding',
        ratePlanId: h.plans.cp,
        arrive: h.d(5),
        depart: h.d(7),
        rooms: [{ roomTypeId: h.types.deluxe, count: 3 }],
        releaseOn: h.d(0),
      },
    );
    expect(await left()).toMatchObject({ held: 3, left: 1 });
    // More rooms than are left cannot be held; the open market sells only what the block leaves.
    expect(
      (
        await h.desk.post('/api/hotel/blocks', {
          branchId: h.branchId,
          name: 'Too big',
          ratePlanId: h.plans.cp,
          arrive: h.d(5),
          depart: h.d(6),
          rooms: [{ roomTypeId: h.types.deluxe, count: 2 }],
          releaseOn: h.d(0),
        })
      ).status,
    ).toBe(409);
    await h.booked({ arrive: h.d(5), depart: h.d(7) });
    expect((await h.book({ arrive: h.d(5), depart: h.d(7) })).status).toBe(409);
    // Two rooms are picked up from the block (inside its dates, at its plan).
    const one = await h.booked({ arrive: h.d(5), depart: h.d(7), blockId: block.id });
    await h.booked({ arrive: h.d(5), depart: h.d(6), blockId: block.id });
    expect((await h.stay(one.id)).kind).toBe('GROUP');
    expect((await h.book({ arrive: h.d(4), depart: h.d(6), blockId: block.id })).status).toBe(400);
    expect(await left()).toMatchObject({ sold: 3, held: 1, left: 0 });
    type Block = { id: string; status: string; rooms: { count: number; pickedUp: number }[] };
    expect((await ok<Block[]>(h.desk.get(`/api/hotel/blocks?branchId=${h.branchId}`)))[0]).toMatchObject({
      status: 'HELD',
      rooms: [{ count: 3, pickedUp: 2 }],
    });
    // The release date passes (the hotel's date moves on with the night audit): the unsold room is on sale again.
    expect(await hotelSweep(ctx.prisma, new Date(), w.companyId)).toMatchObject({ released: 0 });
    await h.audit();
    expect(await hotelSweep(ctx.prisma, new Date(), w.companyId)).toMatchObject({ released: 1 });
    expect(await left()).toMatchObject({ held: 0, left: 1 });
    expect((await h.book({ arrive: h.d(5), depart: h.d(7), blockId: block.id })).status).toBe(409);
    expect((await h.book({ arrive: h.d(5), depart: h.d(6) })).status).toBe(200);
  });

  it('H4, H11, H12: a corporate plan bills the room to the company; an agent plan records the commission', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const plan = (body: object) =>
      w.api.post('/api/hotel/plans', {
        branchId: h.branchId,
        rates: [{ roomTypeId: h.types.deluxe, base: 3200_00 }],
        weekendDays: [],
        ...body,
      });
    expect((await plan({ code: 'ACME', name: 'Acme rate', kind: 'CORPORATE' })).status).toBe(400);
    const corp = await ok<{ id: string }>(
      plan({ code: 'ACME', name: 'Acme rate', kind: 'CORPORATE', partyId: h.acme }),
    );
    const ta = await ok<{ id: string }>(
      plan({ code: 'RT', name: 'Royal Travels', kind: 'AGENT', partyId: h.agent, commissionPct: 10 }),
    );
    // Corporate: two folios — the company's takes the room, the guest's everything else.
    const c = await h.booked({ ratePlanId: corp.id });
    expect(c.total).toBe(6400_00);
    const cs = await h.stay(c.id);
    expect(cs.kind).toBe('CORPORATE');
    expect(cs.folios.map((f: FolioOut) => [f.no, f.name, f.partyId === h.acme])).toEqual([
      [1, cs.guest!.name, false],
      [2, 'Acme Corp', true],
    ]);
    expect((await ok<{ routing: unknown }>(h.desk.get(`/api/hotel/stays/${c.id}/folios`))).routing).toEqual([
      { kinds: ['ROOM', 'EARLY', 'LATE'], folio: 2 },
    ]);
    // Agent: the commission on the room charge is kept on the booking.
    const a = await h.booked({ ratePlanId: ta.id });
    const as = await h.stay(a.id);
    expect(as).toMatchObject({ kind: 'AGENT', commissionPct: 10 });
    expect((await ctx.prisma.stay.findUniqueOrThrow({ where: { id: a.id } })).agentPartyId).toBe(h.agent);
    // A company named on a booking at the open rate also gets its own folio.
    const direct = await h.booked({ companyPartyId: h.acme });
    expect((await h.stay(direct.id)).folios).toHaveLength(2);
  });

  it('H14, H15: cancelling — free in time, else the plan’s charge on the folio, paid from the advance; a no-show by hand', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    // Far ahead: free, and the room is on sale again.
    const far = await h.booked({ arrive: h.d(10), depart: h.d(12), roomId: h.rooms['101'] });
    expect(
      await ok(h.desk.post(`/api/hotel/stays/${far.id}/cancel`, { reason: 'Plans changed' })),
    ).toMatchObject({ status: 'CANCELLED', charge: 0 });
    expect((await h.book({ arrive: h.d(10), depart: h.d(12), roomId: h.rooms['101'] })).status).toBe(200);
    expect((await h.events('hotel.cancelled'))[0]).toMatchObject({ charge: '' });
    // Arriving today: the first night is charged. The advance pays it; the rest of the advance is returned.
    const late = await h.booked();
    const adv = await post<{ lineId: string; billId: string }>(
      h.desk,
      `/api/hotel/stays/${late.id}/advance`,
      { modeId: h.r.modes.cash, amount: 6000_00 },
    );
    expect(await ok(h.desk.post(`/api/hotel/stays/${late.id}/cancel`, {}))).toMatchObject({
      status: 'CANCELLED',
      charge: 4000_00,
    });
    const folio = (await h.stay(late.id)).folios[0]!;
    // ₹4,000 + 12 % = ₹4,480 against ₹6,000 paid.
    expect(folio).toMatchObject({ charges: 4000_00, tax: 480_00, total: 4480_00, paid: 6000_00 });
    expect(folio.lines.find((l) => l.kind === 'CANCEL')).toMatchObject({ amount: 4000_00 });
    const closed = await post<FolioOut>(h.desk, `/api/hotel/folios/${folio.id}/settle`, {});
    expect(closed).toMatchObject({ status: 'CLOSED', advanceLeft: 1520_00 });
    expect(closed.invoice).toMatchObject({ total: 4480_00, due: 0 });
    expect((await ctx.prisma.bill.findUniqueOrThrow({ where: { id: adv.billId } })).settled).toBe(4480_00n);
    // A cancelled booking cannot be cancelled or checked in again.
    expect((await h.desk.post(`/api/hotel/stays/${late.id}/cancel`, {})).status).toBe(409);
    expect((await h.checkIn(late.id, '102')).status).toBe(409);
    // A no-show marked at the desk: the plan's no-show charge (the first night).
    const gone = await h.booked();
    expect(await ok(h.desk.post(`/api/hotel/stays/${gone.id}/no-show`, {}))).toMatchObject({
      status: 'NO_SHOW',
      charge: 4000_00,
    });
    expect((await h.events('hotel.no_show'))[0]).toMatchObject({ charge: '₹4,000.00', number: gone.number });
    // An unused advance on a booking cancelled for free is given back: the paper is voided.
    const free = await h.booked({ arrive: h.d(20), depart: h.d(21) });
    const a2 = await post<{ lineId: string; billId: string }>(h.desk, `/api/hotel/stays/${free.id}/advance`, {
      modeId: h.r.modes.cash,
      amount: 1000_00,
    });
    await ok(h.desk.post(`/api/hotel/stays/${free.id}/cancel`, {}));
    await ok(h.desk.post(`/api/hotel/folio-lines/${a2.lineId}/refund`, {}));
    expect((await ctx.prisma.bill.findUniqueOrThrow({ where: { id: a2.billId } })).status).toBe('CANCELLED');
  });
});
