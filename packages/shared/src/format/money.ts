/** Money is stored as integer paise (BigInt) and sent over JSON as a string. */
export type Paise = bigint | number | string;

const LAKH = 100_000n * 100n; // in paise
const CRORE = 10_000_000n * 100n;

export function toPaise(value: Paise): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.round(value));
  return BigInt(value);
}

/** Rupees (may have decimals) → paise. */
export function rupeesToPaise(rupees: number | string): bigint {
  const [whole = '0', frac = ''] = String(rupees).split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  const paise = BigInt(whole.replace('-', '') || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return sign * paise;
}

/** Indian digit grouping: 1,23,45,678 */
export function groupIndian(n: bigint): string {
  const s = (n < 0n ? -n : n).toString();
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  return (n < 0n ? '-' : '') + grouped;
}

function fixed2(numerator: bigint, divisor: bigint): string {
  const neg = numerator < 0n;
  const abs = neg ? -numerator : numerator;
  const scaled = (abs * 100n + divisor / 2n) / divisor;
  const s = `${scaled / 100n}.${(scaled % 100n).toString().padStart(2, '0')}`;
  return (neg ? '-' : '') + s;
}

export type InrOptions = { compact?: boolean; decimals?: boolean };

/**
 * Format paise as Indian rupees.
 * compact: `₹1.31 Cr`, `₹45.36 L`, `₹12,500`; full: `₹1,23,456.78`.
 */
export function formatINR(value: Paise, opts: InrOptions = {}): string {
  const p = toPaise(value);
  const abs = p < 0n ? -p : p;
  const sign = p < 0n ? '-' : '';
  if (opts.compact) {
    if (abs >= CRORE) return `${sign}₹${fixed2(abs, CRORE)} Cr`;
    if (abs >= LAKH) return `${sign}₹${fixed2(abs, LAKH)} L`;
    return `${sign}₹${groupIndian((abs + 50n) / 100n)}`;
  }
  const rupees = groupIndian(abs / 100n);
  if (opts.decimals === false) return `${sign}₹${groupIndian((abs + 50n) / 100n)}`;
  return `${sign}₹${rupees}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Short words for big round amounts, e.g. `₹5 crore`, `₹45 lakh` (used next to amount inputs). */
export function inrInWords(value: Paise): string {
  const rupees = toPaise(value) / 100n;
  const trim = (s: string) => s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  if (rupees >= 10_000_000n) return `₹${trim(fixed2(rupees, 10_000_000n))} crore`;
  if (rupees >= 100_000n) return `₹${trim(fixed2(rupees, 100_000n))} lakh`;
  if (rupees >= 1_000n) return `₹${trim(fixed2(rupees, 1_000n))} thousand`;
  return `₹${rupees}`;
}
