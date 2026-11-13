import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { ok, post, property, type FolioOut } from './hotel-kit';
import { formCExport, hotelSweep } from './reports';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Desk = Record<
  'arrivals' | 'inHouse' | 'departures' | 'dueOuts',
  { number: string; room: string | null }[]
>;
const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;

describe('Hotel: the front desk and the folio (phase 17)', { timeout: 60_000 }, () => {
  it('H17, H18, H20, H24: arrivals, in-house and departures; check-in needs a ready room, the ID, its photo and a signature; keys and visitors', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const a = await h.booked({ depart: h.d(1) });
    const b = await h.booked({ arrive: h.d(1), depart: h.d(2) });
    const lists = () => ok<Desk>(h.desk.get(`/api/hotel/desk?branchId=${h.branchId}`));
    expect((await lists()).arrivals.map((x) => x.number)).toEqual([a.number]);
    // Tomorrow's arrival cannot be checked in today; no room, no photo or no signature refuse the check-in.
    expect((await h.checkIn(b.id, '102')).status).toBe(409);
    expect(msg(await h.desk.post(`/api/hotel/stays/${a.id}/check-in`, { kyc: h.kyc }))).toBe(
      'Choose a room for this guest',
    );
    expect((await h.checkIn(a.id, '101', { kyc: { ...h.kyc, signatureId: null } })).status).toBe(400);
    expect((await h.checkIn(a.id, '101', { kyc: { idType: 'Aadhaar', idNumber: '' } })).status).toBe(400);
    // A room that is not clean is not given.
    await ctx.prisma.room.update({ where: { id: h.rooms['101']! }, data: { hkStatus: 'DIRTY' } });
    expect(msg(await h.checkIn(a.id, '101'))).toBe('Room 101 is not ready (dirty)');
    const inn = await ok<{ status: string; room: string; formC: null }>(h.checkIn(a.id, '102', { keys: 2 }));
    expect(inn).toMatchObject({ status: 'CHECKED_IN', room: '102', formC: null, earlyFee: 0 });
    expect(await lists()).toMatchObject({
      arrivals: [],
      inHouse: [{ number: a.number, room: '102' }],
      departures: [],
      dueOuts: [],
    });
    // Keys handed over and the visitor log.
    const note = (body: object) =>
      ok<{ keys: number; visitors: { name: string; out: string | null }[] }>(
        h.desk.post(`/api/hotel/stays/${a.id}/desk`, body),
      );
    expect((await note({ what: 'keys', keys: 1 })).keys).toBe(1);
    await note({ what: 'visitorIn', name: 'Mr Jain', note: 'Colleague' });
    const out = await note({ what: 'visitorOut', index: 0 });
    expect(out.visitors[0]).toMatchObject({ name: 'Mr Jain' });
    expect(out.visitors[0]!.out).toBeTruthy();
    const s = await h.stay(a.id);
    expect(s).toMatchObject({ keys: 1, status: 'CHECKED_IN' });
    // The audit moves the date: A is due to leave today, B arrives; another audit and A is overdue.
    await h.audit();
    expect(await lists()).toMatchObject({
      arrivals: [{ number: b.number }],
      departures: [{ number: a.number }],
      dueOuts: [],
    });
    await ok(h.checkIn(b.id, '103'));
    await h.audit();
    const later = await lists();
    expect(later.dueOuts.map((x) => x.number)).toEqual([a.number]);
    expect(later.departures.map((x) => x.number)).toEqual([b.number]);
  });

  it('H19: a foreign guest — Form C is due within 24 hours, the managers are reminded once, it is filed only when complete, and exported', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const b = await h.booked({ guest: { name: 'Emma Clark', mobile: '+447700900123' } });
    const inn = await ok<{ formC: { dueAt: string; missing: string[] } }>(
      h.checkIn(b.id, '101', {
        kyc: {
          ...h.kyc,
          idType: 'Passport',
          idNumber: 'P123',
          nationality: 'British',
          passportNo: 'P123',
          visaNo: 'V77',
        },
      }),
    );
    expect(inn.formC.missing).toEqual([
      'visaExpiry',
      'arrivedIndiaOn',
      'arrivedFrom',
      'nextDestination',
      'purpose',
    ]);
    const hours = (Date.parse(inn.formC.dueAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    // Not yet near the limit: nothing is sent. Six hours before it: once.
    expect(await hotelSweep(ctx.prisma, new Date(), w.companyId)).toMatchObject({ formC: 0 });
    const near = new Date(Date.now() + 19 * 3_600_000);
    expect(await hotelSweep(ctx.prisma, near, w.companyId)).toMatchObject({ formC: 1 });
    expect(await hotelSweep(ctx.prisma, near, w.companyId)).toMatchObject({ formC: 0 });
    expect((await h.events('hotel.form_c_due'))[0]).toMatchObject({
      guest: 'Emma Clark',
      number: b.number,
      hours: 24,
    });
    // Filing is refused until every field is there.
    const file = (kyc?: object) => h.desk.post(`/api/hotel/stays/${b.id}/form-c`, kyc ? { kyc } : {});
    expect((await file()).status).toBe(400);
    await ok(
      file({
        visaExpiry: '2027-03-31',
        arrivedIndiaOn: h.d(-2),
        arrivedFrom: 'London',
        nextDestination: 'Jaipur',
        purpose: 'Tourism',
      }),
    );
    expect((await h.stay(b.id)).formC).toMatchObject({ missing: [] });
    expect((await h.stay(b.id)).formC!.filedAt).toBeTruthy();
    // An Indian guest needs none.
    const local = await h.booked();
    await ok(h.checkIn(local.id, '102'));
    expect((await file()).status).toBe(200);
    expect((await h.desk.post(`/api/hotel/stays/${local.id}/form-c`, {})).status).toBe(409);
    // The FRRO file holds the foreign guest only.
    const text = await formCExport(
      ctx.prisma,
      { companyId: w.companyId, userId: h.r.steward.id, permissions: ['hosp.view'] },
      { branchId: h.branchId, from: h.d(0), to: h.d(3) },
    );
    expect(text).toContain('"Emma Clark","British","P123","V77","2027-03-31"');
    expect(text.split('\r\n')).toHaveLength(2);
  });

  it('H20, H21, H22, H23: an upgrade, a room move, early and late charges, a stay made longer in the house', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, { earlyFeePct: 50, lateFeePct: 50 }));
    // Booked a Deluxe, given a Suite at the Deluxe rate (a free upgrade), arriving at 08:00 → half a night.
    const a = await h.booked({ depart: h.d(2) });
    expect(await ok(h.checkIn(a.id, '201', { arrivedMin: 8 * 60 }))).toMatchObject({
      room: '201',
      earlyFee: 2000_00,
    });
    let s = await h.stay(a.id);
    expect(s).toMatchObject({ roomType: 'Deluxe', room: '201', total: 8000_00 });
    expect(s.folios[0]!.lines).toMatchObject([
      { kind: 'EARLY', text: 'Early check-in at 08:00', amount: 2000_00 },
    ]);
    // The first night is slept and charged; then the guest moves to 202 (201's AC failed).
    await h.audit();
    const move = (room: string, more: object = {}) =>
      h.desk.post(`/api/hotel/stays/${a.id}/room`, { roomId: h.rooms[room], ...more });
    expect(msg(await move('201'))).toBe('It is already in room 201');
    await ctx.prisma.room.update({ where: { id: h.rooms['202']! }, data: { hkStatus: 'DIRTY' } });
    expect(msg(await move('202'))).toBe('Room 202 is not ready');
    await ctx.prisma.room.update({ where: { id: h.rooms['202']! }, data: { hkStatus: 'CLEAN' } });
    await ok(move('202', { reason: 'AC not working' }));
    s = await h.stay(a.id);
    expect(s.nightly.map((n) => [n.room, n.posted])).toEqual([
      ['201', true],
      ['202', false],
    ]);
    expect(s.moves).toMatchObject([{ from: h.rooms['201'], to: h.rooms['202'], reason: 'AC not working' }]);
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['201']! } })).hkStatus).toBe(
      'DIRTY',
    );
    // One more night, asked while in the house: priced by the plan; the room is theirs for it.
    expect(await ok(h.desk.post(`/api/hotel/stays/${a.id}/dates`, { depart: h.d(3) }))).toMatchObject({
      added: 1,
    });
    expect((await h.stay(a.id)).nightly.map((n) => [n.day, n.room, n.rate])).toEqual([
      [h.d(0), '201', 4000_00],
      [h.d(1), '202', 4000_00],
      [h.d(2), '202', 4000_00],
    ]);
    // A night already charged cannot be given up; the arrival of a guest in the house cannot change.
    expect((await h.desk.post(`/api/hotel/stays/${a.id}/dates`, { arrive: h.d(1) })).status).toBe(409);
    // A paid upgrade: a Deluxe guest moves to a Suite and pays the Suite rate from tonight.
    const b = await h.booked({ arrive: h.d(1), depart: h.d(3) });
    await ok(h.checkIn(b.id, '101'));
    await ok(
      h.desk
        .post(`/api/hotel/stays/${b.id}/room`, { roomId: h.rooms['201'], rerate: true })
        .then(async (r) => {
          // 201 was dirty after the move out: it is cleaned first.
          if (r.status !== 200) {
            await ctx.prisma.room.update({ where: { id: h.rooms['201']! }, data: { hkStatus: 'CLEAN' } });
            return h.desk.post(`/api/hotel/stays/${b.id}/room`, { roomId: h.rooms['201'], rerate: true });
          }
          return r;
        }),
    );
    expect((await h.stay(b.id)).nightly.map((n) => n.rate)).toEqual([8000_00, 8000_00]);
    // Leaving late on the departure day: half the last night at 14:00, all of it after 18:00. Charged once.
    await h.audit();
    await h.audit();
    const outA = await h.desk.post(`/api/hotel/stays/${a.id}/check-out`, { leftMin: 14 * 60 });
    expect(outA.status).toBe(409);
    expect((outA.body as { error: { details: { lateFee: number } } }).error.details.lateFee).toBe(2000_00);
    expect((await h.desk.post(`/api/hotel/stays/${a.id}/check-out`, { leftMin: 19 * 60 })).status).toBe(409);
    expect((await h.stay(a.id)).folios[0]!.lines.filter((l) => l.kind === 'LATE')).toMatchObject([
      { amount: 2000_00, text: 'Late check-out at 14:00' },
    ]);
  });

  it('H25, H27, H28, H32, H33, H35: room charges by the night, extras, an allowance, the GST invoice by tariff slab, payment, check-out', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(
      w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
        extras: [{ key: 'laundry', name: 'Laundry', kind: 'LAUNDRY', price: 300_00, taxCode: 'GST18' }],
      }),
    );
    const dlx = await h.booked({ depart: h.d(1) });
    const ste = await h.booked({ depart: h.d(1), roomTypeId: h.types.suite });
    await ok(h.checkIn(dlx.id, '101'));
    await ok(h.checkIn(ste.id, '201'));
    const charge = (id: string, body: object) => h.desk.post(`/api/hotel/stays/${id}/charges`, body);
    await ok(charge(dlx.id, { extraKey: 'laundry', qty: 2 }));
    const cab = await ok<{ id: string }>(charge(dlx.id, { text: 'Airport cab', price: 1200_00 }));
    expect((await charge(dlx.id, { text: 'Bad tax', price: 100, taxCode: 'NOPE' })).status).toBe(400);
    await post(h.desk, `/api/hotel/stays/${dlx.id}/advance`, { modeId: h.r.modes.cash, amount: 2000_00 });
    // The night audit puts tonight's room on each folio.
    await h.audit();
    let f = (await h.stay(dlx.id)).folios[0]!;
    expect(f.lines.map((l) => [l.kind, l.amount, l.qty])).toEqual([
      ['LAUNDRY', 600_00, 2],
      ['EXTRA', 1200_00, 1],
      ['PAYMENT', 2000_00, 1],
      ['ROOM', 4000_00, 1],
    ]);
    expect(f.lines[3]!.text).toBe(`Room 101 — ${h.today.split('-').reverse().join('/')} (CP)`);
    // Room ₹4,000 at 12 % (₹480) + laundry ₹600 at 18 % (₹108) + cab ₹1,200 untaxed = ₹6,388; ₹2,000 paid.
    expect(f).toMatchObject({ charges: 5800_00, tax: 588_00, total: 6388_00, paid: 2000_00, due: 4388_00 });
    // An allowance: the desk cannot take a charge off, a supervisor can, with why.
    expect(
      (await h.desk.post(`/api/hotel/folio-lines/${cab.id}/void`, { reason: 'Hotel car was late' })).status,
    ).toBe(403);
    await ok(h.sup.post(`/api/hotel/folio-lines/${cab.id}/void`, { reason: 'Hotel car was late' }));
    f = (await h.stay(dlx.id)).folios[0]!;
    expect(f).toMatchObject({ total: 5188_00, due: 3188_00 });
    // Check-out is refused while the folio is open; too much or too little money is refused.
    expect((await h.desk.post(`/api/hotel/stays/${dlx.id}/check-out`, { leftMin: 600 })).status).toBe(409);
    const settle = (id: string, payments: object[]) =>
      h.desk.post(`/api/hotel/folios/${id}/settle`, { payments });
    expect((await settle(f.id, [{ modeId: h.r.modes.cash, amount: 4000_00 }])).status).toBe(400);
    expect(msg(await settle(f.id, [{ modeId: h.r.modes.cash, amount: 1000_00 }]))).toBe(
      '₹2,188.00 is still to pay on this folio',
    );
    const closed = await ok<FolioOut>(
      settle(f.id, [
        { modeId: h.r.modes.cash, amount: 1188_00 },
        { modeId: h.r.modes.card, amount: 2000_00, reference: 'AUTH-1' },
      ]),
    );
    expect(closed).toMatchObject({ status: 'CLOSED', due: 0, advanceLeft: 0 });
    // The invoice: a tax invoice in the guest's name, the room taxed at 12 %.
    const inv = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: closed.invoice!.id } });
    expect(inv).toMatchObject({
      type: 'INVOICE',
      status: 'PAID',
      total: 5188_00n,
      tax: 588_00n,
      sourceType: 'folio',
    });
    const lines = inv.lines as { item: string; taxPercent: number; taxable: number }[];
    expect(lines.map((l) => [l.taxPercent, l.taxable])).toEqual([
      [18, 600_00],
      [12, 4000_00],
    ]);
    // The Suite's ₹8,000 night falls in the 18 % slab.
    const sf = (await h.stay(ste.id)).folios[0]!;
    expect(sf).toMatchObject({ charges: 8000_00, tax: 1440_00, total: 9440_00 });
    // Check-out: the room goes to housekeeping; a closed folio takes nothing more.
    expect(await ok(h.desk.post(`/api/hotel/stays/${dlx.id}/check-out`, { leftMin: 600 }))).toMatchObject({
      status: 'CHECKED_OUT',
      lateFee: 0,
    });
    expect((await ctx.prisma.room.findUniqueOrThrow({ where: { id: h.rooms['101']! } })).hkStatus).toBe(
      'DIRTY',
    );
    expect(msg(await charge(dlx.id, { extraKey: 'laundry' }))).toBe('The guest is not in the hotel');
    // After the invoice, a correction is a credit note against it.
    expect(
      (
        await h.desk.post(`/api/hotel/folios/${f.id}/credit`, {
          amount: 500_00,
          reason: 'Laundry returned damaged',
        })
      ).status,
    ).toBe(403);
    const note = await ok<{ number: string; total: number }>(
      h.sup.post(`/api/hotel/folios/${f.id}/credit`, { amount: 500_00, reason: 'Laundry returned damaged' }),
    );
    expect(note.number).toMatch(/^CN\//);
    expect(note.total).toBe(500_00);
  });
});
