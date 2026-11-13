import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a developer (phase 21)', { timeout: 120_000 }, () => {
  it('K31–K35: set up from the pack; a unit is booked once; milestone demands are invoiced and paid; agreement to registry; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'real_estate');
    const { companyId } = t;

    // K31 — set up from the pack: the units with their prices, the booking with its payment schedule, the registry process.
    const units = await ctx.prisma.masterDef.findFirstOrThrow({ where: { companyId, name: 'Units' } });
    expect(await ctx.prisma.masterRow.count({ where: { masterId: units.id } })).toBe(3);
    await t.rate('RE5', 5);

    // K32 — buy and receive: a developer buys services, not stock — the architect's bill is entered and owed.
    const architect = await t.party('Design Studio', ['vendor']);
    const fee = await ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'PURCHASE_BILL',
        partyId: architect,
        date: today(),
        branchId: null,
        lines: [{ item: 'Architect fee — Tower A', hsn: '9983', qty: 1, rate: 2_00_000_00 }],
      }),
    );
    await ok(w.api.post(`/api/money/bills/${fee.id}/issue`));
    expect((await t.owed('payable')).rows).toMatchObject([
      { party: { name: 'Design Studio' }, due: 2_00_000_00 },
    ]);

    // K33 — sell: a flat is booked with its schedule; the same flat cannot be booked again while that booking lives.
    const schedule = [
      { milestone: 'On booking', percent: 10, due: today() },
      { milestone: 'On plinth', percent: 30, due: today(90) },
      { milestone: 'On possession', percent: 60, due: today(540) },
    ];
    const booking = await t.made(
      'BKG',
      { unit: 'A-101', buyer: 'Rohit Bansal', mobile: '9829066666', price: 60_00_000, booked_on: today() },
      { schedule },
    );
    expect(
      (await t.record('BKG', { unit: 'A-101', buyer: 'Someone Else', price: 60_00_000 })).status,
    ).not.toBe(200);
    expect((await t.record('BKG', { unit: 'Z-999', buyer: 'No such unit', price: 1 })).status).toBe(200);
    // The first demand (10 %) is invoiced with tax and paid.
    const buyer = await t.party('Rohit Bansal', ['customer']);
    await t.invoice(
      buyer,
      [
        {
          item: `${booking.code} A-101 — On booking (10 %)`,
          hsn: '9954',
          qty: 1,
          rate: 6_00_000_00,
          taxCode: 'RE5',
        },
      ],
      { dueOn: today(7) },
    );
    expect((await t.owed()).rows).toMatchObject([{ party: { name: 'Rohit Bansal' }, due: 6_30_000_00 }]);
    await t.receipt(buyer, 6_30_000_00);
    expect((await t.owed()).rows).toEqual([]);

    // K34 — the trade's own: agreement signed, then the registry — each with its proof — and the booking follows; a cancelled booking frees its unit.
    await t.moveTo(booking.id, 'sign');
    expect(await t.through('Agreement to registry', { unit: 'A-101', buyer: 'Rohit Bansal' })).toBe('CLOSED');
    expect(await t.moveTo(booking.id, 'register')).toMatchObject({ status: 'registered' });
    const other = await t.made('BKG', { unit: 'A-102', buyer: 'Meena Jain', price: 72_50_000 });
    await t.moveTo(other.id, 'cancel');
    expect((await t.record('BKG', { unit: 'A-102', buyer: 'Sunil Verma', price: 72_00_000 })).status).toBe(
      200,
    );

    // K35 — the owner's view: bookings by status with their value, what buyers owe, the Weekly MIS.
    const rows = (await t.run('Bookings by status')).rows;
    expect(Object.fromEntries(rows.map((r) => [r[0], r[1]]))).toMatchObject({
      Registered: 60_00_000,
      Cancelled: 72_50_000,
    });
    expect((await t.owed('payable')).rows).toHaveLength(1);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
