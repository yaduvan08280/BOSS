import type { Db, Prisma } from '@mono/db';
import { AGGREGATORS, localDate, parsePayout, reconcile } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { need } from '../hosp/access';
import { createBillIn } from '../money/bills';
import type { Actor } from '../work/actor';

/**
 * Phase 19 — delivery aggregators (Zomato, Swiggy …). An order that came through one is tagged with its number
 * there and billed in the aggregator's name: the guest paid the aggregator, so the bill stays owed by it until
 * its payout file is imported. The file is set against the tagged orders: what was paid becomes a receipt, what
 * the aggregator kept (commission, charges) a credit note, and whatever does not add up is shown.
 */
const NAMES: Record<string, string> = { ZOMATO: 'Zomato', SWIGGY: 'Swiggy', OTHER: 'Delivery partner' };
export const tagSchema = z.object({
  aggregator: z.enum(AGGREGATORS),
  ref: z.string().trim().min(1).max(60),
});

/** The aggregator's party, and the "on the aggregator's account" way of paying (made on first need). */
export async function aggregatorBooks(
  db: Db | Prisma.TransactionClient,
  companyId: string,
  aggregator: string,
) {
  const id = `agg_${aggregator.toLowerCase()}_${companyId}`.slice(0, 40);
  const party =
    (await db.party.findFirst({ where: { id } })) ??
    (await db.party.create({
      data: {
        id,
        companyId,
        code: `AGG-${aggregator}`,
        name: NAMES[aggregator] ?? aggregator,
        kinds: ['company'],
      },
    }));
  const mode =
    (await db.paymentMode.findFirst({
      where: { companyId, name: 'Aggregator', kind: 'COMPANY', deletedAt: null },
    })) ?? (await db.paymentMode.create({ data: { companyId, name: 'Aggregator', kind: 'COMPANY' } }));
  return { partyId: party.id, modeId: mode.id };
}

/** Mark a running order as an aggregator's: its bill will be in the aggregator's name. */
export async function tagOrder(db: Db, actor: Actor, orderId: string, input: z.input<typeof tagSchema>) {
  need(actor, 'hosp.create', "You can't change orders");
  const t = tagSchema.parse(input);
  const order = await db.posOrder.findFirst({ where: { id: orderId, companyId: actor.companyId } });
  if (!order) throw notFound('Order');
  if (order.status !== 'OPEN') throw new AppError(409, 'CONFLICT', 'Only a running order can be tagged');
  if (await db.posCheck.count({ where: { orderId, status: { not: 'CANCELLED' } } }))
    throw new AppError(409, 'CONFLICT', 'This order already has a bill');
  const twin = await db.posOrder.findFirst({
    where: {
      companyId: actor.companyId,
      aggregator: t.aggregator,
      aggregatorRef: t.ref,
      id: { not: orderId },
      status: { not: 'CANCELLED' },
    },
  });
  if (twin)
    throw new AppError(409, 'CONFLICT', `Order ${t.ref} of ${NAMES[t.aggregator]} is already on the POS`);
  return db.$transaction(async (tx) => {
    const books = await aggregatorBooks(tx, actor.companyId, t.aggregator);
    await tx.posOrder.update({
      where: { id: orderId },
      data: { aggregator: t.aggregator, aggregatorRef: t.ref, partyId: books.partyId },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'pos.order_tagged',
        entityType: 'pos_order',
        entityId: orderId,
        after: t,
      },
    );
    return { id: orderId, ...t, ...books };
  });
}

const importSchema = z.object({
  aggregator: z.enum(AGGREGATORS),
  csv: z.string().min(1).max(2_000_000),
  fileName: z.string().trim().max(120).nullish(),
  /** How the payout reached the bank (left out, the first bank mode, else one called "Bank"). */
  modeId: z.string().max(40).nullish(),
  /** Look only: nothing is recorded. */
  dryRun: z.boolean().default(false),
});

/** The aggregator's orders that are billed and still wait for their payout. */
async function waiting(db: Db, companyId: string, aggregator: string) {
  const orders = await db.posOrder.findMany({
    where: { companyId, aggregator, aggregatorRef: { not: null }, status: { in: ['BILLED', 'PAID'] } },
    orderBy: { openedAt: 'asc' },
  });
  const checks = await db.posCheck.findMany({
    where: { orderId: { in: orders.map((o) => o.id) }, status: { not: 'CANCELLED' } },
  });
  const bills = new Map(
    (await db.bill.findMany({ where: { id: { in: checks.map((c) => c.billId) } } })).map((b) => [b.id, b]),
  );
  return orders.map((o) => {
    const own = checks.filter((c) => c.orderId === o.id).map((c) => bills.get(c.billId)!);
    return {
      id: o.id,
      ref: o.aggregatorRef!,
      number: o.number,
      businessDay: o.businessDay,
      branchId: o.branchId,
      settled: o.settlement != null,
      bills: own,
      billed: own.reduce((n, b) => n + Number(b.total), 0),
      due: own.reduce((n, b) => n + Number(b.total - b.credited - b.settled), 0),
    };
  });
}

/**
 * Import a payout file. All or nothing on the file's own problems (a missing column, an order twice). Each order
 * found is settled once: a receipt for what was paid, a credit note for what was kept — never more than is owed.
 */
export async function importPayout(db: Db, actor: Actor, input: z.input<typeof importSchema>) {
  need(actor, 'hosp.edit', "You can't import payouts");
  const p = importSchema.parse(input);
  const file = parsePayout(p.csv);
  if (file.problems.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'The file has problems', { problems: file.problems });
  const orders = await waiting(db, actor.companyId, p.aggregator);
  const open = orders.filter((o) => !o.settled);
  const result = reconcile(
    open.map((o) => ({ ref: o.ref, billed: o.billed })),
    file.rows,
  );
  const already = new Set(orders.filter((o) => o.settled).map((o) => o.ref));
  const again = result.unknown.filter((r) => already.has(r.ref)).map((r) => r.ref);
  const unknown = result.unknown.filter((r) => !already.has(r.ref));
  const summary = {
    matched: result.matched.length,
    unknown: unknown.length,
    unpaid: result.unpaid.length,
    again: again.length,
    net: result.matched.reduce((n, m) => n + m.net, 0),
    deductions: result.matched.reduce((n, m) => n + m.deductions, 0),
    diff: result.matched.reduce((n, m) => n + m.diff, 0),
  };
  const out = { summary, matched: result.matched, unknown, unpaid: result.unpaid, again };
  if (p.dryRun) return { id: null, ...out };
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const id = await db.$transaction(
    async (tx) => {
      const { partyId } = await aggregatorBooks(tx, actor.companyId, p.aggregator);
      const mode =
        (p.modeId &&
          (await tx.paymentMode.findFirst({
            where: { id: p.modeId, companyId: actor.companyId, deletedAt: null },
          }))) ||
        (await tx.paymentMode.findFirst({
          where: { companyId: actor.companyId, kind: 'BANK', deletedAt: null, active: true },
        })) ||
        (await tx.paymentMode.create({ data: { companyId: actor.companyId, name: 'Bank', kind: 'BANK' } }));
      const row = await tx.payoutImport.create({
        data: {
          companyId: actor.companyId,
          aggregator: p.aggregator,
          fileName: p.fileName ?? null,
          summary,
          rows: out as unknown as Prisma.InputJsonValue,
          createdById: actor.userId,
        },
      });
      for (const m of result.matched) {
        const order = open.find((o) => o.ref === m.ref)!;
        let net = m.net;
        let kept = m.deductions;
        for (const bill of order.bills) {
          let due = Number(bill.total - bill.credited - bill.settled);
          const pay = Math.min(net, due);
          if (pay > 0) {
            await createBillIn(
              tx,
              actor,
              {
                type: 'RECEIPT',
                partyId,
                date: today,
                branchId: order.branchId,
                lines: [],
                charges: [],
                discount: 0,
                taxInclusive: false,
                amount: pay,
                modeId: mode.id,
                reference: m.ref,
              },
              {
                system: true,
                allocate: [{ billId: bill.id, amount: pay }],
                source: { type: 'payout', id: row.id },
              },
            );
            net -= pay;
            due -= pay;
          }
          const credit = Math.min(kept, due);
          if (credit > 0) {
            await createBillIn(
              tx,
              actor,
              {
                type: 'CREDIT_NOTE',
                partyId,
                date: today,
                branchId: order.branchId,
                againstId: bill.id,
                lines: [
                  {
                    item: `${NAMES[p.aggregator]} commission and charges — order ${m.ref}`,
                    qty: 1,
                    rate: credit,
                  },
                ],
                charges: [],
                discount: 0,
                taxInclusive: false,
              },
              { system: true, issue: true, source: { type: 'payout', id: row.id } },
            );
            kept -= credit;
          }
        }
        await tx.posOrder.update({
          where: { id: order.id },
          data: {
            settlement: {
              importId: row.id,
              at: new Date().toISOString(),
              billed: m.billed,
              net: m.net,
              deductions: m.deductions,
              diff: m.diff,
            },
          },
        });
      }
      await writeAudit(
        tx,
        { companyId: actor.companyId, actorId: actor.userId },
        {
          action: 'payout.imported',
          entityType: 'payout_import',
          entityId: row.id,
          after: summary,
        },
      );
      return row.id;
    },
    { timeout: 60_000 },
  );
  return { id, ...out };
}

/** Where each aggregator stands: orders waiting for a payout, what they are worth, and the files imported. */
export async function aggregatorReport(db: Db, actor: Actor) {
  need(actor, 'hosp.view', "You can't see hospitality");
  const sides = [];
  for (const aggregator of AGGREGATORS) {
    const orders = await waiting(db, actor.companyId, aggregator);
    if (!orders.length) continue;
    const open = orders.filter((o) => !o.settled);
    sides.push({
      aggregator,
      name: NAMES[aggregator],
      orders: orders.length,
      waiting: open.map((o) => ({
        id: o.id,
        ref: o.ref,
        number: o.number,
        businessDay: o.businessDay,
        billed: o.billed,
      })),
      waitingAmount: open.reduce((n, o) => n + o.due, 0),
    });
  }
  const imports = await db.payoutImport.findMany({
    where: { companyId: actor.companyId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, aggregator: true, fileName: true, summary: true, createdAt: true },
  });
  return { sides, imports };
}
