import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { add, bill, ok, pay, post } from './pos-kit';
import { hostDesk, type ResOut } from './res-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Profile = {
  id: string;
  name: string;
  tags: string[];
  allergies: string | null;
  consent: { marketing: boolean; source: string; at: string; byId: string | null } | null;
  consentLog: { marketing: boolean; source: string }[];
  history: {
    visits: number;
    spend: number;
    average: number;
    favourites: { name: string; qty: number }[];
    noShows: number;
    cancelled: number;
  };
  upcoming: { number: string }[];
};

describe('Reservations: guest profiles and consent (phase 16)', { timeout: 30_000 }, () => {
  it('R19: a guest profile — one per mobile, what they told us, and visits, spend and favourites read from their orders', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const s = h.r.steward.api;
    const g = await post<{ id: string }>(s, '/api/guests', {
      name: 'Asha Mehta',
      mobile: '98290 88888',
      birthday: '1990-11-20',
      allergies: 'Peanuts',
      preferences: 'Window table, less spicy',
      tags: ['VIP'],
    });
    // The same number again is refused and points at the profile.
    const twice = await s.post('/api/guests', { name: 'Someone else', mobile: '+919829088888' });
    expect(twice.status).toBe(409);
    expect((twice.body as { error: { details: { id: string } } }).error.details.id).toBe(g.id);
    // Two dinners booked by mobile, one no-show.
    for (const startMin of [12 * 60, 15 * 60]) {
      const b = await h.reserve({ startMin, guest: { name: 'Asha', mobile: '9829088888' } });
      expect(b.guest).toMatchObject({ id: g.id, name: 'Asha Mehta', allergies: 'Peanuts', tags: ['VIP'] });
      const seated = await ok<ResOut>(h.act(b.id, 'seat'));
      // The kitchen reads the allergy on the order.
      expect(
        (await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: seated.order!.id } })).note,
      ).toContain('Allergies: Peanuts');
      await add(s, seated.order!.id, [{ menuItemId: h.r.m.dal, qty: 2 }, { menuItemId: h.r.m.naan }]);
      const c = await bill(s, seated.order!.id, { noServiceCharge: true });
      await pay(s, c.id, [{ modeId: h.r.modes.cash, amount: c.total }]);
    }
    const missed = await h.reserve({ startMin: 21 * 60, guest: { name: 'Asha', mobile: '9829088888' } });
    await ok(h.act(missed.id, 'noShow'));
    const next = await h.reserve({ startMin: 22 * 60 + 30, guest: { name: 'Asha', mobile: '9829088888' } });
    const p = await ok<Profile>(s.get(`/api/guests/${g.id}`));
    // (2 × ₹280 + ₹60) + 5 % = ₹651 a visit.
    expect(p.history).toMatchObject({
      visits: 2,
      spend: 1302_00,
      average: 651_00,
      noShows: 1,
      cancelled: 0,
    });
    expect(p.history.favourites).toEqual([
      { name: 'Dal makhani', qty: 4 },
      { name: 'Butter naan', qty: 2 },
    ]);
    expect(p.upcoming.map((u) => u.number)).toEqual([next.number]);
    // Changes, the list with its filters, and removal only when no booking is to come.
    await ok(s.patch(`/api/guests/${g.id}`, { tags: ['VIP', 'Regular'], anniversary: '0000-02-14' }));
    type List = { tags: string[]; guests: { name: string; visits: number }[] };
    expect(await ok<List>(s.get('/api/guests?q=asha'))).toMatchObject({
      tags: ['Regular', 'VIP'],
      guests: [{ name: 'Asha Mehta', visits: 2 }],
    });
    expect((await ok<List>(s.get('/api/guests?month=11'))).guests).toHaveLength(1);
    expect((await ok<List>(s.get('/api/guests?month=2&tag=Regular'))).guests).toHaveLength(1);
    expect((await ok<List>(s.get('/api/guests?month=5'))).guests).toHaveLength(0);
    expect((await w.api.del(`/api/guests/${g.id}`)).status).toBe(409);
    await ok(h.act(next.id, 'cancel'));
    expect((await s.del(`/api/guests/${g.id}`)).status).toBe(403);
    await ok(w.api.del(`/api/guests/${g.id}`));
    expect((await ok<List>(s.get('/api/guests'))).guests).toHaveLength(0);
  });

  it('R20: marketing consent — recorded with when, how and by whom; taking it back is recorded too', async () => {
    const w = await world(ctx.app);
    const h = await hostDesk(ctx.prisma, w);
    const s = h.r.steward.api;
    const yes = await post<{ id: string }>(s, '/api/guests', { name: 'Kabir Rao', mobile: '9829099991' });
    const never = await post<{ id: string }>(s, '/api/guests', { name: 'Neha Jain', mobile: '9829099992' });
    expect((await ok<Profile>(s.get(`/api/guests/${yes.id}`))).consent).toBeNull();
    await ok(
      s.post(`/api/guests/${yes.id}/consent`, {
        marketing: true,
        source: 'STAFF',
        note: 'Said yes at the table',
      }),
    );
    const p = await ok<Profile>(s.get(`/api/guests/${yes.id}`));
    expect(p.consent).toMatchObject({ marketing: true, source: 'STAFF', byId: h.r.steward.id });
    expect(Date.parse(p.consent!.at)).toBeGreaterThan(Date.now() - 60_000);
    type List = { guests: { id: string }[] };
    expect((await ok<List>(s.get('/api/guests?marketing=yes'))).guests.map((x) => x.id)).toEqual([yes.id]);
    expect((await ok<List>(s.get('/api/guests?marketing=no'))).guests.map((x) => x.id)).toEqual([never.id]);
    // Taken back: the list drops them at once and both moments stay on record.
    await ok(s.post(`/api/guests/${yes.id}/consent`, { marketing: false, source: 'GUEST' }));
    const after = await ok<Profile>(s.get(`/api/guests/${yes.id}`));
    expect(after.consent).toMatchObject({ marketing: false, source: 'GUEST' });
    expect(after.consentLog.map((c) => [c.marketing, c.source])).toEqual([
      [true, 'STAFF'],
      [false, 'GUEST'],
    ]);
    expect((await ok<List>(s.get('/api/guests?marketing=yes'))).guests).toHaveLength(0);
    const audit = await ctx.prisma.auditLog.findMany({
      where: { companyId: w.companyId, entityId: yes.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'guest.created',
      'guest.consent_given',
      'guest.consent_withdrawn',
    ]);
    // Another company never sees these guests.
    const other = await world(ctx.app);
    expect((await other.api.get(`/api/guests/${yes.id}`)).status).toBe(404);
  });
});
