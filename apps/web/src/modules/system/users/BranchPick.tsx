import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { Select } from '@/components/ui/form';
import { useBranches } from '../api';

/** "All branches / one branch / no branch" with how many people each has; hidden while there is no branch. */
export function BranchPick({
  value,
  onChange,
  people,
}: {
  value: string;
  onChange: (v: string) => void;
  people: OrgPerson[];
}) {
  const { t } = useTranslation();
  const branches = useBranches().data ?? [];
  if (!branches.length) return null;
  const none = people.filter((p) => !p.branchId).length;
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={t('org.place.branch')}
      className="w-auto max-w-[15rem] min-w-0 flex-1 sm:flex-none"
    >
      <option value="all">{t('org.place.allBranches')}</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} ({people.filter((p) => p.branchId === b.id).length})
        </option>
      ))}
      {none > 0 && (
        <option value="none">
          {t('org.place.noBranch')} ({none})
        </option>
      )}
    </Select>
  );
}
