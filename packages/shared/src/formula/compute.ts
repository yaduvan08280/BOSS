import { evalFormula, type FormulaOptions } from './eval';
import { formulaFields, parseFormula } from './parse';
import type { FormulaField, FormulaNode } from './types';

/**
 * Work out every formula field of a form. `values` are the form's values plus whatever is already known on the
 * record (the start form, earlier steps). Formulas may read other formulas: they are worked out in the order
 * they depend on each other. A value sent for a formula field is never read — only what is worked out here.
 * Gives only the formulas that have a value (a broken formula, a missing input or a circle gives none).
 */
export function computeFormulas(
  fields: readonly FormulaField[],
  values: Record<string, unknown>,
  opts: Pick<FormulaOptions, 'tz'> = {},
): Record<string, number | string> {
  const formulas = new Map<string, FormulaNode | null>();
  for (const f of fields) {
    if (f.type !== 'formula') continue;
    const parsed = parseFormula(f.formula ?? '');
    formulas.set(f.key, parsed.ok ? parsed.ast : null);
  }
  const out: Record<string, number | string> = {};
  if (!formulas.size) return out;

  const work: Record<string, unknown> = {};
  if (values && typeof values === 'object')
    for (const [k, v] of Object.entries(values)) if (!formulas.has(k)) work[k] = v;

  const done = new Set<string>();
  const circle = new Set<string>();
  const path: string[] = [];
  const settle = (key: string): void => {
    if (done.has(key)) return;
    const at = path.indexOf(key);
    if (at >= 0) {
      // Formulas that read each other in a circle: none of them has a value.
      for (const k of path.slice(at)) circle.add(k);
      return;
    }
    const ast = formulas.get(key);
    path.push(key);
    if (ast) for (const dep of formulaFields(ast)) if (formulas.has(dep)) settle(dep);
    path.pop();
    done.add(key);
    if (!ast || circle.has(key)) return;
    const value = evalFormula(ast, work, { fields, ...opts });
    if (value !== null) work[key] = out[key] = value;
  };
  for (const key of formulas.keys()) settle(key);
  return out;
}
