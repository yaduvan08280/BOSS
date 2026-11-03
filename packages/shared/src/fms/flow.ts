import { END, type FlowDefinition, type FlowStep } from './definition';

export type FlowIssue = {
  code:
    | 'noSteps'
    | 'duplicateKey'
    | 'noDoer'
    | 'noTime'
    | 'decisionBranches'
    | 'unknownTarget'
    | 'orphan'
    | 'unknownPerson'
    | 'duplicateField'
    | 'unknownDateField'
    | 'noEnd';
  stepKey?: string;
  detail?: string;
};

/** Where a step leads: Yes/No for decisions, back for a rejected approval, else `next` or the following step. */
export function nextStepKey(
  def: FlowDefinition,
  stepKey: string,
  decision?: 'yes' | 'no' | 'approved' | 'rejected' | null,
): string {
  const i = def.steps.findIndex((s) => s.key === stepKey);
  const step = def.steps[i];
  if (!step) return END;
  if (step.type === 'DECISION') return (decision === 'no' ? step.no : step.yes) ?? END;
  if (step.type === 'APPROVAL' && decision === 'rejected')
    return step.rejectTo ?? def.steps[i - 1]?.key ?? END;
  return step.next ?? def.steps[i + 1]?.key ?? END;
}

/** Every step a step can lead to (both branches, the rejection path). */
function targets(def: FlowDefinition, s: FlowStep): string[] {
  if (s.type === 'DECISION') return [s.yes, s.no].filter((x): x is string => Boolean(x));
  const out = [nextStepKey(def, s.key)];
  if (s.type === 'APPROVAL') out.push(nextStepKey(def, s.key, 'rejected'));
  return out;
}

/**
 * Publish checks (CLAUDE.md §6.2): every step has a doer and a time; decisions have both branches;
 * every target exists; no step is unreachable; the flow can end. `people` = active user ids, when known.
 */
export function validateFlow(def: FlowDefinition, people?: Set<string>): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!def.steps.length) return [{ code: 'noSteps' }];
  const keys = new Set<string>();
  for (const s of def.steps) {
    if (keys.has(s.key)) issues.push({ code: 'duplicateKey', stepKey: s.key });
    keys.add(s.key);
  }
  const startKeys = new Set(def.startFields.map((f) => f.key));
  if (startKeys.size !== def.startFields.length) issues.push({ code: 'duplicateField' });
  const dateFields = new Set([
    ...def.startFields.filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => f.key),
    ...def.steps.flatMap((s) =>
      s.fields.filter((f) => f.type === 'date' || f.type === 'datetime').map((f) => f.key),
    ),
  ]);
  for (const s of def.steps) {
    if (s.type !== 'AUTO' && !s.doerIds.length && !s.starter) issues.push({ code: 'noDoer', stepKey: s.key });
    if (s.type !== 'AUTO' && !s.time) issues.push({ code: 'noTime', stepKey: s.key });
    if (s.type === 'DECISION' && (!s.yes || !s.no)) issues.push({ code: 'decisionBranches', stepKey: s.key });
    for (const t of targets(def, s))
      if (t !== END && !keys.has(t)) issues.push({ code: 'unknownTarget', stepKey: s.key, detail: t });
    if (people)
      for (const id of [...s.doerIds, ...s.backupIds])
        if (!people.has(id)) issues.push({ code: 'unknownPerson', stepKey: s.key, detail: id });
    if (s.time?.anchor === 'dateField' && (!s.time.field || !dateFields.has(s.time.field)))
      issues.push({ code: 'unknownDateField', stepKey: s.key, detail: s.time.field });
    if (new Set(s.fields.map((f) => f.key)).size !== s.fields.length)
      issues.push({ code: 'duplicateField', stepKey: s.key });
  }
  // Reachability from the first step, and whether any path reaches the end.
  const seen = new Set<string>();
  let endReached = false;
  const queue = [def.steps[0]!.key];
  while (queue.length) {
    const k = queue.shift()!;
    if (k === END) {
      endReached = true;
      continue;
    }
    if (seen.has(k) || !keys.has(k)) continue;
    seen.add(k);
    queue.push(
      ...targets(
        def,
        def.steps.find((s) => s.key === k)!,
      ),
    );
  }
  for (const s of def.steps) if (!seen.has(s.key)) issues.push({ code: 'orphan', stepKey: s.key });
  if (!endReached) issues.push({ code: 'noEnd' });
  return issues;
}

/** Step keys that need fixing (for the red badges). */
export const stepsToFix = (issues: FlowIssue[]) =>
  new Set(issues.map((i) => i.stepKey).filter(Boolean) as string[]);

/** "Start to end": the main path (Yes branches, approvals passing) in hours of work. */
export function mainPathHours(def: FlowDefinition, hoursPerDay: number): number {
  let total = 0;
  const seen = new Set<string>();
  let k = def.steps[0]?.key ?? END;
  while (k !== END && !seen.has(k)) {
    seen.add(k);
    const s = def.steps.find((x) => x.key === k);
    if (!s) break;
    if (s.time && s.time.anchor !== 'fixed' && s.time.anchor !== 'dateField')
      total +=
        s.time.unit === 'days'
          ? s.time.value * hoursPerDay
          : s.time.unit === 'hours'
            ? s.time.value
            : s.time.value / 60;
    k = nextStepKey(def, k, s.type === 'DECISION' ? 'yes' : 'approved');
  }
  return total;
}

/** Readiness meter (x/5): steps ready, coordinator, problem solver, a KPI card, a training video. */
export function readiness(
  def: FlowDefinition,
  meta: { coordinatorId?: string | null; solverId?: string | null; videoUrl?: string | null },
  kpiCards: number,
) {
  const issues = validateFlow(def);
  const checks = {
    steps: issues.length === 0,
    coordinator: Boolean(meta.coordinatorId),
    solver: Boolean(meta.solverId),
    kpi: kpiCards > 0,
    video: Boolean(meta.videoUrl),
  };
  return { score: Object.values(checks).filter(Boolean).length, of: 5, checks, issues };
}
