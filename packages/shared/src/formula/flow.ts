import type { FlowDefinition, FlowField } from '../fms/definition';
import { nextStepKey } from '../fms/flow';
import { checkFormula } from './check';
import { formulaMessage } from './message';
import type { FormulaProblem } from './types';

/** Where a step can lead: both branches of a decision, the way on, and the way back from a rejected approval. */
function leadsTo(def: FlowDefinition, stepKey: string): string[] {
  const s = def.steps.find((x) => x.key === stepKey);
  if (!s) return [];
  if (s.type === 'DECISION') return [s.yes, s.no].filter((x): x is string => Boolean(x));
  const out = [nextStepKey(def, s.key)];
  if (s.type === 'APPROVAL') out.push(nextStepKey(def, s.key, 'rejected'));
  return out;
}

/**
 * What is already on the record when a step is done: the start form, and the forms of every step that can come
 * before it (following the flow's arrows, so a branch that never leads here is left out).
 */
export function knownFieldsFor(def: FlowDefinition, stepKey: string): FlowField[] {
  const before = def.steps.filter((s) => {
    if (s.key === stepKey) return false;
    const seen = new Set<string>();
    const queue = leadsTo(def, s.key);
    while (queue.length) {
      const k = queue.pop()!;
      if (k === stepKey) return true;
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(...leadsTo(def, k));
    }
    return false;
  });
  return [...def.startFields, ...before.flatMap((s) => s.fields)];
}

export type FormulaIssue = {
  /** Missing = the start form. */
  stepKey?: string;
  field: string;
  label: string;
  problem: FormulaProblem;
};

/** The formula fields of one form that can't work. `known` = fields of other forms the formulas may read. */
export function formProblems(
  fields: readonly FlowField[],
  known: readonly FlowField[] = [],
): Omit<FormulaIssue, 'stepKey'>[] {
  // The form's own fields come last, so they win over a field of the same key elsewhere.
  const scope = [...known, ...fields];
  const out: Omit<FormulaIssue, 'stepKey'>[] = [];
  for (const f of fields) {
    if (f.type !== 'formula') continue;
    const problem = checkFormula(f.formula ?? '', scope, f.key);
    if (problem) out.push({ field: f.key, label: f.label, problem });
  }
  return out;
}

/** Every broken formula of a flow. A step's formula may read the start form and the steps before it. */
export function flowFormulaProblems(def: FlowDefinition): FormulaIssue[] {
  const out: FormulaIssue[] = formProblems(def.startFields);
  for (const s of def.steps) {
    if (!s.fields.some((f) => f.type === 'formula')) continue;
    for (const p of formProblems(s.fields, knownFieldsFor(def, s.key))) out.push({ stepKey: s.key, ...p });
  }
  return out;
}

/** The same, as publish problems (`validateFlow`): the builder refuses a flow with a broken formula. */
export function flowFormulaIssues(def: FlowDefinition) {
  return flowFormulaProblems(def).map((p) => ({
    code: 'formula' as const,
    ...(p.stepKey ? { stepKey: p.stepKey } : {}),
    field: p.field,
    detail: `${p.label}: ${formulaMessage(p.problem)}`,
  }));
}
