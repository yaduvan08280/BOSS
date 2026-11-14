import { useQuery } from '@tanstack/react-query';
import { Bug, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { matchScore } from '@/lib/pick';
import { useWorkMutation } from '@/lib/work';
import { useMe } from '@/modules/auth/session';

type ErrorRow = {
  id: string;
  source: 'api' | 'worker' | 'web';
  message: string;
  stack: string | null;
  path: string | null;
  count: number;
  firstAt: string;
  lastAt: string;
  resolvedAt: string | null;
  lastUser: string | null;
};

/** System Master → Errors: what went wrong in the server, the worker or someone's browser, grouped and counted. */
export function ErrorsTab() {
  const { t } = useTranslation();
  const tz = useMe().data?.company.timezone;
  const [all, setAll] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['errors', all],
    queryFn: () => api<ErrorRow[]>(`/api/system/errors${all ? '?all=1' : ''}`),
  });
  const resolve = useWorkMutation(
    (id: string) => api(`/api/system/errors/${id}/resolve`, { method: 'POST' }),
    [['errors']],
    () => t('errors.resolved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const rows = q.data.filter(
    (r) => !search.trim() || matchScore(search, `${r.message} ${r.path ?? ''} ${r.source}`) > 0,
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm text-muted-foreground">{t('errors.subtitle')}</p>
        <Input
          aria-label={t('errors.search')}
          placeholder={t('errors.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-64"
        />
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={all} onCheckedChange={setAll} /> {t('errors.showResolved')}
        </label>
      </div>
      {!q.data.length ? (
        <EmptyState icon={Bug} title={t('errors.none')} body={t('errors.noneBody')} />
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-start gap-2">
                <StatusChip tone={r.resolvedAt ? 'neutral' : r.count >= 10 ? 'bad' : 'warn'}>
                  {t(`errors.src.${r.source}`)}
                </StatusChip>
                <div className="min-w-0 flex-1">
                  <div className="font-medium break-words">{r.message}</div>
                  <div className="text-xs text-muted-foreground">
                    {[
                      r.path,
                      t('errors.times', { count: r.count }),
                      t('errors.last', { when: formatDateTime(r.lastAt, tz) }),
                      r.lastUser,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                {r.stack && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('errors.details')}
                    aria-expanded={open === r.id}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    <ChevronDown className={open === r.id ? 'rotate-180' : ''} />
                  </Button>
                )}
                {!r.resolvedAt && (
                  <Button size="sm" variant="ghost" onClick={() => resolve.mutate(r.id)}>
                    <Check /> {t('errors.resolve')}
                  </Button>
                )}
              </div>
              {open === r.id && r.stack && (
                <pre className="max-h-64 overflow-auto rounded-control bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
                  {r.stack}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
