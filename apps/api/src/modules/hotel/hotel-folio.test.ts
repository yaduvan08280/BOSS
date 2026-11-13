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

const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;

describe('Hotel: restaurant bills on the folio, split folios (phase 17)', { timeout: 60_000 }, () => {
  it('H26: a restaurant bill sent to the room goes on the folio of whoever is in it, and is paid with the folio', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    const b = await h.booked({ depart: h.d(1) });
    const s = h.desk;
    // Nobody in 101 yet: the room charge is refused. A room that does not exist: not found.
    const o = await open(s, h.r, 'T1', { type: 'ROOM_SERVICE', roomNo: '101' });
    await add(s, o.id, [{ menuItemId: h.r.m.dal }]);
    const c = await bill(s, o.id);
    expect(c.total).toBe(322_00);
    const room = (ref?: string) =>
      s.post(`/api/pos/checks/${c.id}/pay`, {
        payments: [{ modeId: h.r.modes.room, amount: 322_00, ...(ref ? { reference: ref } : {}) }],
      });
    expect(msg(await room())).toBe('Nobody is checked in to room 101');
    expect((await room('999')).status).toBe(404);
    await ok(h.checkIn(b.id, '101'));
    const paid = await ok<{ status: string; due: number; orderStatus: string }>(room());
    expect(paid).toMatchObject({ status: 'PAID', due: 0, orderStatus: 'PAID' });
    // No money came in: the bill is still owed in the money core, and sits on the folio.
    const invoice = await ctx.prisma.bill.findFirstOrThrow({
      where: { companyId: w.companyId, number: c.number },
    });
    expect(invoice).toMatchObject({ status: 'ISSUED', settled: 0n });
    let f = (await h.stay(b.id)).folios[0]!;
    expect(f.lines).toMatchObject([{ kind: 'FOOD', amount: 322_00, text: `Rooftop — bill ${c.number}` }]);
    expect(f).toMatchObject({ restaurant: 322_00, total: 322_00, due: 322_00 });
    // A second bill is cancelled in the POS: its line comes off the folio.
    const o2 = await open(s, h.r, 'T2', { type: 'ROOM_SERVICE', roomNo: '101' });
    await add(s, o2.id, [{ menuItemId: h.r.m.cola }]);
    const c2 = await bill(s, o2.id);
    await pay(s, c2.id, [{ modeId: h.r.modes.room, amount: c2.total }]).catch(() => undefined);
    await h.audit();
    f = (await h.stay(b.id)).folios[0]!;
    // Room ₹4,000 + ₹480 tax, and ₹322 of dinner already invoiced.
    expect(f).toMatchObject({
      charges: 4000_00,
      tax: 480_00,
      restaurant: 322_00 + c2.total,
      total: 4480_00 + 322_00 + c2.total,
    });
    const closed = await post<FolioOut>(s, `/api/hotel/folios/${f.id}/settle`, {
      payments: [{ modeId: h.r.modes.cash, amount: 4480_00 + 322_00 + c2.total }],
    });
    expect(closed.invoice).toMatchObject({ total: 4480_00, due: 0 });
    // The dinner's own invoice is paid by its own receipt; nothing was invoiced twice.
    expect(await ctx.prisma.bill.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
      status: 'PAID',
      settled: 322_00n,
    });
    const sales = await ctx.prisma.bill.aggregate({
      where: { companyId: w.companyId, type: 'INVOICE' },
      _sum: { total: true },
    });
    expect(Number(sales._sum.total)).toBe(4480_00 + 322_00 + c2.total);
  });

  it('H29, H30, H31, H34: a split folio with routing, the company billed on credit, and a charge moved to another room', async () => {
    const w = await world(ctx.app);
    const h = await property(ctx.prisma, w);
    await ok(
      w.api.put(`/api/hotel/rules?branchId=${h.branchId}`, {
        extras: [{ key: 'spa', name: 'Spa', price: 1500_00, taxCode: 'GST18' }],
      }),
    );
    const a = await h.booked({ depart: h.d(1) });
    const b = await h.booked({ depart: h.d(1) });
    await ok(h.checkIn(a.id, '101'));
    await ok(h.checkIn(b.id, '102'));
    // A second folio for the company, and the rule: the room goes to it, everything else stays with the guest.
    const f2 = await post<{ id: string; no: number }>(h.desk, `/api/hotel/stays/${a.id}/folios`, {
      name: 'Acme Corp',
      partyId: h.acme,
    });
    expect(f2.no).toBe(2);
    expect(
      (await h.desk.put(`/api/hotel/stays/${a.id}/routing`, { routing: [{ kinds: ['ROOM'], folio: 3 }] }))
        .status,
    ).toBe(400);
    await ok(h.desk.put(`/api/hotel/stays/${a.id}/routing`, { routing: [{ kinds: ['ROOM'], folio: 2 }] }));
    const spa = await ok<{ id: string }>(
      h.desk.post(`/api/hotel/stays/${a.id}/charges`, { extraKey: 'spa' }),
    );
    const spa2 = await ok<{ id: string }>(
      h.desk.post(`/api/hotel/stays/${a.id}/charges`, { extraKey: 'spa' }),
    );
    await h.audit();
    let s = await h.stay(a.id);
    expect(s.folios.map((f) => [f.no, f.lines.map((l) => l.kind), f.total])).toEqual([
      [1, ['EXTRA', 'EXTRA'], 3540_00],
      [2, ['ROOM'], 4480_00],
    ]);
    // Splitting by hand: one spa visit is the company's too. Moving it to the guest in 102: a folio transfer.
    await ok(
      h.desk.post(`/api/hotel/folios/${s.folios[0]!.id}/move`, { lineIds: [spa.id], toFolioId: f2.id }),
    );
    const other = (await h.stay(b.id)).folios[0]!;
    await ok(
      h.desk.post(`/api/hotel/folios/${s.folios[0]!.id}/move`, { lineIds: [spa2.id], toFolioId: other.id }),
    );
    s = await h.stay(a.id);
    expect(s.folios.map((f) => [f.no, f.total])).toEqual([
      [1, 0],
      [2, 4480_00 + 1770_00],
    ]);
    expect((await h.stay(b.id)).folios[0]).toMatchObject({ total: 4480_00 + 1770_00 });
    // The guest's own folio must be paid; the company's may be left owing — it shows in Money owed.
    const guestFolio = (await h.stay(b.id)).folios[0]!;
    expect((await h.desk.post(`/api/hotel/folios/${guestFolio.id}/settle`, { onCredit: true })).status).toBe(
      400,
    );
    const closed = await post<FolioOut>(h.desk, `/api/hotel/folios/${f2.id}/settle`, { onCredit: true });
    expect(closed).toMatchObject({ status: 'CLOSED' });
    expect(closed.invoice).toMatchObject({ total: 6250_00, due: 6250_00 });
    const owed = await ok<
      { rows: { party: { id: string }; due: number }[] } | { party: { id: string }; due: number }[]
    >(w.api.get('/api/money/outstanding?side=receivable'));
    const rows = Array.isArray(owed) ? owed : owed.rows;
    expect(rows.find((r) => r.party.id === h.acme)).toMatchObject({ due: 6250_00 });
    // With nothing left on the guest's folio, the guest checks out.
    expect(await ok(h.desk.post(`/api/hotel/stays/${a.id}/check-out`, { leftMin: 600 }))).toMatchObject({
      status: 'CHECKED_OUT',
    });
    expect((await h.stay(a.id)).folios.map((f) => f.status)).toEqual(['CLOSED', 'CLOSED']);
  });
});
