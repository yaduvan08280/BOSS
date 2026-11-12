import { formatDateTime, formatLocalDate, type FlowField } from '@mono/shared';

/** A form value as people read it: DD/MM/YYYY dates, ₹ amounts, Yes/No — never raw ISO strings. */
export function showValue(
  field: FlowField | undefined,
  v: unknown,
  tz: string,
  yesNo: [string, string],
): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (Array.isArray(v)) return field?.type === 'multiselect' ? (v as string[]).join(', ') : null;
  if (typeof v === 'boolean') return v ? yesNo[0] : yesNo[1];
  if (typeof v === 'string') {
    if (field?.type === 'date' || /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatLocalDate(v);
    if (field?.type === 'datetime' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return formatDateTime(v, tz);
  }
  if (field?.type === 'amount' && typeof v === 'number') return `₹${v.toLocaleString('en-IN')}`;
  // A formula's number: Indian grouping, and as many decimals as the formula kept.
  if (field?.type === 'formula' && typeof v === 'number')
    return v.toLocaleString('en-IN', { maximumFractionDigits: 9 });
  return String(v);
}
