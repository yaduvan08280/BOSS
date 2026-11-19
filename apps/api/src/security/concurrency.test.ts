import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from '../test/helpers';
import { books, meal, ok, type BillOut } from '../modules/money/money-kit';
import { world } from '../modules/records/testkit';

/**
 * Things done at the same moment by many people (a busy evening, a double tap, two cashiers): the database
 * must give each its own number, never let stock go below zero, and never take a payment twice.
 */
describe('at the same moment', () => {
  let ctx: Awaited<ReturnType<typeof makeApp>>;
  beforeAll(async () => {
    ctx = await makeApp({ API_RATE_LIMIT: '0' });
  });
  afterAll(async () => ctx.app.close());

  it('40 tasks given at once get 40 different numbers, with no gap and no failure', async () => {
    const w = await world(ctx.app);
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const made = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        w.api.post('/api/tasks', { doerId: w.owner.id, plannedAt: due, description: `Parallel task ${i}` }),
      ),
    );
    expect(made.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    const numbers = made.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(40);
    expect(numbers.at(-1)! - numbers[0]!).toBe(39);
  });

  it('30 invoices issued at once get 30 consecutive numbers of the series', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const drafts = [];
    for (let i = 0; i < 30; i++)
      drafts.push(
        await b.bill(w.api, { type: 'INVOICE', partyId: b.sharma.id, date: '2031-02-01', lines: meal }),
      );
    const issued = await Promise.all(drafts.map((d) => w.api.post(`/api/money/bills/${d.id}/issue`, {})));
    expect(issued.map((r) => r.status).filter((s) => s !== 200)).toEqual([]);
    const seq = issued.map((r) => Number(String(r.body.number).split('/').at(-1))).sort((x, y) => x - y);
    expect(seq).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('20 people taking 1 from a stock of 12: exactly 12 succeed, the stock ends at 0, never below', async () => {
    const w = await world(ctx.app);
    const item = (
      await w.api.post('/api/ims/items', {
        code: 'PAR-1',
        name: 'Parallel part',
        unit: 'pcs',
        openingQty: 12,
      })
    ).body as { id: string };
    const taken = await Promise.all(
      Array.from({ length: 20 }, () =>
        w.api.post('/api/ims/moves', { itemId: item.id, type: 'OUT', qty: 1 }),
      ),
    );
    expect(taken.filter((r) => r.status === 200)).toHaveLength(12);
    expect(taken.filter((r) => r.status === 409)).toHaveLength(8);
    const row = await ctx.prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(row.stock)).toBe(0);
    const balances = await ctx.prisma.stockBalance.findMany({ where: { itemId: item.id } });
    expect(balances.every((x) => Number(x.qty) >= 0)).toBe(true);
    expect(balances.reduce((n, x) => n + Number(x.qty), 0)).toBe(0);
  });

  it('the same bill paid in full by ten cashiers at once is paid once; the rest stay as money on account', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const draft = await b.bill(w.api, {
      type: 'INVOICE',
      partyId: b.sharma.id,
      date: '2031-02-01',
      lines: meal,
    });
    const inv = await ok<BillOut>(w.api.post(`/api/money/bills/${draft.id}/issue`, {}));
    const pays = await Promise.all(
      Array.from({ length: 10 }, () =>
        w.api.post('/api/money/bills', {
          type: 'RECEIPT',
          partyId: b.sharma.id,
          date: '2031-02-02',
          amount: inv.total,
          modeId: b.cash.id,
        }),
      ),
    );
    const good = pays.filter((r) => r.status === 200);
    // However many receipts were taken, the invoice is settled for exactly its total — never more.
    const settledOnInvoice = good.reduce((n, r) => n + Number((r.body as BillOut).settled), 0);
    expect(settledOnInvoice).toBe(inv.total);
    const after = await ok<BillOut>(w.api.get(`/api/money/bills/${inv.id}`));
    expect(after).toMatchObject({ status: 'PAID', due: 0 });
    const allocated = await ctx.prisma.billAllocation.aggregate({
      where: { billId: inv.id },
      _sum: { amount: true },
    });
    expect(Number(allocated._sum.amount)).toBe(inv.total);
  });
});
