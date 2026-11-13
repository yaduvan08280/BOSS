import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a pharmacy (phase 21)', { timeout: 120_000 }, () => {
  it('K1–K5: set up from the pack; medicines bought by batch; sold first-expired-first-out; the Schedule H register and an expiry return; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'pharmacy');
    const { companyId } = t;

    // K1 — set up from the pack alone: roles, medicines tracked by batch, the prescription with its doctors, the process, the registers.
    expect(t.installed.made.map((m) => m.kind)).toEqual(
      expect.arrayContaining(['role', 'tax', 'master', 'item', 'rt', 'flow', 'report']),
    );
    expect(
      await ctx.prisma.item.findMany({
        where: { companyId },
        select: { code: true, tracking: true },
        orderBy: { code: 'asc' },
      }),
    ).toEqual([
      { code: 'AZI500', tracking: 'BATCH' },
      { code: 'ORS', tracking: 'BATCH' },
      { code: 'PCM500', tracking: 'BATCH' },
    ]);
    expect(await ctx.prisma.flow.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      name: 'Expiry return to the distributor',
      status: 'PUBLISHED',
    });
    // The tax codes came as shells: the accountant types the rates.
    await t.rate('MED12', 12);
    await t.rate('MED5', 5);

    // K2 — buy and receive: two lots of paracetamol with different expiry, one of azithromycin; the distributor's bill is raised.
    const first = await t.buy('Medico', [
      { code: 'PCM500', qty: 100, ratePaise: 20_00, batch: { code: 'P-SOON', expiry: today(40) } },
      { code: 'AZI500', qty: 30, ratePaise: 80_00, batch: { code: 'A-1', expiry: today(300) } },
    ]);
    await t.buy('Medico', [
      { code: 'PCM500', qty: 100, ratePaise: 21_00, batch: { code: 'P-LATER', expiry: today(400) } },
      { code: 'ORS', qty: 200, ratePaise: 15_00, batch: { code: 'O-1', expiry: today(500) } },
    ]);
    expect([await t.stock('PCM500'), await t.stock('AZI500')]).toEqual([200, 30]);
    expect(first.grn.poStatus).toBe('RECEIVED');
    const payable = await t.owed('payable');
    // The distributor's bills carry input tax: (₹2,000 + ₹2,400 + ₹2,100) × 1.12 and ₹3,000 of ORS × 1.05.
    const bought = Math.round((100 * 20_00 + 30 * 80_00 + 100 * 21_00) * 1.12 + 200 * 15_00 * 1.05);
    expect(payable.rows).toMatchObject([{ party: { name: 'Medico Pvt Ltd' }, due: bought }]);
    const lot = async (code: string) => {
      const b = await ctx.prisma.stockBatch.findFirstOrThrow({ where: { companyId, code } });
      const rows = await ctx.prisma.stockBalance.findMany({ where: { batchId: b.id } });
      return rows.reduce((n, r) => n + Number(r.qty), 0);
    };

    // K3 — sell and bill at the counter: the lot that expires first leaves first; tax is on the bill; cash is taken.
    const walkIn = await t.party('Counter customer', ['customer']);
    const sale = await t.sold({
      partyId: walkIn,
      lines: [{ barcode: '8901000000011', qty: 5 }],
      paid: 168_00,
      modeId: t.cash,
    });
    // 5 strips at ₹30 + 12 % = ₹168.
    expect(sale.total).toBe(168_00);
    expect(sale.lines[0]).toMatchObject({ rate: 30_00, source: 'item' });
    expect([await lot('P-SOON'), await lot('P-LATER')]).toEqual([95, 100]);
    expect(await ctx.prisma.bill.findUniqueOrThrow({ where: { id: sale.billId } })).toMatchObject({
      status: 'PAID',
      tax: 18_00n,
    });
    // An expired lot on the shelf is never sold: a big sale takes the good lots and leaves it.
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('PCM500'),
        type: 'IN',
        qty: 50,
        ratePaise: 20_00,
        batch: { code: 'P-DEAD', expiry: today(-3) },
      }),
    );
    await t.sold({ partyId: walkIn, lines: [{ itemId: t.item('PCM500'), qty: 100 }] });
    expect([await lot('P-SOON'), await lot('P-LATER'), await lot('P-DEAD')]).toEqual([0, 95, 50]);
    expect((await t.sell({ partyId: walkIn, lines: [{ itemId: t.item('PCM500'), qty: 96 }] })).status).toBe(
      409,
    );

    // K4 — the trade's own: a Schedule H medicine is dispensed against a prescription and is on the register; near-expiry stock goes back.
    const rx = await t.made('RX', {
      patient: 'Asha Verma',
      doctor: 'Dr S. Mehta',
      medicine: 'Azithromycin 500 mg',
      qty: 1,
      schedule: 'Schedule H',
      rx_date: today(),
    });
    await t.made('RX', {
      patient: 'Ravi Kumar',
      doctor: 'Dr A. Khan',
      medicine: 'Paracetamol 500 mg',
      qty: 2,
      schedule: 'None',
    });
    expect(
      (await t.record('RX', { patient: 'No schedule given', doctor: 'Dr A. Khan', medicine: 'X', qty: 1 }))
        .status,
    ).toBe(400);
    await t.sold({ partyId: walkIn, lines: [{ itemId: t.item('AZI500'), qty: 1 }] });
    expect(await t.moveTo(rx.id, 'dispense')).toMatchObject({ status: 'dispensed' });
    const registerRows = (await t.run('Schedule H register')).rows;
    expect(registerRows).toHaveLength(1);
    expect(registerRows[0]).toEqual(
      expect.arrayContaining(['Asha Verma', 'Dr S. Mehta', 'Azithromycin 500 mg']),
    );
    // Ten strips of azithromycin go back to the distributor: stock out, its bill credited, and the return runs through its process.
    const back = await ok<{ credit: number }>(
      w.api.post(`/api/ims/grn/${first.grn.id}/return`, {
        lines: [{ itemId: t.item('AZI500'), qty: 10 }],
        reason: 'Near expiry',
      }),
    );
    expect(back.credit).toBe(10 * 80_00);
    expect(await t.stock('AZI500')).toBe(19);
    const er = await t.made('ER', {
      vendor: 'Medico',
      medicine: 'Azithromycin 500 mg',
      batch: 'A-1',
      qty: 10,
      reason: 'Near expiry',
    });
    expect(
      await t.through('Expiry return to the distributor', {
        vendor: 'Medico',
        medicine: 'Azithromycin A-1',
        qty: 10,
      }),
    ).toBe('CLOSED');
    expect(await t.moveTo(er.id, 'return')).toMatchObject({ status: 'returned' });

    // K5 — the owner's view: a report, the stock register of a medicine, who owes and who is owed, the Weekly MIS.
    expect((await t.run('Prescriptions by doctor')).rows).toEqual([
      ['Dr A. Khan', 1],
      ['Dr S. Mehta', 1],
    ]);
    const hospital = await t.party('City Hospital', ['customer'], { creditDays: 15 });
    const credit = await t.sold({ partyId: hospital, lines: [{ itemId: t.item('ORS'), qty: 40 }] });
    // 40 sachets at ₹22 + 5 %.
    expect(credit.total).toBe(924_00);
    expect((await t.owed()).rows.find((r) => r.party.name === 'City Hospital')).toMatchObject({
      due: 924_00,
      overdue: 0,
    });
    // What is owed to the distributor fell by the credit for what went back.
    const credited = Number(
      (await ctx.prisma.bill.findUniqueOrThrow({ where: { id: first.grn.billId } })).credited,
    );
    expect(credited).toBeGreaterThanOrEqual(10 * 80_00);
    expect((await t.owed('payable')).rows[0]!.due).toBe(bought - credited);
    const register = await w.api.get(
      `/api/ims/register?itemId=${t.item('PCM500')}&from=${today(-1)}&to=${today(1)}`,
    );
    expect(register.status).toBe(200);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
