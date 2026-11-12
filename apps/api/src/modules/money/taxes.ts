import type { Db, Tx } from '@mono/db';
import { percentFor, type TaxRateRow } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError, notFound } from '../../lib/errors';
import { can, type Actor } from '../work/actor';

/**
 * Tax rates as data (phase 12M): each row is a code, a percent (or slabs by the price of one unit) and the day
 * it starts. The accountant types them; a new row from a later day changes the rate from that day on and leaves
 * every earlier paper as it was. A row can be for one legal entity or for all of them.
 */
export const taxRateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{1,20}$/, 'Short capitals, like GST5'),
  name: z.string().trim().min(1).max(60),
  percent: z.number().min(0).max(100),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date'),
  entityId: z.string().max(40).nullish(),
  slabs: z
    .array(z.object({ upTo: z.number().int().min(0).nullable(), percent: z.number().min(0).max(100) }))
    .max(10)
    .nullish(),
});

const needAdmin = (a: Actor) => {
  if (!can(a, 'money.admin')) throw new AppError(403, 'FORBIDDEN', 'Only the accounts admin types tax rates');
};

const shape = (r: {
  id: string;
  entityId: string | null;
  code: string;
  name: string;
  percent: unknown;
  from: string;
  slabs: unknown;
}) => ({
  id: r.id,
  entityId: r.entityId,
  code: r.code,
  name: r.name,
  percent: Number(r.percent),
  from: r.from,
  slabs: (r.slabs as TaxRateRow['slabs']) ?? null,
});

export async function listTaxRates(db: Db, actor: Actor) {
  const rows = await db.taxRate.findMany({
    where: { companyId: actor.companyId },
    orderBy: [{ code: 'asc' }, { from: 'desc' }],
  });
  return rows.map(shape);
}

export async function saveTaxRate(db: Db, actor: Actor, input: z.infer<typeof taxRateSchema>) {
  needAdmin(actor);
  const entityId = input.entityId ?? null;
  if (entityId && !(await db.legalEntity.count({ where: { id: entityId, companyId: actor.companyId } })))
    throw notFound('Legal entity');
  // A rate that papers already used is never rewritten: a change is a new row from a new day.
  const same = await db.taxRate.findFirst({
    where: { companyId: actor.companyId, entityId, code: input.code, from: input.from },
  });
  const data = {
    name: input.name,
    percent: input.percent,
    slabs: input.slabs?.length ? (input.slabs as object[]) : undefined,
  };
  const row = same
    ? await db.taxRate.update({ where: { id: same.id }, data })
    : await db.taxRate.create({
        data: {
          ...data,
          companyId: actor.companyId,
          entityId,
          code: input.code,
          from: input.from,
          createdById: actor.userId,
        },
      });
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    {
      action: 'tax_rate.saved',
      entityType: 'tax_rate',
      entityId: row.id,
      before: same ? shape(same) : null,
      after: shape(row),
    },
  );
  return shape(row);
}

export async function deleteTaxRate(db: Db, actor: Actor, id: string) {
  needAdmin(actor);
  const row = await db.taxRate.findFirst({ where: { id, companyId: actor.companyId } });
  if (!row) throw notFound('Tax rate');
  await db.taxRate.delete({ where: { id } });
  await writeAudit(
    db,
    { companyId: actor.companyId, actorId: actor.userId },
    { action: 'tax_rate.deleted', entityType: 'tax_rate', entityId: id, before: shape(row) },
  );
  return { ok: true };
}

/** "What percent on this day, at this unit price?" for one entity: its own rows win over the rows for everyone. */
export async function taxReader(db: Db | Tx, companyId: string, entityId: string | null, date: string) {
  const rows = await db.taxRate.findMany({
    where: { companyId, OR: [{ entityId: null }, ...(entityId ? [{ entityId }] : [])] },
  });
  const own = rows.filter((r) => r.entityId).map(shape);
  const all = rows.filter((r) => !r.entityId).map(shape);
  return (code: string | null | undefined, unitPrice: number) => {
    if (!code) return 0;
    return own.some((r) => r.code === code && r.from <= date)
      ? percentFor(own, code, date, unitPrice)
      : percentFor(all, code, date, unitPrice);
  };
}
