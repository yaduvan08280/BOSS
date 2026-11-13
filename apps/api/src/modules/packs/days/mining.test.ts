import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a mine (phase 21)', { timeout: 120_000 }, () => {
  it('K41–K45: set up from the pack; diesel received; ore weighed, passed and sold by the tonne; the royalty-pass register; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'mining');
    const { companyId } = t;

    // K41 — set up from the pack: ore by the tonne, the weighbridge slip, the royalty pass, the dispatch process.
    expect(await ctx.prisma.item.findFirstOrThrow({ where: { companyId, code: 'QTZLUMP' } })).toMatchObject({
      unit: 't',
      taxCode: 'MIN5',
    });
    await t.rate('MIN5', 5);

    // K42 — buy and receive: diesel for the machines comes in and is issued to the excavator.
    await t.buy('Tonk Fuels', [{ code: 'DIESEL', qty: 2000, ratePaise: 92_00 }]);
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('DIESEL'),
        type: 'OUT',
        qty: 350,
        note: 'Excavator EX-2',
      }),
    );
    expect(await t.stock('DIESEL')).toBe(1650);
    // The day's production of ore is taken into stock by the tonne.
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('QTZLUMP'),
        type: 'IN',
        qty: 120,
        ratePaise: 600_00,
        note: 'Pit 3, day shift',
      }),
    );

    // K43 — sell and bill: a truck is weighed (net worked out by MONO), and the ore is invoiced by the net tonnes.
    const slip = await t.made('WB', {
      vehicle: 'RJ14 GA 1234',
      mineral: 'Quartz',
      gross_t: 28.4,
      tare_t: 10.15,
    });
    expect(Number(slip.data.net_t)).toBe(18.25);
    const buyer = await t.party('Levanto Quartz', ['customer'], { creditDays: 30 });
    const bill = await t.sold({ partyId: buyer, lines: [{ itemId: t.item('QTZLUMP'), qty: 18.25 }] });
    // 18.25 t at ₹1,800 + 5 %.
    expect(bill.total).toBe(Math.round((18.25 * 1800_00 * 1.05) / 100) * 100);
    expect(await t.stock('QTZLUMP')).toBe(101.75);
    expect((await t.sell({ partyId: buyer, lines: [{ itemId: t.item('QTZLUMP'), qty: 500 }] })).status).toBe(
      409,
    );

    // K44 — the trade's own: a royalty pass has one number, once; the truck goes out through the dispatch process.
    const pass = await t.made('RP', {
      pass_no: 'RJ/TNK/2026/004512',
      vehicle: 'RJ14 GA 1234',
      mineral: 'Quartz',
      weight_t: 18.25,
      destination: 'Kishangarh',
      issued_on: today(),
    });
    expect(
      (
        await t.record('RP', {
          pass_no: 'rj/tnk/2026/004512',
          vehicle: 'RJ14 GB 5678',
          mineral: 'Quartz',
          weight_t: 9,
          destination: 'Jaipur',
        })
      ).status,
    ).not.toBe(200);
    await t.made('RP', {
      pass_no: 'RJ/TNK/2026/004513',
      vehicle: 'RJ14 GB 5678',
      mineral: 'Feldspar',
      weight_t: 9.5,
      destination: 'Jaipur',
    });
    expect(
      await t.through('Mine dispatch', {
        vehicle: 'RJ14 GA 1234',
        buyer: 'Levanto Quartz',
        mineral: 'Quartz',
      }),
    ).toBe('CLOSED');
    await t.moveTo(pass.id, 'use');
    expect(await t.moveTo(slip.id, 'gate_out')).toMatchObject({ status: 'gone' });

    // K45 — the owner's view: the royalty-pass register, tonnes by mineral, who owes, the Weekly MIS.
    const register = (await t.run('Royalty-pass register')).rows;
    expect(register).toHaveLength(2);
    expect(register.flat()).toEqual(expect.arrayContaining(['RJ/TNK/2026/004512', 'RJ/TNK/2026/004513']));
    expect((await t.run('Tonnes dispatched by mineral')).rows).toEqual([
      ['Quartz', 18.25],
      ['Feldspar', 9.5],
    ]);
    expect((await t.owed()).rows).toMatchObject([{ party: { name: 'Levanto Quartz' }, due: bill.total }]);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
