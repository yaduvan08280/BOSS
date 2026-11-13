import { createId } from '@paralleldrive/cuid2';
import { nextCounter, type Bill, type Db, type Prisma, type Tx } from '@mono/db';
import {
  billMachine,
  computeBill,
  financialYear,
  minorUnits,
  MONEY_BILLS,
  transition,
  voucherFor,
  type BillInput,
  type BillRole,
  type BillTotals,
  type BillType,
  type TaxRegime,
} from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { emitEvent } from '../../lib/events';
import { letterheadOf, seriesOf, type Letterhead } from '../branches/letterhead';
import { homeBranchOf } from '../branches/reach';
import { can, type Actor } from '../work/actor';
import { taxReader } from './taxes';

/**
 * The bill engine (phase 12M): every money paper in MONO is made here — a counter bill, a stay bill, a purchase
 * bill, a credit note, a receipt. One way to work a paper out, one number series per entity and kind, one state
 * machine, one voucher per paper.
 */
export const BILL_PREFIX: Record<BillType, string> = {
  INVOICE: 'INV',
  CREDIT_NOTE: 'CN',
  DEBIT_NOTE: 'DN',
  RECEIPT: 'RCT',
  ADVANCE: 'ADV',
  PURCHASE_BILL: 'PB',
  VENDOR_PAYMENT: 'PAY',
  CHALLAN: 'DC',
};
const same = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();
const rolesOf = (actor: Actor, bill?: { createdById: string | null }): BillRole[] => [
  ...(can(actor, 'money.edit') ? (['accounts'] as const) : []),
  ...(can(actor, 'money.create') && (!bill || bill.createdById === actor.userId) ? (['maker'] as const) : []),
];
/** What a paper still has to be paid. */
export const dueOf = (b: { total: bigint; credited: bigint; settled: bigint }) =>
  Number(b.total - b.credited - b.settled);

type Seller = { head: Letterhead; regime: TaxRegime; state: string | null };
/** Who the paper is from: the branch's entity (its regime, state and currency), else the company itself. */
async function sellerOf(db: Db | Tx, companyId: string, branchId: string | null): Promise<Seller> {
  const head = await letterheadOf(db, companyId, branchId);
  const from = head.entityId
    ? await db.legalEntity.findFirst({ where: { id: head.entityId }, select: { state: true } })
    : await db.company.findUnique({ where: { id: companyId }, select: { state: true } });
  // With no tax profile: a tax number means GST as before; none means nothing is charged.
  const regime = (head.taxRegime as TaxRegime | null) ?? (head.taxId ? 'GST' : 'NONE');
  return { head, regime, state: from?.state ?? null };
}

/** A paper worked out from what was typed (no writes): totals, taxes, who it is from. */
export async function workOutBill(db: Db | Tx, companyId: string, input: BillInput, branchId: string | null) {
  const party = await db.party.findFirst({ where: { id: input.partyId, companyId, deletedAt: null } });
  if (!party) throw notFound('Party');
  const seller = await sellerOf(db, companyId, branchId);
  const money = MONEY_BILLS.includes(input.type);
  const totals: BillTotals = money
    ? {
        lines: [],
        charges: [],
        taxable: input.amount ?? 0,
        taxes: [],
        tax: 0,
        roundOff: 0,
        total: input.amount ?? 0,
      }
    : computeBill({
        lines: input.lines,
        charges: input.charges,
        discount: input.discount,
        taxInclusive: input.taxInclusive,
        regime: seller.regime,
        sameState: same(seller.state, party.state),
        percentOf: await taxReader(db, companyId, seller.head.entityId, input.date),
        roundTo: minorUnits(seller.head.currency),
      });
  return { party, seller, totals, money };
}

const stored = (input: BillInput, t: BillTotals) => ({
  date: input.date,
  partyId: input.partyId,
  lines: t.lines as unknown as Prisma.InputJsonValue,
  charges: t.charges as unknown as Prisma.InputJsonValue,
  discount: BigInt(input.discount ?? 0),
  taxInclusive: Boolean(input.taxInclusive),
  taxable: BigInt(t.taxable),
  tax: BigInt(t.tax),
  taxes: t.taxes as unknown as Prisma.InputJsonValue,
  roundOff: t.roundOff,
  total: BigInt(t.total),
  dueOn: input.dueOn ?? null,
  againstId: input.againstId ?? null,
  modeId: input.modeId ?? null,
  reference: input.reference ?? null,
  note: input.note ?? null,
});

export type BillSource = { type: string; id: string };
type Options = {
  /** Issue at once (money papers always are). */
  issue?: boolean;
  /** Carried over from before the engine: keep this number, take none from the series. */
  number?: string;
  source?: BillSource;
  /** Raised by MONO itself for another module (a CRM order, a process step): no money right is asked of the person. */
  system?: boolean;
  /** Set this money against these papers; otherwise the party's oldest papers first. */
  allocate?: { billId: string; amount: number }[];
};

/** Make a paper: a draft with lines, or a money paper (issued at once). */
export async function createBill(db: Db, actor: Actor, input: BillInput, opts: Options = {}) {
  if (!can(actor, 'money.create')) throw new AppError(403, 'FORBIDDEN', "You can't make bills");
  return db.$transaction((tx) => createBillIn(tx, actor, input, opts));
}

export async function createBillIn(tx: Tx, actor: Actor, input: BillInput, opts: Options = {}) {
  const branchId =
    input.branchId === undefined ? await homeBranchOf(tx, actor.companyId, actor.userId) : input.branchId;
  const { seller, totals, money } = await workOutBill(tx, actor.companyId, input, branchId);
  if (money && totals.total <= 0) throw new AppError(400, 'VALIDATION_FAILED', 'Enter the amount');
  if (!money && !input.lines.length) throw new AppError(400, 'VALIDATION_FAILED', 'Add at least one line');
  if (
    input.modeId &&
    !(await tx.paymentMode.count({ where: { id: input.modeId, companyId: actor.companyId } }))
  )
    throw notFound('Payment mode');
  if (input.type === 'CREDIT_NOTE' || input.type === 'DEBIT_NOTE') {
    const against = input.againstId
      ? await tx.bill.findFirst({ where: { id: input.againstId, companyId: actor.companyId } })
      : null;
    if (!against || against.partyId !== input.partyId || !['INVOICE', 'PURCHASE_BILL'].includes(against.type))
      throw new AppError(400, 'VALIDATION_FAILED', 'Choose the bill this note is for');
    if (against.status === 'DRAFT' || against.status === 'CANCELLED')
      throw new AppError(409, 'CONFLICT', 'A note can only be raised on an issued bill');
    if (input.type === 'CREDIT_NOTE' && totals.total > Number(against.total - against.credited))
      throw new AppError(400, 'VALIDATION_FAILED', 'A credit note cannot be for more than the bill');
  }
  const id = createId();
  const draft = await tx.bill.create({
    data: {
      id,
      companyId: actor.companyId,
      branchId,
      entityId: seller.head.entityId,
      type: input.type,
      number: `DRAFT-${id}`,
      currency: seller.head.currency,
      ...stored(input, totals),
      sourceType: opts.source?.type ?? null,
      sourceId: opts.source?.id ?? null,
      createdById: actor.userId,
    },
  });
  await writeAudit(
    tx,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      action: 'bill.drafted',
      entityType: 'bill',
      entityId: id,
      after: { type: input.type, total: totals.total },
    },
  );
  return money || opts.issue ? issueIn(tx, actor, draft, opts) : draft;
}

/** Change a draft. An issued paper is never edited — it is corrected by a credit or debit note. */
export async function updateDraft(db: Db, actor: Actor, id: string, input: BillInput) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id, companyId: actor.companyId } });
    if (!bill) throw notFound('Bill');
    if (bill.status !== 'DRAFT')
      throw new AppError(409, 'CONFLICT', 'An issued bill cannot be changed. Raise a credit or debit note.');
    if (!rolesOf(actor, bill).length) throw new AppError(403, 'FORBIDDEN', "You can't change this draft");
    if (input.type !== bill.type)
      throw new AppError(400, 'VALIDATION_FAILED', "A draft's kind cannot change");
    const { totals } = await workOutBill(tx, actor.companyId, input, bill.branchId);
    return tx.bill.update({ where: { id }, data: stored(input, totals) });
  });
}

export async function issueBill(db: Db, actor: Actor, id: string) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id, companyId: actor.companyId } });
    if (!bill) throw notFound('Bill');
    return issueIn(tx, actor, bill, {});
  });
}

/**
 * Take the next `count` numbers of a paper's series at a branch without making the papers yet: a device that
 * bills while the server can't be reached uses them later (phase 15), so numbers never clash.
 */
export async function reserveNumbers(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  type: BillType,
  date: string,
  count: number,
) {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const fy = financialYear(new Date(`${date}T12:00:00Z`), company.timezone, company.fyStartMonth ?? 4).short;
  const head = await letterheadOf(tx, companyId, branchId);
  const series = seriesOf('entity', head, `bill:${type}`, BILL_PREFIX[type], fy);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1)
    out.push(series.number(await nextCounter(tx, companyId, series.counterKey, fy)));
  return out;
}

async function issueIn(tx: Tx, actor: Actor, bill: Bill, opts: Options) {
  const money = MONEY_BILLS.includes(bill.type as BillType);
  const ctx = { due: Number(bill.total), total: Number(bill.total), money };
  const to = transition(billMachine, {
    from: bill.status as 'DRAFT',
    action: 'issue',
    roles: opts.system ? ['system'] : rolesOf(actor, bill),
    ctx,
  }).to;
  const company = await tx.company.findUniqueOrThrow({
    where: { id: bill.companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  const fy = financialYear(
    new Date(`${bill.date}T12:00:00Z`),
    company.timezone,
    company.fyStartMonth ?? 4,
  ).short;
  let number = opts.number;
  if (!number) {
    // One series per legal entity and kind of paper (a GSTIN's own invoice numbers); the company's own otherwise.
    const head = await letterheadOf(tx, bill.companyId, bill.branchId);
    const series = seriesOf('entity', head, `bill:${bill.type}`, BILL_PREFIX[bill.type as BillType], fy);
    number = series.number(await nextCounter(tx, bill.companyId, series.counterKey, fy));
  }
  const issued = await tx.bill.update({
    where: { id: bill.id },
    data: { status: to, number, fy, issuedAt: new Date() },
  });
  const mode = bill.modeId
    ? await tx.paymentMode.findFirst({ where: { id: bill.modeId }, select: { kind: true } })
    : null;
  const lines = voucherFor({
    type: bill.type as BillType,
    partyId: bill.partyId,
    taxable: Number(bill.taxable),
    taxes: bill.taxes as never,
    charges: bill.charges as never,
    roundOff: bill.roundOff,
    total: Number(bill.total),
    mode: mode?.kind.toLowerCase() ?? null,
  });
  if (lines.length)
    await tx.voucher.create({
      data: {
        companyId: bill.companyId,
        entityId: bill.entityId,
        billId: bill.id,
        date: bill.date,
        narration: `${issued.number}`,
        lines: lines as unknown as Prisma.InputJsonValue,
      },
    });
  // What the paper does to others: a credit note lowers its bill; money is set against what is owed.
  if (bill.type === 'CREDIT_NOTE' && bill.againstId) {
    const against = await tx.bill.findUniqueOrThrow({ where: { id: bill.againstId } });
    const credited = against.credited + bill.total;
    // The credit first clears what was still owed; anything beyond that was already paid (a refund is owed).
    const open = { ...against, credited };
    await tx.bill.update({
      where: { id: against.id },
      data: {
        credited,
        status: transition(billMachine, {
          from: against.status as 'ISSUED',
          action: 'credit',
          roles: ['system'],
          ctx: { due: Math.max(0, dueOf(open)), total: Number(against.total - credited), money: false },
        }).to,
      },
    });
  }
  if (bill.type === 'RECEIPT' || bill.type === 'VENDOR_PAYMENT') await allocate(tx, issued, opts.allocate);
  await writeAudit(
    tx,
    { companyId: bill.companyId, actorId: actor.userId },
    {
      action: 'bill.issued',
      entityType: 'bill',
      entityId: bill.id,
      after: { number, total: Number(bill.total) },
    },
  );
  await emitEvent(
    tx,
    { companyId: bill.companyId, actorId: actor.userId },
    {
      name: 'bill.issued',
      entityType: 'bill',
      entityId: bill.id,
      payload: {
        type: bill.type,
        number,
        partyId: bill.partyId,
        total: Number(bill.total),
        branchId: bill.branchId,
      },
    },
  );
  return tx.bill.findUniqueOrThrow({ where: { id: bill.id } });
}

/** Set a receipt against invoices (or a payment against purchase bills): the ones named, else the oldest first. */
async function allocate(tx: Tx, money: Bill, named?: { billId: string; amount: number }[]) {
  const owedTypes = money.type === 'RECEIPT' ? ['INVOICE', 'DEBIT_NOTE'] : ['PURCHASE_BILL'];
  const open = await tx.bill.findMany({
    where: {
      companyId: money.companyId,
      partyId: money.partyId,
      type: { in: owedTypes },
      status: { in: ['ISSUED', 'PART_PAID'] },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  let left = Number(money.total);
  const plan: { bill: Bill; amount: number }[] = [];
  if (named?.length) {
    for (const n of named) {
      const bill = open.find((b) => b.id === n.billId);
      if (!bill) throw new AppError(400, 'VALIDATION_FAILED', 'That bill is not waiting for money');
      if (n.amount > dueOf(bill) || n.amount > left)
        throw new AppError(400, 'VALIDATION_FAILED', 'That is more than is owed on the bill');
      plan.push({ bill, amount: n.amount });
      left -= n.amount;
    }
  } else {
    for (const bill of open) {
      if (left <= 0) break;
      const amount = Math.min(left, dueOf(bill));
      if (amount > 0) plan.push({ bill, amount });
      left -= amount;
    }
  }
  for (const { bill, amount } of plan) await settle(tx, bill, money.id, amount);
  await tx.bill.update({ where: { id: money.id }, data: { settled: BigInt(Number(money.total) - left) } });
}

/** One amount set against one paper (negative takes it back): the paper's `settled` and status follow. */
async function settle(tx: Tx, bill: Bill, paymentId: string, amount: number) {
  const settled = bill.settled + BigInt(amount);
  const to = transition(billMachine, {
    from: bill.status as 'ISSUED',
    action: 'settle',
    roles: ['system'],
    ctx: { due: dueOf({ ...bill, settled }), total: Number(bill.total - bill.credited), money: false },
  }).to;
  await tx.bill.update({ where: { id: bill.id }, data: { settled, status: to } });
  if (amount > 0)
    await tx.billAllocation.create({
      data: { companyId: bill.companyId, billId: bill.id, paymentId, amount: BigInt(amount) },
    });
}

/** A receipt or payment entered by mistake: voided with a reason; what it had settled is owed again. */
export async function voidBill(db: Db, actor: Actor, id: string, reason: string) {
  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({ where: { id, companyId: actor.companyId } });
    if (!bill) throw notFound('Bill');
    const money = MONEY_BILLS.includes(bill.type as BillType);
    const to = transition(billMachine, {
      from: bill.status as 'ISSUED',
      action: bill.status === 'DRAFT' ? 'discard' : 'void',
      roles: rolesOf(actor, bill),
      ctx: { due: 0, total: Number(bill.total), money },
    }).to;
    for (const a of await tx.billAllocation.findMany({ where: { paymentId: id } })) {
      const owed = await tx.bill.findUniqueOrThrow({ where: { id: a.billId } });
      await settle(tx, owed, id, -Number(a.amount));
    }
    await tx.billAllocation.deleteMany({ where: { paymentId: id } });
    // The books are never rubbed out: the voucher is turned round by a second one.
    const voucher = await tx.voucher.findFirst({ where: { billId: id, reversal: false } });
    if (voucher)
      await tx.voucher.create({
        data: {
          companyId: bill.companyId,
          entityId: bill.entityId,
          billId: id,
          date: voucher.date,
          narration: `${bill.number} voided: ${reason}`,
          reversal: true,
          lines: (voucher.lines as { head: string; partyId?: string; debit: number; credit: number }[]).map(
            (l) => ({ ...l, debit: l.credit, credit: l.debit }),
          ) as unknown as Prisma.InputJsonValue,
        },
      });
    await writeAudit(
      tx,
      { companyId: bill.companyId, actorId: actor.userId },
      {
        action: 'bill.voided',
        entityType: 'bill',
        entityId: id,
        before: { status: bill.status },
        after: { reason },
      },
    );
    return tx.bill.update({ where: { id }, data: { status: to, settled: 0n, note: reason } });
  });
}
