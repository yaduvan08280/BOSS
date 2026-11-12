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

/**
 * Money in any currency (phase 12, stage C): an amount is always whole minor units (paise, fils, cents) plus a
 * currency code. Rupees keep the Indian way — ₹, lakh and crore grouping; every other currency is written the
 * way its own users expect, with its code or symbol and grouping in thousands.
 */
const MINOR_DIGITS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};
/** How many minor units make one unit of a currency: 100 for most, 1000 for dinars, 1 for yen. */
export const minorUnits = (currency: string): number => 10 ** (MINOR_DIGITS[currency] ?? 2);

export function formatMoney(value: Paise, currency = 'INR', opts: InrOptions = {}): string {
  if (currency === 'INR') return formatINR(value, opts);
  const digits = MINOR_DIGITS[currency] ?? 2;
  const minor = toPaise(value);
  const abs = minor < 0n ? -minor : minor;
  const unit = BigInt(10 ** digits);
  const whole = abs / unit;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac =
    digits && opts.decimals !== false && !opts.compact
      ? `.${(abs % unit).toString().padStart(digits, '0')}`
      : '';
  return `${minor < 0n ? '-' : ''}${currency} ${grouped}${frac}`;
}

/**
 * An amount in another currency, in rupees, by the month's rate (₹ for one unit of the currency). Paise in,
 * paise out, rounded to the nearest paisa. INR passes through.
 */
export function toInrPaise(minor: number, currency: string, ratePerUnit: number): number {
  if (currency === 'INR') return Math.round(minor);
  return Math.round((minor / minorUnits(currency)) * ratePerUnit * 100);
}
