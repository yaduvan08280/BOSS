import { Check, LibraryBig, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { hasPermission, INDUSTRIES, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mastersApi, useLibrary, useMastersMutation } from './api';

/** Masters → Master Library (§8): ready masters by industry; pick one and it is yours, fields and all. */
export function LibraryPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useLibrary();
  const nav = useNavigate();
  const [industry, setIndustry] = useState<string>('all');
  const canEdit = hasPermission(me.user.permissions, 'core.edit');
  const use = useMastersMutation(
    (key: string) => mastersApi.useLibrary(key),
    (r) => t('masters.lib.made', { name: r.name }),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const list = q.data.filter((m) => industry === 'all' || m.industries.includes(industry as never));
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.masterLibrary')} subtitle={t('masters.lib.subtitle')} />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('masters.lib.industry')}>
        {['all', ...INDUSTRIES].map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={industry === k}
            onClick={() => setIndustry(k)}
            className={cn(
              'h-9 rounded-pill border px-3 text-sm',
              industry === k ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
            )}
          >
            {k === 'all' ? t('masters.lib.all') : t(`crm.s.bt.${k}`)}
          </button>
        ))}
      </div>
      {!list.length ? (
        <EmptyState icon={LibraryBig} title={t('common.noMatch')} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <li key={m.key} className="flex flex-col gap-2 rounded-card border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{m.name}</div>
                  <div className="text-sm text-muted-foreground">{m.description}</div>
                </div>
                {m.have && <StatusChip tone="ok">{t('masters.lib.have')}</StatusChip>}
              </div>
              <div className="flex flex-wrap gap-1">
                {m.fields.map((f) => (
                  <span key={f.key} className="rounded-pill bg-muted px-2 py-0.5 text-[11px]">
                    {f.label}
                  </span>
                ))}
              </div>
              {canEdit && !m.have && (
                <Button
                  size="sm"
                  className="mt-auto self-start"
                  disabled={use.isPending}
                  onClick={() => use.mutate(m.key, { onSuccess: (r) => nav(`/masters/${r.id}`) })}
                >
                  {use.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {t('masters.lib.use')}
                </Button>
              )}
              {m.have && (
                <span className="mt-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3" /> {t('masters.lib.inMasters')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">{t('masters.lib.tagline')}</p>
    </div>
  );
}
