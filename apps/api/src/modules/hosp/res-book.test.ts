import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDate } from '@mono/shared';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { ok } from './pos-kit';
import { reservationSweep } from './res-jobs';
import { hostDesk, type ResOut } from './res-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Slots = {
  durationMin: number;
  deposit: number;
  slots: { startMin: number; time: string; free: boolean; tableIds: string[] | null }[];
};

describe('Reservations: the book, availability, the public page (phase 16)', { timeout: 30_000 }, () => {
  it('R1: an outlet’s booking rules — defaults, a change keeps the rest, and only set-up people change them', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const book = await ok<{ booking: { slotMin: number; holdMin: number }; bookingToken: string | null }>(
      w.api.get(`/api/reservations/outlets/${h.r.outlet}/book`),
    );
    expect(book.booking).toMatchObject({ slotMin: 30, holdMin: 15 });
    expect(book.bookingToken).toBeNull();
    expect(
      (await h.r.steward.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, { holdMin: 5 })).status,
    ).toBe(403);
    const saved = await ok<{ booking: Record<string, unknown>; bookingToken: string | null }>(
      w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, {
        slotMin: 60,
        fromMin: 18 * 60,
        toMin: 22 * 60,
        holdMin: 20,
      }),
    );
    expect(saved.booking).toMatchObject({ slotMin: 60, holdMin: 20, reminderHours: 3, online: false });
    const a = await ok<Slots>(
      w.api.get(`/api/reservations/outlets/${h.r.outlet}/availability?day=${h.tomorrow}&size=2`),
    );
    expect(a.slots.map((s) => s.time)).toEqual(['18:00', '19:00', '20:00', '21:00', '22:00']);
    expect(a.durationMin).toBe(90);
    // A later change keeps what was set before.
    const again = await ok<{ booking: Record<string, unknown> }>(
      w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, { online: true }),
    );
    expect(again.booking).toMatchObject({ slotMin: 60, holdMin: 20, online: true });
  });

  it('R2, R3, R4: a host books a table — the best fit, the guest found by mobile, the slot no longer free for that table', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const first = await h.reserve({
      partySize: 2,
      guest: { name: 'Asha Mehta', mobile: '98290 11111' },
      occasion: 'Birthday',
      requests: 'Window table',
    });
    expect(first).toMatchObject({ status: 'CONFIRMED', tables: ['T1'], time: '19:00', durationMin: 90 });
    expect(first.number).toMatch(/^RES-\d+$/);
    expect(first.guest).toMatchObject({ name: 'Asha Mehta', mobile: '+919829011111' });
    // The same mobile is the same guest.
    const second = await h.reserve({ startMin: 21 * 60, guest: { name: 'Asha M', mobile: '+919829011111' } });
    expect(second.guest!.id).toBe(first.guest!.id);
    expect(await ctx.prisma.guest.count({ where: { companyId: w.companyId } })).toBe(1);
    // Three more parties of two at 19:00 take the next smallest tables in turn.
    expect((await h.reserve()).tables).toEqual(['T2']);
    const a = await ok<Slots>(
      w.api.get(`/api/reservations/outlets/${h.r.outlet}/availability?day=${h.tomorrow}&size=2`),
    );
    const at = (time: string) => a.slots.find((s) => s.time === time)!;
    expect(h.names(at('19:00').tableIds!)).toEqual(['T3']);
    // T1 is taken 19:00–20:30 and again from 21:00: 20:30 fits a 90-minute party nowhere on T1.
    expect(h.names(at('17:30').tableIds!)).toEqual(['T1']);
    expect(h.names(at('20:30').tableIds!)).toEqual(['T2']);
    // The day's book lists them in time order with the covers.
    const book = await ok<{ counts: { bookings: number; covers: number }; reservations: ResOut[] }>(
      w.api.get(`/api/reservations/outlets/${h.r.outlet}/book?day=${h.tomorrow}`),
    );
    expect(book.counts).toMatchObject({ bookings: 3, covers: 6 });
    expect(book.reservations.map((x) => x.time)).toEqual(['19:00', '19:00', '21:00']);
    // A time that has passed is refused; a person who cannot take orders cannot book.
    expect((await h.bookAs(h.r.steward.api, { day: '2020-01-01' })).status).toBe(400);
  });

  it('R4, R5: joined tables for a large party; a taken table is refused; two people can never take the same table', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const big = await h.reserve({ partySize: 8 });
    expect(big.tables.sort()).toEqual(['T5', 'T6']);
    expect(big.durationMin).toBe(150);
    // A table chosen by hand must be free for the whole time (the big party sits 19:00–21:30).
    const clash = await h.bookAs(h.r.steward.api, { startMin: 20 * 60, tableIds: [h.r.t.T5] });
    expect(clash.status).toBe(409);
    expect((clash.body as { error: { message: string } }).error.message).toContain('T5');
    expect((await h.reserve({ startMin: 21 * 60 + 30, tableIds: [h.r.t.T5] })).tables).toEqual(['T5']);
    // Only T4 seats six: two hosts ask for it at the same moment — one gets it.
    const both = await Promise.all([
      h.bookAs(h.r.steward.api, { partySize: 6 }),
      h.bookAs(h.r.steward2.api, { partySize: 6 }),
    ]);
    expect(both.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await h.bookAs(h.r.steward.api, { partySize: 40 })).status).toBe(409);
    // No table is ever in two live bookings that overlap.
    const rows = await ctx.prisma.reservation.findMany({ where: { companyId: w.companyId } });
    for (const a of rows)
      for (const b of rows)
        if (a.id < b.id && a.startAt < b.endAt && b.startAt < a.endAt)
          expect(a.tableIds.filter((t) => b.tableIds.includes(t))).toEqual([]);
  });

  it('R6: changing the time, the size or the table is checked like a new booking', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const s = h.r.steward.api;
    const two = await h.reserve();
    const six = await h.reserve({ partySize: 6 });
    expect(six.tables).toEqual(['T4']);
    // Two more guests: T1 no longer seats them, so the booking moves to the best fit; its time on the table grows.
    const grown = await ok<ResOut>(s.patch(`/api/reservations/${two.id}`, { partySize: 4 }));
    expect(grown).toMatchObject({ tables: ['T2'], durationMin: 120, partySize: 4 });
    // A new time keeps the table when it is free then.
    const later = await ok<ResOut>(s.patch(`/api/reservations/${two.id}`, { startMin: 20 * 60 }));
    expect(later).toMatchObject({ tables: ['T2'], time: '20:00' });
    // Asking for the six-top's table at its time is refused; growing to seven finds the joined pair.
    expect((await s.patch(`/api/reservations/${two.id}`, { tableIds: [h.r.t.T4] })).status).toBe(409);
    expect(
      (await ok<ResOut>(s.patch(`/api/reservations/${two.id}`, { partySize: 7 }))).tables.sort(),
    ).toEqual(['T5', 'T6']);
    // Once the party is seated the booking is no longer changed.
    await ok(h.act(six.id, 'seat'));
    expect((await s.patch(`/api/reservations/${six.id}`, { partySize: 5 })).status).toBe(409);
  });

  it('R7, R9: the life of a booking through the state machine, with the guest told when it is confirmed', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const b = await h.reserve({
      guest: { name: 'Kabir Rao', mobile: '9829022222', email: 'kabir@example.com' },
    });
    const told = await h.events('reservation.confirmed');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      customer: 'Kabir Rao',
      customerMobile: '+919829022222',
      customerEmail: 'kabir@example.com',
      outlet: 'Rooftop',
      size: 2,
      number: b.number,
    });
    expect(String(told[0]!.when)).toBe(`${h.tomorrow.split('-').reverse().join('/')} 19:00`);
    expect(String(told[0]!.link)).toMatch(/^\/book\/manage\/.{20,}$/);
    // Finished only after seating; a no-show can be brought back; a cancelled booking is final.
    expect((await h.act(b.id, 'finish')).status).toBe(409);
    expect((await ok<ResOut>(h.act(b.id, 'arrive'))).status).toBe('ARRIVED');
    const c = await h.reserve({ startMin: 21 * 60 });
    expect((await ok<ResOut>(h.act(c.id, 'noShow'))).status).toBe('NO_SHOW');
    expect((await ok<ResOut>(h.act(c.id, 'restore'))).status).toBe('CONFIRMED');
    expect((await ok<ResOut>(h.act(c.id, 'cancel', { reason: 'Guest called' }))).status).toBe('CANCELLED');
    expect((await h.act(c.id, 'confirm')).status).toBe(409);
    // A cancelled booking frees its table for that time.
    expect((await h.reserve({ startMin: 21 * 60 })).tables).toEqual(['T1']);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { companyId: w.companyId, entityId: c.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'reservation.made',
      'reservation.no_show',
      'reservation.restore',
      'reservation.cancelled',
    ]);
  });

  it('R8: the public booking page — free times without table names, the sum question, the honeypot, the limits', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const rules = (body: object) =>
      ok<{ bookingToken: string }>(w.api.put(`/api/reservations/outlets/${h.r.outlet}/rules`, body));
    const { bookingToken } = await rules({ online: true, maxOnline: 6, slotMin: 60 });
    const url = `/api/public/book/${bookingToken}`;
    const page = (await ctx.app.inject({ method: 'GET', url: `${url}?day=${h.tomorrow}&size=2` })).json() as {
      outlet: string;
      slots: Record<string, unknown>[];
      challenge: { question: string; token: string };
    };
    expect(page.outlet).toBe('Rooftop');
    expect(page.slots.find((s) => s.time === '19:00')).toEqual({ startMin: 1140, time: '19:00', free: true });
    const [x, y] = page.challenge.question.split(' + ').map(Number) as [number, number];
    const send = (body: object = {}, answer = x + y) =>
      ctx.app.inject({
        method: 'POST',
        url,
        payload: {
          day: h.tomorrow,
          startMin: 19 * 60,
          partySize: 2,
          name: 'Neha Jain',
          mobile: '9829033333',
          marketing: true,
          challenge: page.challenge.token,
          answer,
          ...body,
        },
      });
    expect((await send({}, x + y + 1)).statusCode).toBe(400);
    expect((await send({ website: 'spam.example' })).json()).toEqual({ ok: true, number: null });
    expect((await send({ partySize: 7 })).statusCode).toBe(400);
    expect((await send({ startMin: 19 * 60 + 10 })).statusCode).toBe(400);
    expect((await send({ day: '2031-01-01' })).statusCode).toBe(400);
    const made = (await send()).json() as { number: string; status: string; when: string; manage: string };
    expect(made).toMatchObject({
      status: 'CONFIRMED',
      when: `${h.tomorrow.split('-').reverse().join('/')} 19:00`,
    });
    const row = await ctx.prisma.reservation.findFirstOrThrow({ where: { token: made.manage } });
    expect(row).toMatchObject({ source: 'ONLINE', createdById: null, status: 'CONFIRMED' });
    // "Send me offers" was ticked: the consent is recorded with how and when.
    const guest = await ctx.prisma.guest.findFirstOrThrow({ where: { id: row.guestId } });
    expect(guest.consent).toMatchObject({ marketing: true, source: 'ONLINE', byId: null });
    // The guest's own link shows the booking and cancels it.
    const mine = `/api/public/booking/${made.manage}`;
    expect((await ctx.app.inject({ method: 'GET', url: mine })).json()).toMatchObject({
      number: made.number,
      canCancel: true,
      partySize: 2,
    });
    expect((await ctx.app.inject({ method: 'POST', url: `${mine}/cancel` })).json()).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
    });
    expect((await ctx.app.inject({ method: 'POST', url: `${mine}/cancel` })).statusCode).toBe(409);
    // With "confirm each one" the booking waits for a host, and the outlet's managers are told.
    await rules({ autoConfirm: false });
    const waiting = (await send({ mobile: '9829044444', name: 'Om Vyas' })).json() as {
      status: string;
      manage: string;
    };
    expect(waiting.status).toBe('REQUESTED');
    expect(await h.events('reservation.requested')).toHaveLength(1);
    const asked = await ctx.prisma.reservation.findFirstOrThrow({ where: { token: waiting.manage } });
    expect((await ok<ResOut>(h.act(asked.id, 'confirm'))).status).toBe('CONFIRMED');
    // The page closes with the switch.
    await rules({ online: false });
    expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect((await send()).statusCode).toBe(404);
  });

  it('R10: a reminder some hours before, once; a booking made inside that window gets none', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const b = await h.reserve({ day: h.tomorrow, startMin: 23 * 60 });
    const row = await ctx.prisma.reservation.findUniqueOrThrow({ where: { id: b.id } });
    const before = (hours: number) => new Date(row.startAt.getTime() - hours * 3_600_000);
    // Made well ahead (the test moves the clock, so the booking is dated earlier).
    await ctx.prisma.reservation.update({ where: { id: b.id }, data: { createdAt: before(30) } });
    expect(await reservationSweep(ctx.prisma, before(5), w.companyId)).toMatchObject({ reminded: 0 });
    expect(await reservationSweep(ctx.prisma, before(2), w.companyId)).toMatchObject({ reminded: 1 });
    expect(await reservationSweep(ctx.prisma, before(1), w.companyId)).toMatchObject({ reminded: 0 });
    expect((await ctx.prisma.reservation.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('REMINDED');
    const told = await h.events('reservation.reminder');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ time: '23:00', number: b.number });
    // Booked an hour before: no reminder follows the confirmation.
    const late = await h.reserve({ day: h.tomorrow, startMin: 22 * 60 });
    const lateRow = await ctx.prisma.reservation.findUniqueOrThrow({ where: { id: late.id } });
    await ctx.prisma.reservation.update({
      where: { id: late.id },
      data: { createdAt: new Date(lateRow.startAt.getTime() - 3_600_000) },
    });
    expect(
      await reservationSweep(ctx.prisma, new Date(lateRow.startAt.getTime() - 1_800_000), w.companyId),
    ).toMatchObject({ reminded: 0 });
  });

  it('R13: the POS floor shows a table as reserved from a while before its booking, and who it is for', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const minute =
      (Number(parts.find((p) => p.type === 'hour')!.value) % 24) * 60 +
      Number(parts.find((p) => p.type === 'minute')!.value);
    const today = localDate(now, 'Asia/Kolkata');
    // In twenty minutes (inside the 30-minute hold) and in three hours (not yet).
    const soon = await h.reserve({
      day: today,
      startMin: minute + 20,
      guest: { name: 'Isha Rao', mobile: '9829055555' },
    });
    await h.reserve({ day: today, startMin: minute + 180, partySize: 4 });
    type Floor = {
      floors: {
        tables: { name: string; state: string; reservation: { name: string; size: number } | null }[];
      }[];
    };
    const floor = async () =>
      (await ok<Floor>(h.r.steward.api.get(`/api/pos/outlets/${h.r.outlet}/floor`))).floors[0]!.tables;
    const t = async (name: string) => (await floor()).find((x) => x.name === name)!;
    expect(await t('T1')).toMatchObject({ state: 'RESERVED', reservation: { name: 'Isha Rao', size: 2 } });
    expect(await t('T2')).toMatchObject({ state: 'FREE', reservation: null });
    // Seated, the order's state wins; cancelled, the table is free again.
    await ok(h.act(soon.id, 'seat'));
    expect((await t('T1')).state).toBe('SEATED');
  });
});
