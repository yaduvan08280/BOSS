import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { add, bill, ok, order, pay, post, type CheckOut } from './pos-kit';
import { reservationSweep } from './res-jobs';
import { hostDesk, type ResOut } from './res-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Wait = {
  id: string;
  name: string;
  status: string;
  quotedMin: number | null;
  order: { id: string; number: number } | null;
};
describe(
  'Reservations: deposits, seating, no-shows, the waitlist, guests (phase 16)',
  { timeout: 30_000 },
  () => {
    it('R11, R12, R16: a large party pays a deposit to be confirmed, is seated on a POS order, and the deposit is used on the bill', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      await ok(
        w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
          depositFrom: 6,
          depositPerHeadPaise: 100_00,
        }),
      );
      const b = await h.reserve({
        partySize: 6,
        guest: { name: 'Rohit Bansal', mobile: '9829066666' },
        occasion: 'Anniversary',
      });
      // It waits for the money: the guest is asked for ₹600, and it cannot be confirmed without it.
      expect(b).toMatchObject({
        status: 'REQUESTED',
        deposit: { amount: 600_00, state: 'DUE' },
        tables: ['T4'],
      });
      expect((await h.events('reservation.deposit_due'))[0]).toMatchObject({
        amount: '₹600.00',
        customerMobile: '+919829066666',
      });
      expect((await h.act(b.id, 'confirm')).status).toBe(409);
      // UPI needs its reference; paid, an ADVANCE paper is raised in the guest's name and the booking is confirmed.
      expect((await s.post(`/api/reservations/${b.id}/deposit`, { modeId: h.r.modes.upi })).status).toBe(400);
      const paid = await ok<ResOut>(
        s.post(`/api/reservations/${b.id}/deposit`, { modeId: h.r.modes.upi, reference: 'UPI-778' }),
      );
      expect(paid).toMatchObject({ status: 'CONFIRMED', deposit: { state: 'PAID' } });
      const advance = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: paid.deposit!.billId! } });
      expect(advance).toMatchObject({
        type: 'ADVANCE',
        status: 'ISSUED',
        total: 600_00n,
        settled: 0n,
        sourceType: 'reservation',
      });
      expect(advance.number).toMatch(/^ADV\//);
      expect(await h.events('reservation.confirmed')).toHaveLength(1);
      expect((await s.post(`/api/reservations/${b.id}/deposit`, { modeId: h.r.modes.cash })).status).toBe(
        409,
      );
      // Seating opens the order on the booked table with the covers, the name and what the kitchen should know.
      const seated = await ok<ResOut>(h.act(b.id, 'seat'));
      expect(seated).toMatchObject({ status: 'SEATED' });
      const o = await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: seated.order!.id } });
      expect(o).toMatchObject({
        tableIds: [h.r.t.T4],
        covers: 6,
        guestName: 'Rohit Bansal',
        note: 'Anniversary',
        reservationId: b.id,
        guestId: b.guest!.id,
        partyId: advance.partyId,
      });
      expect((await h.act(b.id, 'seat')).status).toBe(409);
      // Dinner: ₹320 + ₹280 = ₹600, service charge ₹60, GST ₹30 → ₹690. The deposit covers ₹600; ₹90 in cash.
      await add(s, o.id, [{ menuItemId: h.r.m.tikka, variantKey: 'full' }, { menuItemId: h.r.m.dal }]);
      const c = await bill(s, o.id);
      expect(c.total).toBe(690_00);
      expect(await ok(s.get(`/api/pos/orders/${o.id}/advance`))).toMatchObject({ advance: { left: 600_00 } });
      const used = await post<CheckOut>(s, `/api/pos/checks/${c.id}/advance`);
      expect(used).toMatchObject({ status: 'OPEN', due: 90_00 });
      expect(used.payments).toMatchObject([{ kind: 'ADVANCE', amount: 600_00 }]);
      expect((await s.post(`/api/pos/checks/${c.id}/advance`, {})).status).toBe(409);
      const done = await pay(s, c.id, [{ modeId: h.r.modes.cash, amount: 90_00 }]);
      expect(done).toMatchObject({ status: 'PAID', due: 0, orderStatus: 'PAID' });
      // The advance is fully set against the invoice; the booking finished by itself with its deposit used.
      expect((await ctx.prisma.bill.findUniqueOrThrow({ where: { id: advance.id } })).settled).toBe(600_00n);
      const invoice = await ctx.prisma.bill.findFirstOrThrow({
        where: { companyId: w.companyId, number: c.number },
      });
      expect(invoice).toMatchObject({ status: 'PAID', partyId: advance.partyId });
      const after = await ok<ResOut>(s.get(`/api/reservations/${b.id}`));
      expect(after).toMatchObject({ status: 'FINISHED', deposit: { state: 'USED' } });
    });

    it('R16: a cancelled bill gives the deposit back to the guest’s advance, to be used again', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      await ok(
        w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
          depositFrom: 2,
          depositPerHeadPaise: 50_00,
        }),
      );
      const b = await h.reserve();
      const paid = await ok<ResOut>(s.post(`/api/reservations/${b.id}/deposit`, { modeId: h.r.modes.cash }));
      const seated = await ok<ResOut>(h.act(b.id, 'seat'));
      await add(s, seated.order!.id, [{ menuItemId: h.r.m.dal }]);
      const c = await bill(s, seated.order!.id);
      await post(s, `/api/pos/checks/${c.id}/advance`);
      await ok(h.r.manager.api.post(`/api/pos/checks/${c.id}/cancel`, { reason: 'Wrong table billed' }));
      const advance = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: paid.deposit!.billId! } });
      expect(advance).toMatchObject({ status: 'ISSUED', settled: 0n });
      expect((await ok<ResOut>(s.get(`/api/reservations/${b.id}`))).deposit).toMatchObject({ state: 'PAID' });
      expect((await order(s, seated.order!.id)).status).toBe('OPEN');
      const again = await bill(s, seated.order!.id);
      expect((await post<CheckOut>(s, `/api/pos/checks/${again.id}/advance`)).payments).toMatchObject([
        { kind: 'ADVANCE', amount: 100_00 },
      ]);
    });

    it('R14: a no-show — by the clock once the hold time has passed; the deposit kept or owed back by the rule', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      await ok(
        w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
          depositFrom: 6,
          depositPerHeadPaise: 100_00,
          holdMin: 15,
        }),
      );
      const plain = await h.reserve();
      const big = await h.reserve({ partySize: 6 });
      await ok(s.post(`/api/reservations/${big.id}/deposit`, { modeId: h.r.modes.cash }));
      const asked = await h.reserve({ partySize: 6, startMin: 22 * 60 });
      const start = (
        await ctx.prisma.reservation.findUniqueOrThrow({ where: { id: plain.id } })
      ).startAt.getTime();
      const at = (min: number) => new Date(start + min * 60_000);
      // Ten minutes late the table is still held; after fifteen both are no-shows.
      expect(await reservationSweep(ctx.prisma, at(10), w.companyId)).toMatchObject({ noShows: 0 });
      expect(await reservationSweep(ctx.prisma, at(16), w.companyId)).toMatchObject({
        noShows: 2,
        lapsed: 0,
      });
      expect(await ok<ResOut>(s.get(`/api/reservations/${plain.id}`))).toMatchObject({
        status: 'NO_SHOW',
        deposit: null,
      });
      expect(await ok<ResOut>(s.get(`/api/reservations/${big.id}`))).toMatchObject({
        status: 'NO_SHOW',
        deposit: { state: 'KEPT', amount: 600_00 },
      });
      const told = await h.events('reservation.no_show');
      expect(told).toHaveLength(2);
      expect(told.map((t) => t.deposit).sort()).toEqual(['', 'The deposit of ₹600.00 is not returned.']);
      // A request whose deposit never came lapses at its time.
      expect(await reservationSweep(ctx.prisma, at(181), w.companyId)).toMatchObject({ lapsed: 1 });
      expect(await ok<ResOut>(s.get(`/api/reservations/${asked.id}`))).toMatchObject({
        status: 'CANCELLED',
        deposit: null,
      });
      // A kept deposit is returned only by an approver's goodwill: the advance paper is voided.
      expect((await s.post(`/api/reservations/${big.id}/deposit/refund`, {})).status).toBe(403);
      const back = await ok<ResOut>(
        h.r.manager.api.post(`/api/reservations/${big.id}/deposit/refund`, { reason: 'Medical emergency' }),
      );
      expect(back.deposit).toMatchObject({ state: 'REFUNDED' });
      expect((await ctx.prisma.bill.findUniqueOrThrow({ where: { id: back.deposit!.billId! } })).status).toBe(
        'CANCELLED',
      );
      // With the other rule a no-show's deposit is owed back.
      await ok(w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, { noShowDeposit: 'REFUND' }));
      const other = await h.reserve({ partySize: 6, startMin: 12 * 60 });
      await ok(s.post(`/api/reservations/${other.id}/deposit`, { modeId: h.r.modes.cash }));
      expect((await ok<ResOut>(h.act(other.id, 'noShow'))).deposit).toMatchObject({ state: 'REFUND_DUE' });
    });

    it('R15: cancelling — in time the deposit is owed back and any host returns it; too late it is kept', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      await ok(
        w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
          depositFrom: 6,
          depositPerHeadPaise: 100_00,
          cancelFreeHours: 4,
        }),
      );
      const early = await h.reserve({ partySize: 6 });
      await ok(s.post(`/api/reservations/${early.id}/deposit`, { modeId: h.r.modes.cash }));
      const out = await ok<ResOut>(h.act(early.id, 'cancel', { reason: 'Plans changed' }));
      expect(out).toMatchObject({ status: 'CANCELLED', deposit: { state: 'REFUND_DUE' } });
      expect((await h.events('reservation.cancelled'))[0]).toMatchObject({
        deposit: 'The deposit of ₹600.00 will be returned.',
      });
      expect(
        (await ok<ResOut>(s.post(`/api/reservations/${early.id}/deposit/refund`, {}))).deposit,
      ).toMatchObject({ state: 'REFUNDED' });
      expect((await s.post(`/api/reservations/${early.id}/deposit/refund`, {})).status).toBe(409);
      // Inside four hours of the booking the deposit stays (the booking's time is moved close to now).
      const late = await h.reserve({ partySize: 6, startMin: 13 * 60 });
      await ok(s.post(`/api/reservations/${late.id}/deposit`, { modeId: h.r.modes.cash }));
      await ctx.prisma.reservation.update({
        where: { id: late.id },
        data: { startAt: new Date(Date.now() + 3_600_000), endAt: new Date(Date.now() + 3 * 3_600_000) },
      });
      const kept = await ok<ResOut>(h.act(late.id, 'cancel'));
      expect(kept.deposit).toMatchObject({ state: 'KEPT' });
      // A booking with nothing paid simply ends.
      const none = await h.reserve({ partySize: 6, startMin: 16 * 60 });
      expect((await ok<ResOut>(h.act(none.id, 'cancel'))).deposit).toBeNull();
    });

    it('R17, R18: the waitlist — a quoted wait, "your table is ready", seated on a POS order, or left', async () => {
      const w = await world(ctx.app);
      const h = await hostDesk(ctx.prisma, w);
      const s = h.r.steward.api;
      const quote = async (size: number) =>
        (
          await ok<{ minutes: number | null }>(
            s.get(`/api/reservations/outlets/${h.r.outlet}/quote?size=${size}`),
          )
        ).minutes;
      // An empty floor: no wait. Nobody seats twenty.
      expect(await quote(6)).toBe(0);
      expect(await quote(20)).toBeNull();
      expect(
        (
          await s.post('/api/reservations/waitlist', {
            outletId: h.r.outlet,
            partySize: 20,
            name: 'Big group',
          })
        ).status,
      ).toBe(409);
      // The only six-top was taken twenty minutes ago by a party of six (150 minutes): about 130 to go.
      const running = await post<{ id: string }>(s, '/api/pos/orders', {
        outletId: h.r.outlet,
        tableIds: [h.r.t.T4],
        covers: 6,
      });
      await ctx.prisma.posOrder.update({
        where: { id: running.id },
        data: { openedAt: new Date(Date.now() - 20 * 60_000) },
      });
      expect(await quote(6)).toBe(130);
      const first = await post<Wait>(s, '/api/reservations/waitlist', {
        outletId: h.r.outlet,
        partySize: 6,
        name: 'Verma family',
        mobile: '9829077777',
      });
      expect(first).toMatchObject({ status: 'WAITING', quotedMin: 130 });
      // The next six wait for the table to turn again.
      const second = await post<Wait>(s, '/api/reservations/waitlist', {
        outletId: h.r.outlet,
        partySize: 5,
        name: 'Walk-in five',
      });
      expect(second.quotedMin).toBe(280);
      const list = await ok<{ waiting: Wait[] }>(s.get(`/api/reservations/outlets/${h.r.outlet}/waitlist`));
      expect(list.waiting.map((x) => x.name)).toEqual(['Verma family', 'Walk-in five']);
      // The table frees: the first party is called (a message to their mobile) and seated; the other leaves.
      await ok(s.post(`/api/pos/orders/${running.id}/cancel`, {}));
      expect(
        (await ok<Wait>(s.post(`/api/reservations/waitlist/${first.id}/act`, { action: 'call' }))).status,
      ).toBe('CALLED');
      expect((await h.events('reservation.table_ready'))[0]).toMatchObject({
        customer: 'Verma family',
        customerMobile: '+919829077777',
        outlet: 'Rooftop',
      });
      expect((await s.post(`/api/reservations/waitlist/${first.id}/act`, { action: 'seat' })).status).toBe(
        400,
      );
      const seated = await ok<Wait>(
        s.post(`/api/reservations/waitlist/${first.id}/act`, { action: 'seat', tableIds: [h.r.t.T4] }),
      );
      expect(seated.status).toBe('SEATED');
      const o = await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: seated.order!.id } });
      expect(o).toMatchObject({ covers: 6, guestName: 'Verma family', tableIds: [h.r.t.T4] });
      expect(o.guestId).toBeTruthy();
      expect(
        (await ok<Wait>(s.post(`/api/reservations/waitlist/${second.id}/act`, { action: 'leave' }))).status,
      ).toBe('LEFT');
      expect(
        (
          await s.post(`/api/reservations/waitlist/${second.id}/act`, {
            action: 'seat',
            tableIds: [h.r.t.T2],
          })
        ).status,
      ).toBe(409);
      expect(
        await ok<{ waiting: Wait[]; earlier: Wait[] }>(
          s.get(`/api/reservations/outlets/${h.r.outlet}/waitlist`),
        ),
      ).toMatchObject({
        waiting: [],
        earlier: [{ name: 'Walk-in five' }, { name: 'Verma family' }],
      });
    });
  },
);
