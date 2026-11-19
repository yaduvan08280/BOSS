import { createPrisma, type Db, type Tx } from './client';

/** Atomically take the next human number for (company, key, fy). Safe under concurrency. */
export async function nextCounter(tx: Tx, companyId: string, key: string, fy = ''): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO counters (company_id, key, fy, value) VALUES (${companyId}, ${key}, ${fy}, 1)
    ON CONFLICT (company_id, key, fy) DO UPDATE SET value = counters.value + 1
    RETURNING value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Counter update returned nothing');
  return Number(value);
}

let side: Db | undefined;

/**
 * A number taken at once, on a small pool of its own, outside whatever transaction the caller is in.
 * `nextCounter` keeps its row locked until the caller's transaction ends, so everyone else who needs the
 * same series waits for all of that transaction's work. Use this where a busy counter is shared by many
 * people at once and a missing number does no harm (a restaurant's order and kitchen-ticket numbers of the
 * day): if the caller's transaction fails afterwards the number is simply not used. Never for a paper whose
 * numbers must have no gaps (invoices, receipts) — those stay with `nextCounter`.
 */
export async function takeNumber(companyId: string, key: string, fy = ''): Promise<number> {
  side ??= createPrisma(undefined, { max: 3, name: 'mono-numbers', exitOnIdle: true });
  return nextCounter(side, companyId, key, fy);
}

/** `EMP-001`, `BOP/26-27/0004` style formatting. */
export function formatNumber(
  prefix: string,
  value: number,
  opts: { fy?: string; pad?: number; sep?: string } = {},
) {
  const pad = String(value).padStart(opts.pad ?? 3, '0');
  if (opts.fy) return `${prefix}${opts.sep ?? '/'}${opts.fy}${opts.sep ?? '/'}${pad}`;
  return `${prefix}${opts.sep ?? '-'}${pad}`;
}
