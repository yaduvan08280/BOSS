import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ChecklistBranchPlan, OrgPerson } from '@mono/shared';
import { PeoplePicker } from '@/components/people-picker';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { useBranches } from '@/modules/system/api';

/**
 * One template for many branches (phase 12): each branch listed gets its own runs, done by its own people at its
 * own time. Shown once the company has more than one branch.
 */
export function PerBranch({
  value,
  onChange,
  people,
  dueTime,
}: {
  value: ChecklistBranchPlan[];
  onChange: (plans: ChecklistBranchPlan[]) => void;
  people: OrgPerson[];
  /** The template's own due time: what a branch uses until it sets its own. */
  dueTime: string;
}) {
  const { t } = useTranslation();
  const branches = useBranches().data ?? [];
  if (branches.length < 2) return null;
  const set = (i: number, patch: Partial<ChecklistBranchPlan>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const free = branches.filter((b) => !value.some((p) => p.branchId === b.id));
  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">{t('chkBranch.title')}</div>
        <p className="text-xs text-muted-foreground">{t('chkBranch.hint')}</p>
      </div>
      {value.map((p, i) => (
        <div key={p.branchId} className="space-y-2 rounded-control border p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {branches.find((b) => b.id === p.branchId)?.name ?? '?'}
            </span>
            <div className="w-28">
              <TimeInput
                value={p.dueTime ?? dueTime}
                onChange={(v) => set(i, { dueTime: v === dueTime ? undefined : v })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.remove')}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
          <PeoplePicker
            ids={p.doerIds}
            people={people}
            onChange={(doerIds) => set(i, { doerIds })}
            label={t('chkBranch.doers')}
          />
        </div>
      ))}
      {free.length > 0 && (
        <div className="flex items-center gap-2">
          <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Select
            aria-label={t('chkBranch.add')}
            value=""
            onChange={(e) =>
              e.target.value && onChange([...value, { branchId: e.target.value, doerIds: [] }])
            }
          >
            <option value="">{t('chkBranch.add')}</option>
            {free.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
