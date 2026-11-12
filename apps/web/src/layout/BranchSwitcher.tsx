import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { currentBranch, setCurrentBranch } from '@/lib/branch';
import { cn } from '@/lib/utils';

type Mine = { branches: { id: string; name: string; code: string | null }[]; wholeGroup: boolean };

/**
 * "All my branches" or one of them (phase 12). Shown only to people with more than one branch. Choosing a branch
 * narrows every list, count and report to it; nothing is ever widened.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [branch, setBranch] = useState(currentBranch);
  const mine = useQuery({
    queryKey: ['branches', 'mine'],
    queryFn: () => api<Mine>('/api/branches/mine'),
    staleTime: 5 * 60_000,
  });
  const list = mine.data?.branches ?? [];
  const choose = (id: string) => {
    setCurrentBranch(id);
    setBranch(id);
    void qc.invalidateQueries();
  };
  // A remembered branch the person no longer has (moved, branch closed): back to all of them.
  const gone = Boolean(mine.data && branch && !list.some((b) => b.id === branch));
  useEffect(() => {
    if (!gone) return;
    setCurrentBranch('');
    void qc.invalidateQueries();
  }, [gone, qc]);
  if (list.length < 2) return null;
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        aria-label={t('branches.switcher')}
        value={gone ? '' : branch}
        onChange={(e) => choose(e.target.value)}
        className="h-9 min-w-0 flex-1 text-[13px]"
      >
        <option value="">{t('branches.allMine')}</option>
        {list.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
