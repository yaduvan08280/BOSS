import { ChartColumn, Plus, Share2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Button } from '@/modules/records/ui';
import { useReports, useReportSources } from './api';

/** Reports (plan §2.7): the ones I made and the ones shared with my role. */
export function ReportsPage() {
  const { t } = useTranslation();
  const q = useReports();
  const sources = useReportSources();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const { reports, canCreate } = q.data;
  const nameOf = (s: { kind: string; id: string }) =>
    sources.data?.find((x) => x.kind === s.kind && x.id === s.id)?.name ?? '';
  const add = canCreate && (
    <Button asChild variant="primary">
      <Link to="/reports/new">
        <Plus /> {t('reports.new')}
      </Link>
    </Button>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('reports.intro')}</p>
        {add}
      </div>
      {!reports.length ? (
        <EmptyState
          icon={ChartColumn}
          title={t('reports.none')}
          body={canCreate ? t('reports.noneBody') : t('reports.noneShared')}
          action={add || undefined}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {reports.map((r) => (
            <li key={r.id}>
              <Link to={`/reports/${r.id}`} className="block h-full rounded-card focus-visible:outline-2">
                <Card className="flex h-full flex-col gap-1 p-4 hover:bg-muted/40">
                  <div className="flex items-start gap-2">
                    <ChartColumn className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 font-semibold">{r.name}</span>
                    {r.sharedRoles.length > 0 && (
                      <Share2
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label={t('reports.shared')}
                      />
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">{nameOf(r.definition.source)}</div>
                  <div className="mt-auto pt-2 text-xs text-muted-foreground">
                    {r.mine ? t('reports.mine') : t('reports.by', { name: r.owner ?? '—' })}
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
