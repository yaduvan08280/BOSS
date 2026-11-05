import type { FlowField } from './definition';

export type ItemLine = { item: string; qty: number; rate: number; amount?: number };

const filled = (v: unknown) =>
  !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));

/**
 * Check and clean form values against the fields (start form, a step's form, the public form).
 * Returns cleaned values (numbers as numbers, item amounts computed) and one message per bad field.
 */
export function checkFields(
  fields: FlowField[],
  input: Record<string, unknown>,
): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = input[f.key];
    if (!filled(v)) {
      if (f.required && f.type !== 'yesno') errors[f.key] = `${f.label} is required`;
      if (f.type === 'yesno' && f.required && typeof v !== 'boolean')
        errors[f.key] = `${f.label}: choose yes or no`;
      continue;
    }
    switch (f.type) {
      case 'number':
      case 'amount': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''));
        if (!Number.isFinite(n)) errors[f.key] = `${f.label} must be a number`;
        else if (f.type === 'amount' && n < 0) errors[f.key] = `${f.label} can't be negative`;
        else values[f.key] = f.type === 'amount' ? Math.round(n * 100) / 100 : n;
        break;
      }
      case 'yesno':
        if (typeof v !== 'boolean') errors[f.key] = `${f.label}: choose yes or no`;
        else values[f.key] = v;
        break;
      case 'date':
        // A real calendar date (31/02 is not).
        if (
          typeof v !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v
        )
          errors[f.key] = `${f.label}: use a DD/MM/YYYY date`;
        else values[f.key] = v;
        break;
      case 'datetime':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v)))
          errors[f.key] = `${f.label}: pick a date and time`;
        else values[f.key] = new Date(v).toISOString();
        break;
      case 'email':
        if (typeof v !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
          errors[f.key] = `${f.label}: not an email`;
        else values[f.key] = v.trim().toLowerCase();
        break;
      case 'mobile': {
        const digits = String(v)
          .replace(/\D/g, '')
          .replace(/^91(?=\d{10}$)/, '');
        if (!/^[6-9]\d{9}$/.test(digits)) errors[f.key] = `${f.label}: a 10-digit mobile number`;
        else values[f.key] = `+91${digits}`;
        break;
      }
      case 'dropdown':
        if (typeof v !== 'string' || (f.options?.length && !f.options.includes(v)))
          errors[f.key] = `${f.label}: pick from the list`;
        else values[f.key] = v;
        break;
      case 'multiselect':
        if (
          !Array.isArray(v) ||
          v.some((x) => typeof x !== 'string' || (f.options?.length && !f.options.includes(x)))
        )
          errors[f.key] = `${f.label}: pick from the list`;
        else values[f.key] = v;
        break;
      case 'items': {
        if (!Array.isArray(v)) {
          errors[f.key] = `${f.label}: add item lines`;
          break;
        }
        const lines: ItemLine[] = [];
        for (const raw of v as Record<string, unknown>[]) {
          const item = String(raw?.item ?? '').trim();
          const qty = Number(raw?.qty);
          const rate = Number(raw?.rate ?? 0);
          if (!item && !raw?.qty) continue;
          if (!item || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) {
            errors[f.key] = `${f.label}: every line needs an item, a quantity and a rate`;
            break;
          }
          lines.push({ item, qty, rate, amount: Math.round(qty * rate * 100) / 100 });
        }
        if (!errors[f.key]) {
          if (f.required && !lines.length) errors[f.key] = `${f.label} is required`;
          else values[f.key] = lines;
        }
        break;
      }
      case 'photo':
      case 'file':
      case 'signature':
        // Attachment ids (one or several).
        if (!(typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))))
          errors[f.key] = `${f.label}: attach a file`;
        else values[f.key] = v;
        break;
      default:
        values[f.key] = typeof v === 'string' ? v.trim().slice(0, f.type === 'longtext' ? 4000 : 300) : v;
    }
  }
  return { values, errors };
}

/** The total of all item lines in a form (for documents and KPI cards). */
export function itemsTotal(values: Record<string, unknown>): number | null {
  const lines = Object.values(values).filter(Array.isArray).flat() as ItemLine[];
  const amounts = lines.map((l) => l?.amount).filter((a): a is number => typeof a === 'number');
  return amounts.length ? Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

/** A record's title: the first text-like start value, else "Order #12". */
export function recordTitle(
  fields: FlowField[],
  values: Record<string, unknown>,
  runName: string,
  n: number,
): string {
  for (const f of fields) {
    const v = values[f.key];
    if (['text', 'master', 'dropdown'].includes(f.type) && typeof v === 'string' && v.trim())
      return v.trim().slice(0, 120);
  }
  return `${runName} #${n}`;
}
