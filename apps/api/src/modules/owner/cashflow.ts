import type { Db } from '@mono/db';
import { addDays } from '@mono/shared';
import type { Actor } from '../work/actor';
import { needOwner, num, spanOf } from './core';

type Day = {
  day: string;
  in: number;
  out: number;
  net: number;
  running: number;
  notes: { kind: string; text: string; amount: number }[];
};

/**
 * The cash-flow calendar for the next 60 days: what customers owe (by the promised day, else the due day),
 * what is owed to vendors, the month's salaries on the last day of each month, and licence renewals as
 * reminders. "Running" is the change in cash from today — the days it dips lowest are the ones to plan for.
 * Overdue amounts are shown on today.
 */
export async function cashFlow(db: Db, actor: Actor, days = 60) {
  needOwner(actor);
  const companyId = actor.companyId;
  const s = await spanOf(db, companyId);
  const today = s.today;
  const last = addDays(today, days - 1);
  const [bills, people, renewals] = await Promise.all([
    db.bill.findMany({
      where: {
        companyId,
        status: { in: ['ISSUED', 'PART_PAID'] },
        type: { in: ['INVOICE', 'DEBIT_NOTE', 'PURCHASE_BILL'] },
      },
      select: {
        type: true,
        number: true,
        total: true,
        settled: true,
        credited: true,
        dueOn: true,
        promisedOn: true,
        date: true,
        partyId: true,
      },
    }),
    db.user.findMany({ where: { companyId, deletedAt: null, status: 'ACTIVE' }, select: { hr: true } }),
    db.complianceItem.findMany({
      where: { companyId, deletedAt: null, expiresOn: { gte: today, lte: last } },
      select: { name: true, expiresOn: true },
    }),
  ]);
  const parties = new Map(
    (
      await db.party.findMany({
        where: { companyId, id: { in: [...new Set(bills.map((b) => b.partyId))] } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );
  const map = new Map<string, Day>();
  const at = (day: string) =>
    map.get(day) ?? map.set(day, { day, in: 0, out: 0, net: 0, running: 0, notes: [] }).get(day)!;
  let overdueIn = 0;
  let overdueOut = 0;
  for (const b of bills) {
    const open = num(b.total) - num(b.settled) - num(b.credited);
    if (open <= 0) continue;
    const when = b.promisedOn ?? b.dueOn ?? b.date;
    const receivable = b.type !== 'PURCHASE_BILL';
    if (when < today) {
      if (receivable) overdueIn += open;
      else overdueOut += open;
    }
    const day = when < today ? today : when;
    if (day > last) continue;
    const d = at(day);
    if (receivable) d.in += open;
    else d.out += open;
    d.notes.push({
      kind: receivable ? 'in' : 'out',
      text: `${parties.get(b.partyId) ?? '—'} · ${b.number}${when < today ? ' (overdue)' : ''}`,
      amount: open,
    });
  }
  // Salaries: the monthly amounts in HR details, on the last day of each month in the window.
  const payroll = people.reduce((n, p) => n + num((p.hr as { salary?: number } | null)?.salary), 0) * 100;
  if (payroll > 0)
    for (let d = today; d <= last; d = addDays(d, 1)) {
      if (addDays(d, 1).slice(8) !== '01') continue;
      const x = at(d);
      x.out += payroll;
      x.notes.push({ kind: 'salary', text: 'Salaries', amount: payroll });
    }
  for (const r of renewals) at(r.expiresOn).notes.push({ kind: 'renewal', text: r.name, amount: 0 });
  let running = 0;
  const out: Day[] = [];
  for (let d = today; d <= last; d = addDays(d, 1)) {
    const x = map.get(d);
    if (!x) continue;
    x.net = x.in - x.out;
    x.notes.sort((a, b) => b.amount - a.amount);
    out.push(x);
  }
  for (const x of out) {
    running += x.net;
    x.running = running;
  }
  const lowest = out.reduce<Day | null>((m, x) => (!m || x.running < m.running ? x : m), null);
  return {
    from: today,
    to: last,
    totals: {
      in: out.reduce((n, x) => n + x.in, 0),
      out: out.reduce((n, x) => n + x.out, 0),
      overdueIn,
      overdueOut,
    },
    lowest: lowest && lowest.running < 0 ? { day: lowest.day, running: lowest.running } : null,
    days: out,
  };
}
