import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a transporter (phase 21)', { timeout: 120_000 }, () => {
  it('K36–K40: set up from the pack; diesel bought; a consignment carried and the freight billed; a trip with its expenses; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'logistics');
    const { companyId } = t;

    // K36 — set up from the pack: vehicles and drivers, the consignment note, the trip, the expense-claim process.
    expect(
      await ctx.prisma.masterDef.count({ where: { companyId, name: { in: ['Vehicles', 'Drivers'] } } }),
    ).toBe(2);
    await t.rate('GTA5', 5);

    // K37 — buy and receive: the pump's diesel bill is entered and owed.
    const pump = await t.party('Highway Fuels', ['vendor']);
    const fuel = await ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'PURCHASE_BILL',
        partyId: pump,
        date: today(),
        branchId: null,
        lines: [{ item: 'Diesel 400 l — RJ14 GA 1234', hsn: '2710', qty: 400, unit: 'ltr', rate: 92_00 }],
      }),
    );
    await ok(w.api.post(`/api/money/bills/${fuel.id}/issue`));
    expect((await t.owed('payable')).rows[0]!.due).toBe(36_800_00);

    // K38 — sell and bill: a consignment note with its vehicle; it leaves, is delivered, and the freight bill is raised with tax.
    const cn = await t.made('CN', {
      consignor: 'GGM Minerals',
      consignee: 'Stone World',
      from: 'Kishangarh',
      to: 'Delhi',
      packages: 40,
      weight_t: 15.5,
      freight: 46_500,
      vehicle: 'RJ14 GA 1234',
    });
    // A vehicle that is not in the master, or a note without its freight, is refused.
    expect(
      (
        await t.record('CN', {
          consignor: 'A',
          consignee: 'B',
          from: 'X',
          to: 'Y',
          weight_t: 1,
          vehicle: 'RJ14 GA 1234',
        })
      ).status,
    ).toBe(400);
    await t.moveTo(cn.id, 'load');
    expect(await t.moveTo(cn.id, 'deliver')).toMatchObject({ status: 'delivered' });
    const consignor = await t.party('GGM Minerals', ['customer'], { creditDays: 15 });
    await t.invoice(consignor, [
      {
        item: `Freight ${cn.code} Kishangarh → Delhi, 15.5 t`,
        hsn: '9965',
        qty: 1,
        rate: 46_500_00,
        taxCode: 'GTA5',
      },
    ]);
    expect((await t.owed()).rows).toMatchObject([{ party: { name: 'GGM Minerals' }, due: 48_825_00 }]);

    // K39 — the trade's own: the trip with its kilometres and expenses, closed; the driver's claim runs through its process.
    const trip = await t.made(
      'TRIP',
      {
        vehicle: 'RJ14 GA 1234',
        driver: 'Ramesh Kumar',
        route: 'Kishangarh – Delhi – Kishangarh',
        start_km: 45_210,
        end_km: 46_020,
        advance: 8000,
      },
      {
        expenses: [
          { kind: 'Toll', amount: 2450 },
          { kind: 'Driver allowance', amount: 1500 },
        ],
      },
    );
    expect(Number(trip.data.km)).toBe(810);
    await t.moveTo(trip.id, 'start');
    expect(await t.moveTo(trip.id, 'close')).toMatchObject({ status: 'closed' });
    expect(await t.through('Trip expense claim', { trip: trip.code, amount: 3950 })).toBe('CLOSED');

    // K40 — the owner's view: freight by vehicle, who owes, the Weekly MIS.
    await t.made('CN', {
      consignor: 'GGM Minerals',
      consignee: 'Royal Marbles',
      from: 'Kishangarh',
      to: 'Jaipur',
      weight_t: 8,
      freight: 12_000,
      vehicle: 'RJ14 GB 5678',
    });
    expect((await t.run('Freight by vehicle')).rows).toEqual([
      ['RJ14 GA 1234', 46_500],
      ['RJ14 GB 5678', 12_000],
    ]);
    const statement = await w.api.get(`/api/money/parties/${consignor}/statement`);
    expect(statement.status).toBe(200);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
