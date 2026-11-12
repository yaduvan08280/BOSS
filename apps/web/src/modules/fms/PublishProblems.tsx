import { useTranslation } from 'react-i18next';
import type { FlowDefinition, FlowIssue } from '@mono/shared';
import { Dialog } from '@/components/ui/dialog';
import { FormulaIssueText } from './formula/IssueText';

/** What stops a flow from being published; a click jumps to the step. */
export function PublishProblems({
  problems,
  def,
  onPick,
}: {
  problems: FlowIssue[];
  def: FlowDefinition;
  onPick: (stepKey: string | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onPick(undefined)}
      title={t('fms.b.fixFirst', { count: problems.length })}
      description={t('fms.b.fixFirstHint')}
    >
      <ul className="space-y-1.5 text-sm">
        {problems.map((p, i) => (
          <li key={i}>
            <button
              className="w-full rounded-control border p-2.5 text-left hover:border-primary"
              onClick={() => onPick(p.stepKey)}
            >
              <span className="font-semibold">
                {p.stepKey
                  ? (def.steps.find((s) => s.key === p.stepKey)?.name ?? p.stepKey)
                  : t('fms.b.wholeFlow')}
              </span>
              {' — '}
              {p.code === 'formula' ? <FormulaIssueText issue={p} def={def} /> : t(`fms.issue.${p.code}`)}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
