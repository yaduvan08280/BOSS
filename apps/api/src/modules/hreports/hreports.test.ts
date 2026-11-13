import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../test/helpers';
import { add, bill, ok, open, order, pay, post, restaurant } from '../hosp/pos-kit';
import { world } from '../records/testkit';
import { flashFor, flashSweep } from './flash';
import { gstr1Csv } from './gstr1';
import { actorFor } from '../work/actor';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

type Sales = {
  total: number;
  covers: number;
  orders: number;
  rows: { label: string; qty: number; sales: number; share: number; orders: number }[];
};

describe('Hospitality reports (phase 20)', { timeout: 120_000 }, () => {
  it('F1, F2, F3: sales by item, category, steward, hour and outlet; kitchen times by station; the void and discount audit', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    const s2 = r.steward2.api;
    // Ravi: a full tikka, a dal and two colas (₹320 + ₹280 + ₹160), 5 % off. Sana: a dal and a naan; the naan is voided.
    const a = await open(s, r, 'T1', { covers: 2 });
    await add(s, a.id, [
      { menuItemId: r.m.tikka, variantKey: 'full', qty: 1 },
      { menuItemId: r.m.dal, qty: 1 },
      { menuItemId: r.m.cola, qty: 2 },
    ]);
    const b = await open(s2, r, 'T2', { covers: 3 });
    await add(s2, b.id, [
      { menuItemId: r.m.dal, qty: 1 },
      { menuItemId: r.m.naan, qty: 1 },
    ]);
    const naan = (await order(s2, b.id)).items.find((i) => i.name === 'Butter naan')!;
    await ok(
      s2.post(`/api/pos/orders/${b.id}/items/${naan.id}/void`, { reason: 'Guest changed their mind' }),
    );
    // The kitchen marks its tickets ready; the bar's stays open.
    const kots = await ctx.prisma.kot.findMany({
      where: { companyId: w.companyId },
      orderBy: { number: 'asc' },
    });
    for (const k of kots.filter((x) => x.stationId === r.stations.kitchen)) {
      // Fired 12 and 30 minutes ago.
      await ctx.prisma.kot.update({
        where: { id: k.id },
        data: { firedAt: new Date(Date.now() - (k.orderId === a.id ? 12 : 30) * 60_000) },
      });
      await ok(s.post(`/api/pos/kots/${k.id}/ready`));
    }
    const ca = await bill(s, a.id, { discount: { kind: 'PERCENT', value: 5, reason: 'Regular guest' } });
    await pay(s, ca.id, [{ modeId: r.modes.cash, amount: ca.total }]);
    const cb = await bill(s2, b.id);
    await pay(s2, cb.id, [{ modeId: r.modes.cash, amount: cb.total }]);
    const day = (await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: a.id } })).businessDay;
    const get = <T>(path: string, more = '') =>
      ok<T>(r.manager.api.get(`/api/hosp/reports/${path}?from=${day}&to=${day}${more}`));

    const items = await get<Sales>('sales');
    expect(items).toMatchObject({ total: 1040_00, covers: 5, orders: 2 });
    expect(items.rows.map((x) => [x.label, x.qty, x.sales, x.orders])).toEqual([
      ['Dal makhani', 2, 560_00, 2],
      ['Paneer tikka (Full)', 1, 320_00, 1],
      ['Cola', 2, 160_00, 1],
    ]);
    expect(items.rows[0]!.share).toBe(53.8);
    expect((await get<Sales>('sales', '&by=category')).rows.map((x) => [x.label, x.sales])).toEqual([
      ['Mains', 560_00],
      ['Starters', 320_00],
      ['Drinks', 160_00],
    ]);
    expect((await get<Sales>('sales', '&by=steward')).rows.map((x) => [x.label, x.sales])).toEqual([
      ['Ravi Steward', 760_00],
      ['Sana Steward', 280_00],
    ]);
    expect((await get<Sales>('sales', '&by=outlet')).rows).toMatchObject([
      { label: 'Rooftop', sales: 1040_00 },
    ]);
    const hours = await get<Sales>('sales', '&by=hour');
    expect(hours.rows).toHaveLength(1);
    expect(hours.rows[0]!.label).toMatch(/^\d\d:00$/);
    // Another day has nothing; a steward may not read reports of an outlet that is not theirs — but may read their own.
    expect(
      (await ok<Sales>(r.manager.api.get('/api/hosp/reports/sales?from=2020-01-01&to=2020-01-02'))).total,
    ).toBe(0);
    expect((await r.manager.api.get(`/api/hosp/reports/sales?from=${day}&to=2020-01-01`)).status).toBe(400);
    const clerk = await post(w.api, '/api/org/roles', { name: 'Clerk', permissions: ['delegation.view'] });
    const noHosp = await w.person('No Hosp', clerk.id);
    expect((await noHosp.api.get(`/api/hosp/reports/sales?from=${day}&to=${day}`)).status).toBe(403);

    type Service = {
      limitMin: number;
      rows: {
        station: string;
        tickets: number;
        timed: number;
        avgMin: number | null;
        slowestMin: number | null;
        late: number;
        onTimePct: number | null;
      }[];
    };
    const service = await get<Service>('service');
    const kitchen = service.rows.find((x) => x.station === 'Kitchen')!;
    expect(kitchen).toMatchObject({ tickets: 2, timed: 2, late: 1, onTimePct: 50 });
    expect(Math.round(kitchen.avgMin!)).toBe(21);
    expect(Math.round(kitchen.slowestMin!)).toBe(30);
    // The bar's ticket was never marked ready: counted, not timed.
    expect(service.rows.find((x) => x.station === 'Bar')).toMatchObject({
      tickets: 1,
      timed: 0,
      avgMin: null,
    });

    type Audit = {
      voids: { item: string; value: number; reason: string; by: string }[];
      discounts: { kind: string; amount: number; reason: string; by: string }[];
      totals: { voids: number; discounts: number; noCharge: number };
    };
    const audit = await get<Audit>('audit');
    expect(audit.voids).toMatchObject([
      { item: 'Butter naan', value: 60_00, reason: 'Guest changed their mind', by: 'Sana Steward' },
    ]);
    expect(audit.discounts).toMatchObject([
      { kind: 'DISCOUNT', amount: 38_00, reason: 'Regular guest', by: 'Ravi Steward' },
    ]);
    expect(audit.totals).toEqual({ voids: 60_00, discounts: 38_00, noCharge: 0 });

    type Team = {
      week: { from: string; to: string };
      stewards: {
        name: string;
        orders: number;
        covers: number;
        sales: number;
        voids: number;
        perCover: number;
      }[];
      stations: { station: string }[];
      housekeeping: unknown[];
    };
    const team = await ok<Team>(r.manager.api.get(`/api/hosp/reports/team?day=${day}`));
    expect(new Date(`${team.week.from}T12:00:00Z`).getUTCDay()).toBe(1);
    expect(team.stewards).toMatchObject([
      { name: 'Ravi Steward', orders: 1, covers: 2, sales: 760_00, voids: 0, perCover: 380_00 },
      { name: 'Sana Steward', orders: 1, covers: 3, sales: 280_00, voids: 1 },
    ]);
    expect(team.stations.map((x) => x.station).sort()).toEqual(['Bar', 'Kitchen']);
  });

  it('F4, F5: the flash report of a day — sales, guests, food and drink cost, cash counted against the system — goes to the owner once, from 08:00', async () => {
    const w = await world(ctx.app);
    const r = await restaurant(ctx.prisma, w);
    const s = r.steward.api;
    // Cola is the bar's: its category is liquor at this branch, so its cost is the drink cost.
    await ctx.prisma.item.update({ where: { id: r.stock.cola }, data: { category: 'Beverages' } });
    await ok(
      w.api.put(`/api/hosp/branch-rules?branchId=${r.g.b.rooftop.id}`, {
        bar: { liquorCategories: ['Beverages'] },
      }),
    );
    const o = await open(s, r, 'T1', { covers: 4 });
    await add(s, o.id, [
      { menuItemId: r.m.tikka, variantKey: 'full', qty: 2 },
      { menuItemId: r.m.cola, qty: 4 },
    ]);
    const c = await bill(s, o.id);
    await pay(s, c.id, [{ modeId: r.modes.cash, amount: c.total }]);
    const day = (await ctx.prisma.posOrder.findUniqueOrThrow({ where: { id: o.id } })).businessDay;
    const before = await flashFor(ctx.prisma, w.companyId, day);
    expect(before.outlets).toMatchObject([
      {
        outlet: 'Rooftop',
        sales: c.total,
        beforeTax: 960_00 + 96_00,
        covers: 4,
        bills: 1,
        cashSystem: c.total,
        cashCounted: null,
        cashDiff: null,
        closed: false,
      },
    ]);
    // Two tikkas take 400 g of paneer at 40 paise = ₹160 on ₹640; four colas cost ₹100 on ₹320.
    expect(before.cost).toEqual({
      food: { sales: 640_00, cost: 160_00, pct: 25 },
      beverage: { sales: 320_00, cost: 100_00, pct: 31.3 },
    });
    expect(before.totals).toMatchObject({
      sales: c.total,
      covers: 4,
      perCover: Math.round((960_00 + 96_00) / 4),
      cashDiff: null,
    });
    // The day is closed ₹10 short.
    const cash = {
      500: 2,
      100: Math.floor((c.total / 100 - 1000 - 10) / 100),
      1: Math.round(c.total / 100 - 1000 - 10) % 100,
    };
    await ok(r.manager.api.post(`/api/pos/outlets/${r.outlet}/day/close`, { cash }));
    const after = await flashFor(ctx.prisma, w.companyId, day);
    expect(after.outlets[0]).toMatchObject({ closed: true, cashCounted: c.total - 10_00, cashDiff: -10_00 });
    // A manager reads the flash on the screen; a person of another branch sees none of this outlet.
    type Flash = { outlets: { outlet: string }[]; totals: { sales: number } };
    expect((await ok<Flash>(r.manager.api.get(`/api/hosp/reports/flash?day=${day}`))).totals.sales).toBe(
      c.total,
    );
    await ok(w.api.patch(`/api/org/roles/${w.role('HOD')}`, { reach: 'branches' }));
    const lake = await r.g.at('Leela Lake', r.g.b.lake.id, 'HOD');
    expect((await ok<Flash>(lake.api.get(`/api/hosp/reports/flash?day=${day}`))).outlets).toEqual([]);

    // The message: for "yesterday", so the clock is moved a day on; nothing before 08:00, once after.
    const tz = 'Asia/Kolkata';
    const at = (hhmm: string) =>
      new Date(
        `${new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T${hhmm}:00+05:30`,
      );
    expect(tz).toBe((await ctx.prisma.company.findUniqueOrThrow({ where: { id: w.companyId } })).timezone);
    expect(await flashSweep(ctx.prisma, at('07:30'), w.companyId)).toBe(0);
    expect(await flashSweep(ctx.prisma, at('08:05'), w.companyId)).toBe(1);
    expect(await flashSweep(ctx.prisma, at('09:00'), w.companyId)).toBe(0);
    const sent = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { companyId: w.companyId, name: 'hosp.flash' },
    });
    expect(sent.payload).toMatchObject({
      day: day.split('-').reverse().join('/'),
      covers: 4,
      foodCost: '25%',
      beverageCost: '31.3%',
      occupancy: '—',
      noCharge: 0,
    });
    expect((sent.payload as { cash: string }).cash).toContain('10');
  });

  it('F6, F7: the GSTR-1 working file of a month — B2B by rate, B2C by state and rate, notes, HSN, documents; receivables of companies apart', async () => {
    const w = await world(ctx.app);
    const tax = (code: string, percent: number) =>
      ok(w.api.put('/api/money/tax-rates', { code, name: code, percent, from: '2020-01-01' }));
    await tax('GST5', 5);
    await tax('GST18', 18);
    await ctx.prisma.company.update({
      where: { id: w.companyId },
      data: { gstin: '08AAAAA0000A1Z5', state: 'Rajasthan' },
    });
    const party = (name: string, more: object) =>
      post(w.api, '/api/money/parties', { name, kinds: ['customer'], ...more });
    const acme = await party('Acme Hotels', {
      kinds: ['company'],
      state: 'Maharashtra',
      taxId: '27ABCDE1234F1Z5',
    });
    const local = await party('Local Traders', { state: 'Rajasthan', taxId: '08ABCDE1234F1Z9' });
    const guest = await party('Ramesh', { state: 'Rajasthan' });
    const far = await party('Sunita', { state: 'Gujarat' });
    const invoice = async (
      partyId: string,
      date: string,
      lines: object[],
      type = 'INVOICE',
      againstId?: string,
    ) => {
      const d = await post(w.api, '/api/money/bills', {
        type,
        partyId,
        date,
        branchId: null,
        lines,
        ...(againstId ? { againstId } : {}),
      });
      await ok(w.api.post(`/api/money/bills/${d.id}/issue`));
      return d.id;
    };
    const food = (rate: number, qty = 1) => ({
      item: 'Catering',
      hsn: '996334',
      qty,
      unit: 'nos',
      rate,
      taxCode: 'GST5',
    });
    const hall = (rate: number) => ({ item: 'Hall rent', hsn: '997212', qty: 1, rate, taxCode: 'GST18' });
    // October: Acme (another state) one bill with two rates; a local registered buyer; two unregistered buyers.
    const big = await invoice(acme.id, '2026-10-05', [food(1000_00, 10), hall(20000_00)]);
    await invoice(local.id, '2026-10-06', [food(2000_00)]);
    await invoice(guest.id, '2026-10-07', [food(400_00)]);
    await invoice(guest.id, '2026-10-08', [food(600_00)]);
    await invoice(far.id, '2026-10-09', [food(1000_00)]);
    await invoice(acme.id, '2026-10-20', [hall(5000_00)], 'CREDIT_NOTE', big);
    // November and a draft are not October's.
    await invoice(guest.id, '2026-11-01', [food(999_00)]);
    await post(w.api, '/api/money/bills', {
      type: 'INVOICE',
      partyId: guest.id,
      date: '2026-10-30',
      branchId: null,
      lines: [food(123_00)],
    });

    type G = {
      gstin: string;
      b2b: Record<string, unknown>[];
      b2cs: Record<string, unknown>[];
      cdnr: Record<string, unknown>[];
      hsn: Record<string, unknown>[];
      docs: Record<string, unknown>;
      problems: string[];
    };
    const g = await ok<G>(w.api.get('/api/money/gstr1?month=2026-10'));
    expect(g.gstin).toBe('08AAAAA0000A1Z5');
    expect(g.b2b.map((x) => [x.gstin, x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst])).toEqual([
      ['27ABCDE1234F1Z5', '27', 5, 10000_00, 500_00, 0, 0],
      ['27ABCDE1234F1Z5', '27', 18, 20000_00, 3600_00, 0, 0],
      ['08ABCDE1234F1Z9', '08', 5, 2000_00, 0, 50_00, 50_00],
    ]);
    // Unregistered buyers: one row per place of supply and rate.
    expect(g.b2cs.map((x) => [x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst])).toEqual([
      ['08', 5, 1000_00, 0, 25_00, 25_00],
      ['24', 5, 1000_00, 50_00, 0, 0],
    ]);
    expect(g.cdnr).toMatchObject([
      { gstin: '27ABCDE1234F1Z5', kind: 'C', rate: 18, taxable: 5000_00, igst: 900_00 },
    ]);
    expect(g.hsn.map((x) => [x.hsn, x.rate, x.qty, x.taxable])).toEqual([
      ['996334', 5, 14, 14000_00],
      ['997212', 18, 1, 20000_00],
    ]);
    expect(g.docs).toMatchObject({ invoices: 5, notes: 1 });
    expect(g.problems).toEqual([]);
    const owner = (await actorFor(ctx.prisma, w.companyId, w.owner.id))!;
    const file = await gstr1Csv(ctx.prisma, owner, { month: '2026-10' });
    expect(file.fileName).toBe('gstr1-2026-10.csv');
    expect(file.csv).toContain('B2B\ngstin,name,number,date,value,pos,rate,taxable,igst,cgst,sgst');
    expect(file.csv).toContain(',27,18,20000.00,3600.00,0.00,0.00');
    expect(file.csv).toContain('B2CS\npos,rate,taxable,igst,cgst,sgst\n08,5,1000.00,0.00,25.00,25.00');
    expect((await (await w.person('No Money')).api.get('/api/money/gstr1?month=2026-10')).status).toBe(403);

    // What companies owe, apart from everyone else.
    type Owed = { rows: { party: { name: string }; due: number }[] };
    const all = await ok<Owed>(w.api.get('/api/hosp/reports/receivables'));
    expect(all.rows.length).toBe(4);
    const companies = await ok<Owed>(w.api.get('/api/hosp/reports/receivables?kind=company'));
    expect(companies.rows).toMatchObject([
      { party: { name: 'Acme Hotels' }, due: 10500_00 + 23600_00 - 5900_00 },
    ]);
  });
});
