import { addDays, computeFormulas, formulaFields, zonedToUtc, type FlowField } from '@mono/shared';

const NUMBERS = [3, 2, 5, 10, 4, 12];
const AMOUNTS = [1200, 450, 2500, 800, 150, 99.5];
const FIRST_DAY = '2026-11-12';

/**
 * Believable values for the fields a formula can read, so the editor can show a worked example. Dates run
 * forward in the order of the fields (a check-out after its check-in).
 */
export function sampleValues(
  fields: readonly FlowField[],
  tz: string,
  text: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let n = 0;
  let a = 0;
  let d = 0;
  for (const f of fields) {
    if (f.type === 'number') out[f.key] = NUMBERS[n++ % NUMBERS.length];
    else if (f.type === 'amount') out[f.key] = AMOUNTS[a++ % AMOUNTS.length];
    else if (f.type === 'date') out[f.key] = addDays(FIRST_DAY, 2 * d++);
    else if (f.type === 'datetime')
      out[f.key] = zonedToUtc(addDays(FIRST_DAY, 2 * d++), 14 * 60, tz).toISOString();
    else if (f.type === 'yesno') out[f.key] = true;
    else if (f.type === 'dropdown') out[f.key] = f.options?.[0] ?? text;
    else if (f.type === 'text' || f.type === 'master') out[f.key] = text;
    else if (f.type === 'items')
      out[f.key] = [
        { item: 'A', qty: 2, rate: 150, amount: 300 },
        { item: 'B', qty: 1, rate: 80, amount: 80 },
      ];
  }
  return out;
}

export type WorkedExample = {
  /** The fields the formula reads, with the example value of each. */
  inputs: { field: FlowField; value: unknown }[];
  result: number | string | null;
};

/** "Qty 3 · Rate 1,200 → 3,600": the formula worked out on example values. `scope` = every field it may read. */
export function workedExample(
  field: FlowField,
  scope: readonly FlowField[],
  tz: string,
  text: string,
): WorkedExample {
  const byKey = new Map(scope.map((f) => [f.key, f]));
  const values = sampleValues([...byKey.values()], tz, text);
  const worked = computeFormulas(scope, values, { tz });
  const inputs = formulaFields(field.formula ?? '').flatMap((key) => {
    const f = byKey.get(key);
    return f ? [{ field: f, value: f.type === 'formula' ? worked[key] : values[key] }] : [];
  });
  return { inputs, result: worked[field.key] ?? null };
}
