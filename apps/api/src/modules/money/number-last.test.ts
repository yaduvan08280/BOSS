import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tx } from '@mono/db';
import { counting, makeApp } from '../../test/helpers';
import { world } from '../records/testkit';
import { actorFor } from '../work/actor';
import { createBillIn } from './bills';
import { books, meal, type BillOut } from './money-kit';

let ctx: Awaited<ReturnType<typeof makeApp>>;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(async () => ctx.app.close());

/**
 * A series with no gaps is held by whoever took its last number until their transaction ends. Thirty POS
 * devices taking payments therefore wait on each other for exactly as long as the work that follows the
 * number — so the number is taken after the money is set against its bills, not before.
 */
describe('a paper takes its number as late as it can', () => {
  it('a receipt: everything is done before the number, which is the last statement and writes itself everywhere', async () => {
    const w = await world(ctx.app);
    const b = await books(w);
    const at = { partyId: b.sharma.id, date: '2031-02-10' };
    const invoice = await b.bill(w.api, { type: 'INVOICE', ...at, lines: meal });
    const issued = (await w.api.post(`/api/money/bills/${invoice.id}/issue`, {})).body as BillOut;
    expect(issued.number).toMatch(/^INV/);
    const owner = (await actorFor(ctx.prisma, w.companyId, w.owner.id))!;

    let calls: string[] = [];
    const receipt = await ctx.prisma.$transaction(async (tx) => {
      const watch = counting(tx);
      const made = await createBillIn(watch.db as Tx, owner, {
        type: 'RECEIPT',
        ...at,
        lines: [],
        charges: [],
        discount: 0,
        taxInclusive: false,
        amount: issued.total,
        modeId: b.cash.id,
      });
      calls = watch.seen.calls;
      return made;
    });
    expect(receipt.number).toMatch(/^RCT/);
    expect(receipt.settled).toBe(BigInt(issued.total));
    const paid = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(paid.status).toBe('PAID');

    const number = calls.lastIndexOf('$queryRaw');
    expect(number).toBeGreaterThan(0);
    const before = calls.slice(0, number);
    const after = calls.slice(number + 1);
    // The receipt is not read back before it is numbered: setting it against the invoice hands it on.
    expect(calls).not.toContain('bill.findUniqueOrThrow');
    expect(before).toContain('billAllocation.create');
    expect(before).toContain('voucher.create');
    expect(before).toContain('auditLog.create');
    expect(before).toContain('domainEvent.create');
    // The number is the last statement: it writes itself into the paper, the voucher, the audit row and the
    // event in the same statement, and nothing follows it but the end of the transaction.
    expect(after).toEqual([]);
    const voucher = await ctx.prisma.voucher.findFirstOrThrow({ where: { billId: receipt.id } });
    expect(voucher.narration).toBe(receipt.number);
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({
      where: { entityId: receipt.id, action: 'bill.issued' },
    });
    expect((audit.after as { number: string }).number).toBe(receipt.number);
    const event = await ctx.prisma.domainEvent.findFirstOrThrow({
      where: { entityId: receipt.id, name: 'bill.issued' },
    });
    expect((event.payload as { number: string }).number).toBe(receipt.number);
    // The stored paper is what the caller was handed back.
    const stored = await ctx.prisma.bill.findUniqueOrThrow({ where: { id: receipt.id } });
    expect({ ...stored, updatedAt: null }).toEqual({ ...receipt, updatedAt: null });
  });
});
