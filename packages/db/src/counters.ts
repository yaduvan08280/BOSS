import type { Tx } from './client';

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
