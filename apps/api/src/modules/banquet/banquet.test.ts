import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { entry } from '../ims/stock-kit';
import { world } from '../records/testkit';
import { banquets, ok, type EventOut } from './banquet-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());
const msg = (r: { body: unknown }) => (r.body as { error: { message: string } }).error.message;

describe('Banquets and events (phase 18)', { timeout: 60_000 }, () => {
  it('B1, B2, B3: halls with capacities, a numbered enquiry, a quotation of plates, hall rent and extras', async () => {
    const w = await world(ctx.app);
    const b = await banquets(ctx.prisma, w);
    // Only set-up people make halls; a second hall of the same name is refused.
    const hall = { branchId: b.branchId, name: 'Crystal', capacities: [{ style: 'Theatre', guests: 50 }] };
    expect((await b.sup.post('/api/banquets/halls', hall)).status).toBe(403);
    expect((await w.api.post('/api/banquets/halls', hall)).status).toBe(409);
    type Hall = { name: string; rent: number; capacities: { style: string; guests: number }[] };
    expect(
      (await ok<Hall[]>(b.sales.get(`/api/banquets/halls?branchId=${b.branchId}`))).map((h) => [
        h.name,
        h.rent,
      ]),
    ).toEqual([
      ['Crystal', 25000_00],
      ['Garden lawn', 0],
    ]);
    const e = await ok<EventOut>(b.enquire({ guest: { name: 'Mr Sharma', mobile: '9829011223' } }));
    expect(e).toMatchObject({ status: 'ENQUIRY', guaranteedCovers: null, totals: { total: 0 } });
    expect(e.number).toMatch(/^BQ-\d{4}$/);
    // A day that has passed, an event that ends before it starts and another branch's hall are refused.
    expect((await b.enquire({ day: '2020-01-01' })).status).toBe(400);
    expect((await b.enquire({ startMin: 1200, endMin: 1100 })).status).toBe(400);
    expect((await b.enquire({ hallIds: ['nope'] })).status).toBe(400);
    // 200 guests at round tables do not fit the Crystal hall (150).
    const quote = (body: object) => b.act(e.id, 'quote', { packageId: b.silver, ...body });
    expect(msg(await quote({ guaranteedCovers: 200 }))).toBe('Crystal holds 150 guests at most');
    // 100 plates × ₹800 + 5 %, the hall ₹25,000 + 18 %, flowers ₹5,000: ₹1,10,000 + ₹8,500 tax.
    const q = await ok<EventOut>(
      quote({ guaranteedCovers: 100, extras: [{ name: 'Flowers', amount: 5000_00 }] }),
    );
    expect(q).toMatchObject({ status: 'QUOTED', guaranteedCovers: 100, quoteVersion: 1 });
    expect(q.totals).toEqual({ covers: 100, taxable: 110000_00, tax: 8500_00, total: 118500_00 });
    expect(q.advance).toEqual({ needed: 29625_00, paid: 0 });
    expect((await b.events('banquet.quoted'))[0]).toMatchObject({
      customer: 'Mr Sharma',
      customerMobile: '+919829011223',
      amount: '₹1,18,500.00',
      halls: 'Crystal',
      covers: 100,
    });
    // A second quotation at a negotiated plate price replaces the first.
    const again = await ok<EventOut>(
      quote({ guaranteedCovers: 100, pricePerPlate: 750_00, hallRent: 20000_00 }),
    );
    expect(again).toMatchObject({ quoteVersion: 2, totals: { taxable: 95000_00, total: 102350_00 } });
  });

  it('B4, B5: the advance confirms a booking, and a hall can never be confirmed twice for the same time', async () => {
    const w = await world(ctx.app);
    const b = await banquets(ctx.prisma, w);
    const e = await b.quoted();
    // Not without the advance; UPI needs its reference; part of it is not enough.
    expect(msg(await b.act(e.id, 'confirm'))).toBe(
      'An advance of ₹29,625.00 confirms this booking (₹0.00 paid)',
    );
    expect((await b.act(e.id, 'advance', { modeId: b.r.modes.upi, amount: 29625_00 })).status).toBe(400);
    await ok(b.act(e.id, 'advance', { modeId: b.r.modes.upi, amount: 20000_00, reference: 'UPI-1' }));
    expect((await b.act(e.id, 'confirm')).status).toBe(409);
    await ok(b.act(e.id, 'advance', { modeId: b.r.modes.cash, amount: 9625_00 }));
    const c = await ok<EventOut>(b.act(e.id, 'confirm'));
    expect(c).toMatchObject({ status: 'CONFIRMED', advance: { paid: 29625_00 }, beoVersion: 1 });
    const papers = await ctx.prisma.bill.findMany({
      where: { companyId: w.companyId, sourceType: 'banquet', sourceId: e.id },
    });
    expect(papers.map((p) => [p.type, Number(p.total)]).sort()).toEqual([
      ['ADVANCE', 20000_00],
      ['ADVANCE', 9625_00],
    ]);
    expect((await b.events('banquet.confirmed'))[0]).toMatchObject({ number: e.number, halls: 'Crystal' });
    // Another party wants the same hall that evening: it can be quoted, never confirmed.
    const rival = await b.quoted({ startMin: 21 * 60, endMin: 24 * 60 });
    await ok(b.act(rival.id, 'advance', { modeId: b.r.modes.cash, amount: 29625_00 }));
    expect(msg(await b.act(rival.id, 'confirm'))).toBe(
      `Crystal is already booked for that time (${e.number})`,
    );
    // The lawn that evening, or the hall at lunch, is free.
    expect((await b.confirmed({ hallIds: [b.lawn], style: 'Floating' })).status).toBe('CONFIRMED');
    expect((await b.confirmed({ startMin: 12 * 60, endMin: 16 * 60 })).status).toBe('CONFIRMED');
    // Two salespeople confirm two bookings of one hall and time at the same moment: one gets it.
    const [x, y] = [await b.quoted({ day: b.d(40) }), await b.quoted({ day: b.d(40) })];
    for (const ev of [x, y]) await ok(b.act(ev.id, 'advance', { modeId: b.r.modes.cash, amount: 29625_00 }));
    const both = await Promise.all([b.act(x.id, 'confirm'), b.act(y.id, 'confirm', {}, b.r.steward2.api)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    // The hall calendar shows who holds what.
    type Cal = {
      name: string;
      events: { number: string; from: string; to: string; holds: boolean; status: string }[];
    }[];
    const cal = await ok<Cal>(
      b.sales.get(`/api/banquets/calendar?branchId=${b.branchId}&from=${b.d(30)}&to=${b.d(30)}`),
    );
    expect(cal.find((h) => h.name === 'Crystal')!.events.map((ev) => [ev.from, ev.to, ev.holds])).toEqual([
      ['12:00', '16:00', true],
      ['19:00', '23:00', true],
      ['21:00', '00:00', false],
    ]);
  });

  it('B6, B7, B8: the BEO with its versions, the indent from recipes × guaranteed covers, the event-day checklist', async () => {
    const w = await world(ctx.app);
    const b = await banquets(ctx.prisma, w);
    const e = await b.confirmed();
    // Half a tikka a guest, 200 g of paneer a plate, 100 guests: 10 kg — the kitchen has 5 kg.
    expect(e.indent).toEqual([
      { itemId: b.r.stock.paneer, name: 'Paneer', unit: 'g', need: 10000, have: 5000, short: 5000 },
    ]);
    expect(e.checklist.map((c) => [c.dept, c.done])).toEqual([
      ['HOUSEKEEPING', false],
      ['SERVICE', false],
      ['KITCHEN', false],
      ['SERVICE', false],
    ]);
    // Notes for each department; sending it tells the branch's managers which version is live.
    await ok(
      b.act(e.id, 'beo', { kitchen: 'No onion, no garlic for 20 covers', service: 'Head table for 12' }),
    );
    expect(await b.events('banquet.beo')).toHaveLength(0);
    const sent = await ok<EventOut>(
      b.act(e.id, 'beo', { housekeeping: 'Mandap on the stage by 4 pm', send: true }),
    );
    expect(sent.beo).toEqual({
      kitchen: 'No onion, no garlic for 20 covers',
      service: 'Head table for 12',
      housekeeping: 'Mandap on the stage by 4 pm',
    });
    expect(sent.beoSentAt).toBeTruthy();
    expect((await b.events('banquet.beo'))[0]).toMatchObject({
      number: e.number,
      version: 1,
      covers: 100,
      menu: 'Silver',
    });
    // The host raises the guarantee to 120: a new BEO version (not yet sent) and a new indent.
    const more = await ok<EventOut>(
      b.act(e.id, 'quote', {
        packageId: b.silver,
        guaranteedCovers: 120,
        extras: [{ name: 'Flowers', amount: 5000_00 }],
      }),
    );
    expect(more).toMatchObject({
      status: 'CONFIRMED',
      beoVersion: 2,
      beoSentAt: null,
      guaranteedCovers: 120,
    });
    expect(more.indent[0]).toMatchObject({ need: 12000, short: 7000 });
    // The event cannot be completed until every line of its checklist is ticked.
    expect((await b.act(e.id, 'complete', { actualCovers: 120 })).status).toBe(409);
    for (const i of [0, 1, 2, 3]) await ok(b.act(e.id, 'checklist', { index: i }));
    const ticked = await ok<EventOut>(b.sales.get(`/api/banquets/events/${e.id}`));
    expect(ticked.checklist.every((c) => c.done)).toBe(true);
    expect((await ok<EventOut>(b.act(e.id, 'complete', { actualCovers: 120 }))).status).toBe('COMPLETED');
  });

  it('B9, B10, B11: the final bill on the covers that came (never under the guarantee), the food off the stock, payment, feedback', async () => {
    const w = await world(ctx.app);
    const b = await banquets(ctx.prisma, w);
    await entry(w.api, {
      itemId: b.r.stock.paneer,
      type: 'IN',
      qty: 15000,
      ratePaise: 40,
      locationId: b.r.kitchenLoc,
    });
    const e = await b.confirmed();
    for (const i of [0, 1, 2, 3]) await ok(b.act(e.id, 'checklist', { index: i }));
    // 92 came: billed for the 100 guaranteed. The kitchen used paneer for the 92 who ate (9.2 kg of 20 kg).
    const done = await ok<EventOut>(b.act(e.id, 'complete', { actualCovers: 92 }));
    expect(done).toMatchObject({
      status: 'COMPLETED',
      actualCovers: 92,
      totals: { covers: 100, total: 118500_00 },
    });
    expect(done.invoice).toMatchObject({ total: 118500_00, due: 88875_00 });
    const held = await ctx.prisma.stockBalance.aggregate({
      where: { itemId: b.r.stock.paneer, locationId: b.r.kitchenLoc },
      _sum: { qty: true },
    });
    expect(Number(held._sum.qty)).toBe(10800);
    const invoice = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: done.invoice!.id } });
    expect(invoice).toMatchObject({
      type: 'INVOICE',
      status: 'PART_PAID',
      settled: 29625_00n,
      sourceType: 'banquet_bill',
    });
    expect((invoice.lines as { item: string; qty: number }[]).map((l) => [l.item, l.qty])).toEqual([
      ['Silver — per plate', 100],
      ['Hall rent', 1],
      ['Flowers', 1],
    ]);
    // The balance: too much and too little are refused; a guest cannot leave it on credit.
    const settle = (body: object) => b.act(e.id, 'settle', body);
    expect((await settle({ payments: [{ modeId: b.r.modes.cash, amount: 90000_00 }] })).status).toBe(400);
    expect(
      msg(await settle({ payments: [{ modeId: b.r.modes.cash, amount: 50000_00 }], onCredit: true })),
    ).toBe('₹38,875.00 is still to pay');
    const closed = await ok<EventOut>(
      settle({
        payments: [
          { modeId: b.r.modes.card, amount: 80000_00, reference: 'AUTH-9' },
          { modeId: b.r.modes.cash, amount: 8875_00 },
        ],
      }),
    );
    expect(closed).toMatchObject({ status: 'CLOSED', invoice: { due: 0 } });
    // Feedback after the event.
    expect(
      (await ok<EventOut>(b.act(e.id, 'feedback', { rating: 5, comments: 'Food was excellent' }))).feedback,
    ).toMatchObject({ rating: 5 });
    // More came than guaranteed: billed for everyone. Stock short for the menu is noted, never blocking.
    const big = await b.confirmed({ day: b.d(31) });
    for (const i of [0, 1, 2, 3]) await ok(b.act(big.id, 'checklist', { index: i }));
    const over = await ok<EventOut>(b.act(big.id, 'complete', { actualCovers: 118 }));
    expect(over.totals).toMatchObject({ covers: 118, taxable: 124400_00 });
    expect(over.note).toBe('Stock short for: Paneer tikka');
    // A company that booked an event may be billed on credit.
    const acme = await ok<{ id: string }>(
      w.api.post('/api/money/parties', { name: 'Acme Corp', kinds: ['customer'], state: 'Rajasthan' }),
    );
    const corp = await b.confirmed({ day: b.d(32), companyPartyId: acme.id });
    for (const i of [0, 1, 2, 3]) await ok(b.act(corp.id, 'checklist', { index: i }));
    await ok(b.act(corp.id, 'complete', { actualCovers: 100 }));
    const credit = await ok<EventOut>(b.act(corp.id, 'settle', { onCredit: true }));
    expect(credit).toMatchObject({ status: 'CLOSED', invoice: { due: 88875_00 } });
  });

  it('B12: an enquiry lost, a booking cancelled — the advance returned in time, kept when it is late', async () => {
    const w = await world(ctx.app);
    const b = await banquets(ctx.prisma, w);
    const advances = async (id: string) =>
      (
        await ctx.prisma.bill.findMany({
          where: { companyId: w.companyId, sourceType: 'banquet', sourceId: id },
        })
      ).map((p) => p.status);
    // Lost while quoted: the token advance goes back.
    const q = await b.quoted();
    await ok(b.act(q.id, 'advance', { modeId: b.r.modes.cash, amount: 5000_00 }));
    expect(await ok<EventOut>(b.act(q.id, 'end', { reason: 'Chose another venue' }))).toMatchObject({
      status: 'LOST',
      advance: 'RETURNED',
    });
    expect(await advances(q.id)).toEqual(['CANCELLED']);
    // A confirmed booking is a manager's to cancel. A month ahead: returned, and the hall is free again.
    const far = await b.confirmed();
    expect((await b.act(far.id, 'end', { reason: 'Wedding postponed' })).status).toBe(403);
    expect(await ok<EventOut>(b.act(far.id, 'end', { reason: 'Wedding postponed' }, b.sup))).toMatchObject({
      status: 'CANCELLED',
      advance: 'RETURNED',
    });
    expect((await b.confirmed()).status).toBe('CONFIRMED');
    // Three days ahead (inside the 15 days): kept — invoiced as the cancellation charge and paid by the advance.
    const near = await b.confirmed({ day: b.d(3) });
    const kept = await ok<EventOut>(b.act(near.id, 'end', { reason: 'Family emergency' }, b.sup));
    expect(kept).toMatchObject({ status: 'CANCELLED', advance: 'KEPT' });
    expect(kept.invoice).toMatchObject({ total: 29625_00, due: 0 });
    expect(await advances(near.id)).toEqual(['ISSUED']);
    expect((await b.act(near.id, 'quote', { guaranteedCovers: 10 })).status).toBe(409);
  });
});
