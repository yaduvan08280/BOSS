import { nextCounter, type Db, type Tx } from '@mono/db';
import { entityDetailsSchema, financialYear, formatMoney, type EntityDetails } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { writeAudit } from '../../lib/audit';
import { can, type Actor } from '../work/actor';
import { needBrandTeam } from './guard';

/**
 * Royalty and fees (phase 12, plan §3.8): each month a franchise owes a share of its sales and / or a fixed fee,
 * never less than its minimum guarantee. Worked out from the terms on the franchise's entity and the sales its
 * branches booked that month; one invoice per franchise per month, numbered ROY/{FY}/0001.
 */
export type RoyaltyTerms = NonNullable<EntityDetails['franchise']>;

/** The figures of a month: pure, so the rule can be read (and tested) on its own. */
export function royaltyFor(terms: RoyaltyTerms, salesPaise: number) {
  const royalty = Math.round((salesPaise * (terms.royaltyPercent ?? 0)) / 100);
  const fixed = terms.fixedMonthlyPaise ?? 0;
  const minimum = terms.minimumPaise ?? 0;
  const earned = royalty + fixed;
  return { royalty, fixed, amount: Math.max(earned, minimum), minimumUsed: minimum > earned };
}

const needAdmin = (a: Actor) => needBrandTeam(a, 'runs royalties');
const termsOf = (details: unknown): RoyaltyTerms =>
  entityDetailsSchema.safeParse(details).data?.franchise ?? {};

/** What a franchise's branches sold in a month (orders not cancelled, by order date), before tax. */
export async function salesOf(db: Db | Tx, companyId: string, entityId: string, month: string) {
  const branches = await db.branch.findMany({ where: { companyId, entityId }, select: { id: true } });
  const sum = await db.salesOrder.aggregate({
    where: {
      companyId,
      branchId: { in: branches.map((b) => b.id) },
      status: { not: 'CANCELLED' },
      orderDate: { gte: `${month}-01`, lte: `${month}-31` },
    },
    _sum: { amount: true },
  });
  return Number(sum._sum.amount ?? 0n);
}

const shape = (r: {
  id: string;
  entityId: string;
  month: string;
  number: string;
  salesPaise: bigint;
  royaltyPaise: bigint;
  fixedPaise: bigint;
  amountPaise: bigint;
  minimumUsed: boolean;
  status: string;
}) => ({
  id: r.id,
  entityId: r.entityId,
  month: r.month,
  number: r.number,
  salesPaise: Number(r.salesPaise),
  royaltyPaise: Number(r.royaltyPaise),
  fixedPaise: Number(r.fixedPaise),
  amountPaise: Number(r.amountPaise),
  minimumUsed: r.minimumUsed,
  status: r.status,
});

/** A franchise's own people see their own invoices; the brand team sees all. */
export async function listRoyalties(db: Db, actor: Actor, onlyEntityId?: string | null) {
  if (!onlyEntityId && !can(actor, 'franchise.view'))
    throw new AppError(403, 'FORBIDDEN', "You can't see franchise royalties");
  const rows = await db.royaltyInvoice.findMany({
    where: { companyId: actor.companyId, ...(onlyEntityId ? { entityId: onlyEntityId } : {}) },
    orderBy: [{ month: 'desc' }, { number: 'asc' }],
    take: 300,
  });
  return rows.map(shape);
}

/** Raise the month's invoice for one franchise (once: asking again returns the one already made). */
export async function raiseRoyalty(db: Db, actor: Actor, entityId: string, month: string) {
  needAdmin(actor);
  const entity = await db.legalEntity.findFirst({
    where: { id: entityId, companyId: actor.companyId, deletedAt: null, kind: 'FRANCHISE' },
  });
  if (!entity) throw notFound('Franchise');
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const [y, m] = month.split('-').map(Number) as [number, number];
  // The month must be over: its sales are still coming in until then.
  const end = new Date(Date.UTC(y, m, 1));
  if (end > new Date()) throw new AppError(400, 'VALIDATION_FAILED', 'This month has not ended yet');
  const terms = termsOf(entity.details);
  if (!terms.royaltyPercent && !terms.fixedMonthlyPaise && !terms.minimumPaise)
    throw new AppError(409, 'CONFLICT', `Set ${entity.name}'s royalty terms first`);
  return db.$transaction(async (tx) => {
    const have = await tx.royaltyInvoice.findUnique({ where: { entityId_month: { entityId, month } } });
    if (have) return shape(have);
    const sales = await salesOf(tx, actor.companyId, entityId, month);
    const due = royaltyFor(terms, sales);
    const fy = financialYear(
      new Date(Date.UTC(y, m - 1, 15)),
      company.timezone,
      company.fyStartMonth ?? 4,
    ).short;
    const seq = await nextCounter(tx, actor.companyId, 'royalty', fy);
    const row = await tx.royaltyInvoice.create({
      data: {
        companyId: actor.companyId,
        entityId,
        month,
        number: `ROY/${fy}/${String(seq).padStart(4, '0')}`,
        salesPaise: BigInt(sales),
        royaltyPaise: BigInt(due.royalty),
        fixedPaise: BigInt(due.fixed),
        amountPaise: BigInt(due.amount),
        minimumUsed: due.minimumUsed,
        createdById: actor.userId,
      },
    });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'franchise.royalty_raised',
        entityType: 'royalty_invoice',
        entityId: row.id,
        after: shape(row),
      },
    );
    // The franchise's own managers hear about it (their branch names the recipients).
    const branch = await tx.branch.findFirst({
      where: { companyId: actor.companyId, entityId, deletedAt: null },
      select: { id: true },
    });
    await emitEvent(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        name: 'franchise.royalty_invoiced',
        entityType: 'royalty_invoice',
        entityId: row.id,
        payload: {
          branchId: branch?.id ?? null,
          place: entity.name,
          number: row.number,
          month,
          amount: formatMoney(due.amount, entity.currency),
          sales: formatMoney(sales, entity.currency),
          link: '/outlets',
        },
      },
    );
    return shape(row);
  });
}

/** Mark an invoice paid, or cancel one raised by mistake (the number is never reused). */
export async function setRoyaltyStatus(db: Db, actor: Actor, id: string, status: 'PAID' | 'CANCELLED') {
  needAdmin(actor);
  const row = await db.royaltyInvoice.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw notFound('Royalty invoice');
  if (row.status !== 'ISSUED') throw new AppError(409, 'CONFLICT', 'This invoice is already settled');
  const next = await db.royaltyInvoice.update({ where: { id }, data: { status } });
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    { action: 'franchise.royalty_status', entityType: 'royalty_invoice', entityId: id, after: { status } },
  );
  return shape(next);
}
