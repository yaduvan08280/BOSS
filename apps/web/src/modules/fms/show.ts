import { showStored, type FlowField } from '@mono/shared';

/** A form value as people read it: DD/MM/YYYY dates, ₹ amounts, Yes/No — never raw ISO strings. */
export function showValue(
  field: FlowField | undefined,
  v: unknown,
  tz: string,
  yesNo: [string, string],
): string | null {
  // A value with no field (older data) keeps its own text: only a known formula or amount is grouped.
  if (!field && typeof v === 'number') return String(v);
  return showStored(field, v, tz, yesNo);
}
