import type { Db } from '@mono/db';
import { ageBucket, localDate } from '@mono/shared';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';
import { dueOf } from './bills';

/**
 * Receivables and payables (phase 12M): what every party owes us and what we owe every party, from the papers
 * themselves — today's CRM collections (decision 88) made general. A paper is due on its due date (else its own
 * date plus the party's credit days); ageing is by days past due, with "not yet due" inside 0–30.
 */
const need = (a: Actor) => {
  if (!can(a, 'money.view')) throw new AppError(403, 'FORBIDDEN', "You can't see money owed");
};
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const SIDES = { receivable: ['INVOICE', 'DEBIT_NOTE'], payable: ['PURCHASE_BILL'] } as const;
type Side = keyof typeof SIDES;
const BUCKETS = ['0_30', '31_60', '61_90', '90_plus'] as const;

export async function outstanding(db: Db, actor: Actor, side: Side) {
  need(actor);
  const company = await db.company.findUniqueOrThrow({
    where: { id: actor.companyId },
    select: { timezone: true },
  });
  const today = localDate(new Date(), company.timezone);
  const bills = await db.bill.findMany({
    where: {
      companyId: actor.companyId,
      type: { in: [...SIDES[side]] },
      status: { in: ['ISSUED', 'PART_PAID'] },
    },
    orderBy: { date: 'asc' },
  });
  const parties = new Map(
    (
      await db.party.findMany({
        where: { id: { in: [...new Set(bills.map((b) => b.partyId))] } },
        select: { id: true, name: true, code: true, mobile: true, creditDays: true },
      })
    ).map((p) => [p.id, p]),
  );
  const rows = new Map<
    string,
    {
      party: { id: string; name: string; code: string; mobile: string | null };
      currency: string;
      due: number;
      overdue: number;
      ageing: Record<(typeof BUCKETS)[number], number>;
      oldestDueOn: string;
      promisedOn: string | null;
      bills: number;
    }
  >();
  for (const b of bills) {
    const p = parties.get(b.partyId);
    if (!p) continue;
    const due = dueOf(b);
    if (due <= 0) continue;
    const dueOn = b.dueOn ?? addDays(b.date, p.creditDays);
    // One row per party and currency: amounts in different currencies are never added together.
    const key = `${p.id}|${b.currency}`;
    const row = rows.get(key) ?? {
      party: { id: p.id, name: p.name, code: p.code, mobile: p.mobile },
      currency: b.currency,
      due: 0,
      overdue: 0,
      ageing: { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 },
      oldestDueOn: dueOn,
      promisedOn: null,
      bills: 0,
    };
    row.due += due;
    row.bills++;
    if (dueOn < today) row.overdue += due;
    row.ageing[ageBucket(dueOn, today)] += due;
    if (dueOn < row.oldestDueOn) row.oldestDueOn = dueOn;
    if (b.promisedOn && (!row.promisedOn || b.promisedOn < row.promisedOn)) row.promisedOn = b.promisedOn;
    rows.set(key, row);
  }
  const list = [...rows.values()].sort((a, b) => b.overdue - a.overdue || b.due - a.due);
  const total = (k: (typeof BUCKETS)[number]) => list.reduce((n, r) => n + r.ageing[k], 0);
  return {
    side,
    today,
    rows: list,
    // Totals make sense only where everything is in one currency; the screen shows them per currency.
    totals: Object.fromEntries(BUCKETS.map((k) => [k, total(k)])),
  };
}

/** A party's statement: every issued paper in order, what it added or took off, and the running balance. */
export async function statement(
  db: Db,
  actor: Actor,
  partyId: string,
  q: { from?: string; to?: string } = {},
) {
  need(actor);
  const party = await db.party.findFirst({ where: { id: partyId, companyId: actor.companyId } });
  if (!party) throw notFound('Party');
  const bills = await db.bill.findMany({
    where: {
      companyId: actor.companyId,
      partyId,
      // Everything that was issued. An invoice cancelled by its credit note stays (both show and cancel out);
      // a voided receipt or payment does not (it was a mistake, turned round in the books).
      issuedAt: { not: null },
      NOT: { status: 'CANCELLED', type: { in: ['RECEIPT', 'ADVANCE', 'VENDOR_PAYMENT'] } },
      ...(q.to ? { date: { lte: q.to } } : {}),
    },
    orderBy: [{ date: 'asc' }, { issuedAt: 'asc' }],
  });
  // + = they owe us more (or we owe them less); − = the other way. A vendor's side is the mirror image.
  const sign: Record<string, number> = {
    INVOICE: 1,
    DEBIT_NOTE: 1,
    CREDIT_NOTE: -1,
    RECEIPT: -1,
    ADVANCE: -1,
    PURCHASE_BILL: -1,
    VENDOR_PAYMENT: 1,
    CHALLAN: 0,
  };
  let balance = 0;
  let opening = 0;
  const lines = [];
  for (const b of bills) {
    const change = sign[b.type]! * Number(b.total);
    balance += change;
    if (q.from && b.date < q.from) {
      opening = balance;
      continue;
    }
    if (!change) continue;
    lines.push({
      id: b.id,
      date: b.date,
      type: b.type,
      number: b.number,
      debit: change > 0 ? change : 0,
      credit: change < 0 ? -change : 0,
      balance,
    });
  }
  return {
    party: { id: party.id, name: party.name, code: party.code, kinds: party.kinds },
    opening,
    lines,
    closing: balance,
  };
}
