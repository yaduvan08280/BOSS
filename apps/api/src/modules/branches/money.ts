import type { Db, Tx } from '@mono/db';
import { toInrPaise } from '@mono/shared';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * Currencies across the group (phase 12, stage C; decisions 10 and 11). Each legal entity works in its own
 * currency; group figures are shown in rupees with one rate per currency per month, typed by an accountant.
 * A month with no rate for a currency is said so — it is never guessed.
 */

/** The currency of each person, from the legal entity of their branch (INR where there is none). */
export async function currencyOfPeople(db: Db | Tx, companyId: string, userIds: string[]) {
  const people = await db.user.findMany({
    where: { companyId, id: { in: userIds } },
    select: { id: true, branch: { select: { entityId: true } } },
  });
  const entities = await db.legalEntity.findMany({
    where: { companyId },
    select: { id: true, currency: true },
  });
  const of = new Map(entities.map((e) => [e.id, e.currency]));
  return new Map(people.map((p) => [p.id, (p.branch?.entityId && of.get(p.branch.entityId)) || 'INR']));
}

/** A month's rates, and a converter that also says which currencies had none. */
export async function inrConverter(db: Db | Tx, companyId: string, month: string) {
  const rows = await db.exchangeRate.findMany({ where: { companyId, month } });
  const rate = new Map(rows.map((r) => [r.currency, Number(r.rate)]));
  const missing = new Set<string>();
  return {
    missing,
    /** Minor units of a currency → paise; 0 (and noted as missing) when the month has no rate for it. */
    toInr(minor: number, currency: string): number {
      if (currency === 'INR') return Math.round(minor);
      const r = rate.get(currency);
      if (r === undefined) {
        missing.add(currency);
        return 0;
      }
      return toInrPaise(minor, currency, r);
    },
  };
}

const needMoney = (a: Actor) => {
  if (!can(a, 'core.admin') && !can(a, 'hr.admin'))
    throw new AppError(403, 'FORBIDDEN', 'Only the accounts or HR admin types exchange rates');
};

export async function listRates(db: Db, actor: Actor, year?: string) {
  const rows = await db.exchangeRate.findMany({
    where: { companyId: actor.companyId, ...(year ? { month: { startsWith: year } } : {}) },
    orderBy: [{ month: 'desc' }, { currency: 'asc' }],
    take: 500,
  });
  return rows.map((r) => ({ currency: r.currency, month: r.month, rate: Number(r.rate) }));
}

/** One rate per currency per month: saving again replaces it; a rate of 0 removes it. */
export async function saveRate(
  db: Db,
  actor: Actor,
  input: { currency: string; month: string; rate: number },
) {
  needMoney(actor);
  if (input.currency === 'INR') throw new AppError(400, 'VALIDATION_FAILED', 'Rupees need no rate');
  const key = { companyId: actor.companyId, currency: input.currency, month: input.month };
  return db.$transaction(async (tx) => {
    const before = await tx.exchangeRate.findUnique({ where: { companyId_currency_month: key } });
    if (input.rate > 0)
      await tx.exchangeRate.upsert({
        where: { companyId_currency_month: key },
        create: { ...key, rate: input.rate, updatedById: actor.userId },
        update: { rate: input.rate, updatedById: actor.userId },
      });
    else await tx.exchangeRate.deleteMany({ where: key });
    await writeAudit(
      tx,
      { companyId: actor.companyId, actorId: actor.userId },
      {
        action: 'exchange_rate.saved',
        entityType: 'exchange_rate',
        entityId: `${input.currency}:${input.month}`,
        before: before ? { rate: Number(before.rate) } : null,
        after: { rate: input.rate },
      },
    );
    return { ok: true };
  });
}
