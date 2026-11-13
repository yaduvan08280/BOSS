import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { ok, property, type Property } from '../hotel/hotel-kit';
import { world } from '../records/testkit';
import { applyChannelBooking, overbooked, pullBookings, pushAri, retryPushes } from './channel';
import { actor, outside } from './connect-kit';
import { integrationHealth } from './health';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Conn = {
  id: string;
  hasSecret: boolean;
  hookPath: string;
  pending: number;
  failed: number;
  lastError: string | null;
};
const connect = (h: Property, more: object = {}) =>
  h.w.api.put('/api/connect/connections', {
    kind: 'CHANNEL',
    branchId: h.branchId,
    provider: 'GENERIC',
    baseUrl: 'https://cm.example.com/v1/',
    secret: { token: 'cm-token-1' },
    rooms: [{ roomTypeId: h.types.deluxe, code: 'DLX' }],
    plans: [{ ratePlanId: h.plans.cp, code: 'BB' }],
    defaultPlanId: h.plans.cp,
    ...more,
  });
const booking = (h: Property, ref: string, more: object = {}) => ({
  ref,
  channel: 'Booking.com',
  room: 'DLX',
  rate: 'BB',
  arrive: h.d(3),
  depart: h.d(5),
  adults: 2,
  guest: { name: 'Otto Traveller', phone: '+4915112345678' },
  total: 9000_00,
  ...more,
});

describe('Integrations: connections and the channel manager (phase 19)', { timeout: 90_000 }, () => {
  it('X1: a connection is saved by integration admins only; its keys are encrypted and never sent back', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    expect((await h.desk.put('/api/connect/connections', { kind: 'CHANNEL' })).status).toBe(403);
    // A new connection needs its keys.
    expect((await connect(h, { secret: undefined })).status).toBe(400);
    const c = await ok<Conn>(connect(h));
    expect(c).toMatchObject({ hasSecret: true, provider: 'GENERIC', branchId: h.branchId });
    expect(JSON.stringify(c)).not.toContain('cm-token-1');
    const row = await ctx.prisma.connection.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.secret).toBeTruthy();
    expect(row.secret).not.toContain('cm-token-1');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { companyId: w.companyId, action: 'integration.connected' },
    });
    expect(JSON.stringify(audit.after)).not.toContain('cm-token-1');
    // A later save without keys keeps them; another provider must bring its own.
    expect(
      await ok<Conn>(connect(h, { secret: undefined, baseUrl: 'https://cm.example.com/v2' })),
    ).toMatchObject({
      hasSecret: true,
    });
    expect((await connect(h, { secret: undefined, provider: 'OTHER' })).status).toBe(400);
    // Taken off: switched off and the keys wiped; the log stays.
    await ok(w.api.del(`/api/connect/connections/CHANNEL?branchId=${h.branchId}`));
    expect(await ctx.prisma.connection.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      active: false,
      secret: null,
    });
  });

  it('X2, X3: availability, price and restrictions are pushed for mapped room types; a failed push is tried again', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(connect(h));
    const manager = await actor(ctx.prisma, w.companyId, h.r.manager.id);
    const steward = await actor(ctx.prisma, w.companyId, h.r.steward.id);
    // Two of the four Deluxe rooms are sold tomorrow, and that day is closed to arrival.
    await h.booked({ arrive: h.d(1), depart: h.d(2) });
    await h.booked({ arrive: h.d(1), depart: h.d(2) });
    await ok(
      h.sup.put('/api/hotel/room-days', {
        branchId: h.branchId,
        roomTypeIds: [h.types.deluxe],
        from: h.d(1),
        to: h.d(2),
        closedToArrival: true,
        minStay: 2,
      }),
    );
    const good = outside();
    const span = { branchId: h.branchId, from: h.d(0), to: h.d(3) };
    await expect(pushAri(ctx.prisma, good.net, steward, span)).rejects.toMatchObject({ status: 403 });
    expect(await pushAri(ctx.prisma, good.net, manager, span)).toMatchObject({ sent: 3, ok: true });
    const call = good.calls[0]!;
    expect(call).toMatchObject({ url: 'https://cm.example.com/v1/ari', method: 'POST' });
    expect(call.headers.authorization).toBe('Bearer cm-token-1');
    const rows = (call.body as { rows: Record<string, unknown>[] }).rows;
    // Only the mapped type (Deluxe), by its code, at the mapped plan's price; suites are not sent.
    expect(rows.map((r) => r.room)).toEqual(['DLX', 'DLX', 'DLX']);
    expect(rows[0]).toMatchObject({
      date: h.d(0),
      available: 4,
      price: 4000_00,
      rate: 'BB',
      stopSell: false,
    });
    expect(rows[1]).toMatchObject({ date: h.d(1), available: 2, closedToArrival: true, minStay: 2 });

    // The channel manager is down: the push waits and the worker sends it again; five tries, then it is failed.
    const down = outside(() => ({ status: 503, json: { error: 'down' } }));
    expect(await pushAri(ctx.prisma, down.net, manager, span)).toMatchObject({ ok: false });
    const log = await ctx.prisma.syncLog.findFirstOrThrow({
      where: { companyId: w.companyId, status: 'PENDING' },
    });
    expect(log).toMatchObject({ what: 'ari', tries: 1 });
    const later = new Date(Date.now() + 6 * 60_000);
    expect(await retryPushes(ctx.prisma, down.net, new Date(), w.companyId)).toBe(0);
    expect(down.calls).toHaveLength(1); // not due yet
    for (let i = 0; i < 4; i++) {
      await ctx.prisma.syncLog.update({ where: { id: log.id }, data: { nextTryAt: new Date() } });
      await retryPushes(ctx.prisma, down.net, later, w.companyId);
    }
    expect(await ctx.prisma.syncLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({
      status: 'FAILED',
      tries: 5,
    });
    const health = await integrationHealth(ctx.prisma, await actor(ctx.prisma, w.companyId, w.owner.id));
    expect(health.ok).toBe(false);
    expect(health.connections[0]).toMatchObject({ failed: 1 });
    expect(health.connections[0]!.lastError).toContain('503');
    // A push that waits and then goes through is counted as sent.
    await pushAri(ctx.prisma, down.net, manager, span);
    await ctx.prisma.syncLog.updateMany({
      where: { companyId: w.companyId, status: 'PENDING' },
      data: { nextTryAt: new Date() },
    });
    expect(await retryPushes(ctx.prisma, good.net, later, w.companyId)).toBe(1);
    expect(good.calls.at(-1)!.body).toMatchObject({ rows: expect.any(Array) });
  });

  it('X4, X5: a booking from a channel is made once; a change moves its nights; a cancellation frees them', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const c = await ok<Conn>(connect(h));
    const hook = (body: unknown) =>
      ctx.app.inject({ method: 'POST', url: c.hookPath, payload: body as object });
    const made = await hook(booking(h, 'BDC-1001'));
    expect(made.statusCode).toBe(200);
    expect(made.json()).toMatchObject({ status: 'BOOKED', overbooked: false });
    const stay = await ctx.prisma.stay.findFirstOrThrow({
      where: { companyId: w.companyId, channelRef: 'BDC-1001' },
    });
    expect(stay).toMatchObject({
      source: 'OTA',
      channel: 'Booking.com',
      arrive: h.d(3),
      depart: h.d(5),
      roomTypeId: h.types.deluxe,
      ratePlanId: h.plans.cp,
    });
    expect(stay.note).toContain('9000.00');
    // The same booking sent again is the same booking.
    expect((await hook(booking(h, 'BDC-1001'))).json()).toMatchObject({ again: true, number: stay.number });
    expect(await ctx.prisma.stay.count({ where: { companyId: w.companyId } })).toBe(1);
    // An unmapped room or an unreadable message is refused and written in the log.
    expect((await hook(booking(h, 'BDC-1002', { room: 'VILLA' }))).statusCode).toBe(409);
    expect((await hook({ nonsense: true })).statusCode).toBe(400);
    expect(
      (await ctx.app.inject({ method: 'POST', url: '/api/hooks/channel/not-a-real-token', payload: {} }))
        .statusCode,
    ).toBe(404);
    // A change: one night later, three nights.
    expect(
      (await hook(booking(h, 'BDC-1001', { status: 'modified', arrive: h.d(4), depart: h.d(7) }))).statusCode,
    ).toBe(200);
    const nights = await ctx.prisma.roomNight.findMany({
      where: { stayId: stay.id },
      orderBy: { day: 'asc' },
    });
    expect(nights.map((n) => n.day)).toEqual([h.d(4), h.d(5), h.d(6)]);
    // A cancellation frees every night.
    expect((await hook(booking(h, 'BDC-1001', { status: 'cancelled' }))).json()).toMatchObject({
      status: 'CANCELLED',
    });
    expect(await ctx.prisma.roomNight.count({ where: { stayId: stay.id } })).toBe(0);
    expect((await hook(booking(h, 'BDC-404', { status: 'cancelled' }))).statusCode).toBe(404);
    const log = await ctx.prisma.syncLog.findMany({ where: { companyId: w.companyId, direction: 'IN' } });
    expect(log.filter((l) => l.status === 'FAILED').length).toBe(3);
    expect(log.filter((l) => l.status === 'OK').length).toBe(4);
  });

  it('X6, X7: a booking a channel sold with no room left is taken and flagged; bookings can be pulled', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(connect(h));
    const conn = await ctx.prisma.connection.findFirstOrThrow({ where: { companyId: w.companyId } });
    // The house is full on day 3: all four Deluxe rooms are sold at the desk.
    for (let i = 0; i < 4; i++) await h.booked({ arrive: h.d(3), depart: h.d(4) });
    expect((await h.book({ arrive: h.d(3), depart: h.d(4) })).status).toBe(409);
    const r = await applyChannelBooking(
      ctx.prisma,
      conn,
      booking(h, 'MMT-77', { channel: 'MakeMyTrip', depart: h.d(4) }),
    );
    expect(r).toMatchObject({ status: 'BOOKED', overbooked: true });
    const manager = await actor(ctx.prisma, w.companyId, h.r.manager.id);
    expect(await overbooked(ctx.prisma, manager, h.branchId)).toMatchObject([
      { channel: 'MakeMyTrip', channelRef: 'MMT-77', arrive: h.d(3), guest: 'Otto Traveller' },
    ]);
    const health = await integrationHealth(ctx.prisma, await actor(ctx.prisma, w.companyId, w.owner.id));
    expect(health).toMatchObject({ ok: false, overbooked: 1 });

    // A channel manager that does not call us: MONO asks for what is new since the last time.
    const cm = outside((c) =>
      c.url.includes('/bookings')
        ? { json: { bookings: [booking(h, 'AGO-5', { arrive: h.d(6), depart: h.d(7) }), { broken: true }] } }
        : undefined,
    );
    expect(await pullBookings(ctx.prisma, cm.net, manager, h.branchId)).toEqual({
      taken: 1,
      failed: 1,
      overbooked: 0,
    });
    expect(cm.calls[0]!.url).toContain('https://cm.example.com/v1/bookings?since=1970-01-01');
    await pullBookings(ctx.prisma, cm.net, manager, h.branchId);
    expect(cm.calls[1]!.url).not.toContain('since=1970');
    // Pulled twice, still one booking.
    expect(await ctx.prisma.stay.count({ where: { companyId: w.companyId, channelRef: 'AGO-5' } })).toBe(1);
  });
});
