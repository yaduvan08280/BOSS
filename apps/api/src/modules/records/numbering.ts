import type { Tx } from '@mono/db';
import { financialYear } from '@mono/shared';

/** The financial year a new record is numbered in (company time zone; FY April–March unless set otherwise). */
export async function fyNow(tx: Tx, companyId: string, at = new Date()): Promise<string> {
  const company = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { timezone: true, fyStartMonth: true },
  });
  return financialYear(at, company.timezone, company.fyStartMonth ?? 4).short;
}

/**
 * Take the next `n` numbers of a type's series for a financial year, atomically (the `Counter` row is locked by
 * the upsert). A number is never handed out twice: a deleted record's number stays used (decision 54).
 * Returns the first number taken.
 */
export async function takeNumbers(tx: Tx, companyId: string, typeId: string, fy: string, n = 1) {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (company_id, key, fy, value) VALUES (${companyId}, ${`rt:${typeId}`}, ${fy}, ${n})
    ON CONFLICT (company_id, key, fy) DO UPDATE SET value = counters.value + ${n}
    RETURNING value`;
  const last = rows[0]?.value;
  if (last === undefined) throw new Error('Counter update returned nothing');
  return Number(last) - n + 1;
}

/** SV/26-27/0001 */
export const recordCode = (prefix: string, fy: string, number: number) =>
  `${prefix}/${fy}/${String(number).padStart(4, '0')}`;
