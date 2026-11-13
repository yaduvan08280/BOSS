import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a contractor (phase 21)', { timeout: 120_000 }, () => {
  it('K26–K30: set up from the pack; material received and used at the site; running bills to the client; a subcontractor; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'construction');
    const { companyId } = t;

    // K26 — set up from the pack: the project with its bill of quantities, running bills, work orders, the certification process.
    expect(
      (await ok<{ types: { prefix: string }[] }>(w.api.get('/api/records/types'))).types
        .map((x) => x.prefix)
        .sort(),
    ).toEqual(['PRJ', 'RA', 'WO']);
    await t.rate('WORKS18', 18);
    await t.rate('GST28', 28);
    const project = await t.made(
      'PRJ',
      { name: 'Sunrise Apartments', client: 'Sunrise Developers', value: 5_00_00_000, start: today() },
      {
        boq: [
          { item: 'RCC M25', unit: 'cum', qty: 1200, rate: 6500 },
          { item: 'Brickwork', unit: 'cum', qty: 800, rate: 5200 },
        ],
      },
    );
    // The BOQ's amounts are worked out line by line, and a project's name is used once.
    const boq = (
      await ok<{ record: { lines: { boq: { amount: number }[] } } }>(
        w.api.get(`/api/records/entries/${project.id}`),
      )
    ).record.lines.boq;
    expect(boq.map((l) => Number(l.amount))).toEqual([78_00_000, 41_60_000]);
    expect(
      (await t.record('PRJ', { name: 'sunrise apartments', client: 'Other', value: 1 })).status,
    ).not.toBe(200);
    await t.moveTo(project.id, 'start');

    // K27 — buy and receive: cement and steel for the site; the supplier's bill.
    await t.buy('Shree Cement Dealers', [
      { code: 'CEMENT', qty: 400, ratePaise: 380_00 },
      { code: 'STEEL', qty: 5000, ratePaise: 62_00 },
    ]);
    expect([await t.stock('CEMENT'), await t.stock('STEEL')]).toEqual([400, 5000]);
    // Used on the work: stock leaves; more than there is cannot be issued.
    await ok(
      w.api.post('/api/ims/stock/entry', {
        itemId: t.item('CEMENT'),
        type: 'OUT',
        qty: 150,
        note: `Slab casting — ${project.code}`,
      }),
    );
    expect(
      (await w.api.post('/api/ims/stock/entry', { itemId: t.item('CEMENT'), type: 'OUT', qty: 900 })).status,
    ).toBe(409);
    expect(await t.stock('CEMENT')).toBe(250);

    // K28 — sell and bill: the first running bill is measured, certified by an approver and invoiced to the client with tax.
    const client = await t.party('Sunrise Developers', ['customer'], { creditDays: 30 });
    const ra1 = await t.made('RA', {
      project: project.code,
      bill_no: 'RA-1',
      upto: today(),
      percent: 10,
      amount: 50_00_000,
    });
    const engineer = await w.person('Site Engineer');
    expect(
      (await engineer.api.post(`/api/records/entries/${ra1.id}/move`, { action: 'certify' })).status,
    ).toBe(403);
    await t.moveTo(ra1.id, 'certify');
    const invoiceId = await t.invoice(client, [
      {
        item: `RA-1 — ${project.code} Sunrise Apartments`,
        hsn: '9954',
        qty: 1,
        rate: 50_00_000_00,
        taxCode: 'WORKS18',
      },
    ]);
    expect(await t.moveTo(ra1.id, 'invoice')).toMatchObject({ status: 'invoiced' });
    const inv = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(Number(inv.total)).toBe(59_00_000_00);
    // The same RA number is not used twice; the bill runs through its process too.
    expect(
      (
        await t.record('RA', {
          project: project.code,
          bill_no: 'RA-1',
          upto: today(),
          percent: 20,
          amount: 1,
        })
      ).status,
    ).not.toBe(200);
    expect(
      await t.through('Running bill to the client', { project: 'Sunrise Apartments', bill_no: 'RA-1' }),
    ).toBe('CLOSED');

    // K29 — the trade's own: a subcontractor's work order, and his bill entered against it.
    const wo = await t.made('WO', {
      project: project.code,
      subcontractor: 'Khan Shuttering',
      work: 'Shuttering for slab 1',
      value: 3_50_000,
    });
    const sub = await t.party('Khan Shuttering', ['vendor']);
    const subBill = await ok<{ id: string }>(
      w.api.post('/api/money/bills', {
        type: 'PURCHASE_BILL',
        partyId: sub,
        date: today(),
        branchId: null,
        lines: [
          {
            item: `${wo.code} Shuttering for slab 1`,
            hsn: '9954',
            qty: 1,
            rate: 3_50_000_00,
            taxCode: 'WORKS18',
          },
        ],
      }),
    );
    await ok(w.api.post(`/api/money/bills/${subBill.id}/issue`));
    expect(await t.moveTo(wo.id, 'finish')).toMatchObject({ status: 'done' });
    const second = await t.made('RA', {
      project: project.code,
      bill_no: 'RA-2',
      upto: today(),
      percent: 25,
      amount: 75_00_000,
    });

    // K30 — the owner's view: running bills by project, what the client owes and what is owed to suppliers, the Weekly MIS.
    expect(second.status).toBe('measured');
    expect((await t.run('Running bills by project')).rows).toEqual([[project.code, 1_25_00_000]]);
    expect((await t.owed()).rows).toMatchObject([
      { party: { name: 'Sunrise Developers' }, due: 59_00_000_00 },
    ]);
    await t.receipt(client, 30_00_000_00);
    expect((await t.owed()).rows[0]!.due).toBe(29_00_000_00);
    expect((await t.owed('payable')).rows.map((r) => r.party.name).sort()).toEqual([
      'Khan Shuttering',
      'Shree Cement Dealers Pvt Ltd',
    ]);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
