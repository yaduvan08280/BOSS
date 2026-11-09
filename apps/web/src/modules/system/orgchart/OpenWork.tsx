import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';

type Kind = 'task' | 'checklist' | 'fms' | 'ticket';
type OpenWorkData = {
  counts: Record<Kind, number>;
  total: number;
  late: number;
  items: { kind: Kind; id: string; title: string; due: string; late: boolean; link: string }[];
};

/** Org chart → person: what they still have to do, late work first, each item opening where it lives. */
export function OpenWork({ personId }: { personId: string }) {
  const { t } = useTranslation();
  const tz = useMe().data?.company.timezone;
  const q = useQuery({
    queryKey: ['org', 'open-work', personId],
    queryFn: () => api<OpenWorkData>(`/api/work/people/${personId}/open`),
  });
  const kinds = (['task', 'checklist', 'fms', 'ticket'] as const).filter((k) => q.data?.counts[k]);

  return (
    <div className="rounded-card border bg-muted/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardList className="size-4" /> {t('org.chart.openWork')}
        {q.data && q.data.late > 0 && (
          <StatusChip tone="bad" className="ml-auto">
            {t('org.chart.work.late', { count: q.data.late })}
          </StatusChip>
        )}
      </div>
      {q.isPending ? (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> {t('common.loading')}
        </p>
      ) : q.isError ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('org.chart.work.failed')}</p>
      ) : !q.data.total ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('org.chart.work.none')}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            {kinds.map((k) => t(`org.chart.work.${k}`, { count: q.data.counts[k] })).join(' · ')}
          </p>
          <ul className="mt-3 space-y-1.5">
            {q.data.items.map((i, n) => (
              <li key={`${i.kind}-${i.id}-${n}`}>
                <Link
                  to={i.link}
                  className="block rounded-control border bg-card px-3 py-2 text-sm hover:bg-muted"
                >
                  <span className="line-clamp-1 font-medium">{i.title}</span>
                  <span
                    className={cn(
                      'text-xs',
                      i.late ? 'font-medium text-status-bad-fg' : 'text-muted-foreground',
                    )}
                  >
                    {t(`org.chart.work.kind.${i.kind}`)} · {formatDateTime(i.due, tz)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {q.data.total > q.data.items.length && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('org.chart.work.more', { count: q.data.total - q.data.items.length })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
