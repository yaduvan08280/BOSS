import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../../../test/helpers';
import { world } from '../../records/testkit';
import { ok, quiet, today, trade } from './day-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

describe('A working day at a distributor (phase 21)', { timeout: 120_000 }, () => {
  it('K16–K20: set up from the pack; stock bought; a dealer billed at the dealer price on credit; the order runs to dispatch; the owner’s view', async () => {
    const w = await world(ctx.app);
    const t = await trade(ctx.prisma, w, 'wholesale');
    const { companyId } = t;

    // K16 — set up from the pack: items, the dealer price list, the order-to-dispatch process.
    expect(await ctx.prisma.priceList.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      name: 'Dealer price',
      partyKind: 'dealer',
    });
    expect(await ctx.prisma.flow.findFirstOrThrow({ where: { companyId } })).toMatchObject({
      name: 'Dealer order to dispatch',
      status: 'PUBLISHED',
    });
    await t.rate('GST18', 18);

    // K17 — buy and receive from the manufacturer.
    await t.buy('Supreme Pipes', [
      { code: 'PIPE1', qty: 500, ratePaise: 300_00 },
      { code: 'ELBOW1', qty: 2000, ratePaise: 18_00 },
    ]);
    expect([await t.stock('PIPE1'), await t.stock('ELBOW1')]).toEqual([500, 2000]);

    // K18 — sell and bill: a dealer pays the dealer price and takes 30 days' credit; a walk-in pays the counter price.
    const dealer = await t.party('Sharma Sanitary', ['dealer', 'customer'], { creditDays: 30 });
    const walkIn = await t.party('Walk-in', ['customer']);
    const order = [
      { itemId: t.item('PIPE1'), qty: 100 },
      { itemId: t.item('ELBOW1'), qty: 400 },
    ];
    const bill = await t.sold({ partyId: dealer, lines: order });
    expect(bill.lines.map((l) => [l.rate, l.source])).toEqual([
      [360_00, 'list'],
      [22_00, 'list'],
    ]);
    // (100 × ₹360 + 400 × ₹22) + 18 %.
    expect(bill.total).toBe(Math.round((100 * 360_00 + 400 * 22_00) * 1.18));
    expect(
      (
        await t.sold({
          partyId: walkIn,
          lines: [{ itemId: t.item('PIPE1'), qty: 1 }],
          paid: 496_00,
          modeId: t.cash,
        })
      ).lines[0]!.rate,
    ).toBe(420_00);
    const invoice = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: bill.billId } });
    expect(invoice.dueOn).toBe(today(30));

    // K19 — the trade's own: the dealer's order moves through confirm, pick and pack, dispatch (with the LR number) and invoice.
    const id = await t.flow('Dealer order to dispatch');
    const rec = await ok<{ id: string }>(
      w.api.post(`/api/fms/flows/${id}/records`, {
        data: {
          dealer: 'Sharma Sanitary',
          lines: [{ item: 'PVC pipe 1 inch (6 m)', qty: 100, rate: 360 }],
          promised: today(2),
        },
      }),
    );
    const step = async () =>
      (
        await ok<{ status: string; steps: { id: string; stepKey: string; status: string }[] }>(
          w.api.get(`/api/fms/records/${rec.id}`),
        )
      ).steps.find((s) => s.status === 'OPEN');
    const done = async (body: object) => w.api.post(`/api/fms/steps/${(await step())!.id}/complete`, body);
    await ok(done({}));
    // Pick and pack needs its checklist; dispatch needs the LR number.
    expect((await done({})).status).toBe(400);
    await ok(done({ checklistDone: ['Quantities counted', 'Packed and labelled'] }));
    expect((await done({})).status).toBe(400);
    await ok(done({ data: { lr_no: 'LR-55812', transporter: 'VRL' } }));
    await ok(done({}));
    expect((await ok<{ status: string }>(w.api.get(`/api/fms/records/${rec.id}`))).status).toBe('CLOSED');

    // K20 — the owner's view: what dealers owe by age, the dealer's statement, a part payment, the Weekly MIS.
    const owed = await t.owed();
    expect(owed.rows).toMatchObject([{ party: { name: 'Sharma Sanitary' }, due: bill.total, overdue: 0 }]);
    await t.receipt(dealer, 20_000_00);
    expect((await t.owed()).rows[0]!.due).toBe(bill.total - 20_000_00);
    const statement = await w.api.get(`/api/money/parties/${dealer}/statement`);
    expect(statement.status).toBe(200);
    expect(JSON.stringify(statement.body)).toContain(bill.number);
    expect((await w.api.get(`/api/fms/flows/${id}/report`)).status).toBe(200);
    expect((await t.mis()).rows.length).toBeGreaterThan(0);
    await quiet(ctx.prisma, companyId);
  });
});
