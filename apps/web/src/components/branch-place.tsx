import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select } from '@/components/ui/form';
import { api } from '@/lib/api';

type Mine = { branches: { id: string; name: string }[]; wholeGroup: boolean };
/** `OWN` = leave it to the server (the maker's own branch); '' = every branch; anything else = that branch. */
export const OWN = '__own';

/**
 * "Which branch is this for?" on a new master row or record (phase 12). Shown only once the person has more than
 * one branch to choose from. People who see the whole group may also choose "Every branch".
 */
export function BranchPlace({
  value,
  onChange,
  withOwn,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Offer "My own branch" (records); without it the first choice is the default (master rows). */
  withOwn?: boolean;
}) {
  const { t } = useTranslation();
  const mine = useQuery({
    queryKey: ['branches', 'mine'],
    queryFn: () => api<Mine>('/api/branches/mine'),
    staleTime: 5 * 60_000,
  });
  const list = mine.data?.branches ?? [];
  const all = Boolean(mine.data?.wholeGroup);
  // Someone who can't make group-wide things starts on their first branch.
  const fallback = !withOwn && !all && value === '' && list[0] ? list[0].id : null;
  useEffect(() => {
    if (fallback) onChange(fallback);
  }, [fallback, onChange]);
  if (list.length < 2) return null;
  return (
    <Field label={t('branchPlace.label')} hint={t('branchPlace.hint')}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {withOwn && <option value={OWN}>{t('branchPlace.own')}</option>}
        {all && <option value="">{t('branchPlace.all')}</option>}
        {list.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
