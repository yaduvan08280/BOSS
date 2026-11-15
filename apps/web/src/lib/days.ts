import { addDays } from '@mono/shared';

export type Span = { from: string; to: string };

/** Every day from `from` to `to` (YYYY-MM-DD), at most `cap` of them. */
export function daysOf(span: Span, cap = 62): string[] {
  const out: string[] = [];
  for (let d = span.from; d <= span.to && out.length < cap; d = addDays(d, 1)) out.push(d);
  return out;
}
