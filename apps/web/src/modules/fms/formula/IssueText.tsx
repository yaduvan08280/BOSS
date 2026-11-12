import { useTranslation } from 'react-i18next';
import { flowFormulaProblems, type FlowDefinition, type FlowIssue } from '@mono/shared';
import { problemText } from './text';

/** A broken formula among the things to fix before publishing: which field, and what is wrong, in the person's language. */
export function FormulaIssueText({ issue, def }: { issue: FlowIssue; def: FlowDefinition }) {
  const { t } = useTranslation();
  const found = flowFormulaProblems(def).find((p) => p.stepKey === issue.stepKey && p.field === issue.field);
  // The draft has changed since the server looked: show what the server said.
  if (!found) return <>{issue.detail ?? issue.field}</>;
  return <>{t('formula.issue', { field: found.label, problem: problemText(t, found.problem) })}</>;
}
