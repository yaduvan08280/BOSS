import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatLocalDate } from '@mono/shared';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { api } from '@/lib/api';
import { rupees } from '@/modules/stock/api';
import type { ZReport } from './api';

/**
 * Every outlet's running day side by side: sales, bills, discounts, voids and whether the day is closed —
 * so the odd one out is seen without opening each outlet. A tap opens that outlet's own day.
 */
export function DayOverview({
  outlets,
  onOpen,
}: {
  outlets: { id: string; name: string }[];
  onOpen: (outletId: string) => void;
}) {
  const { t } = useTranslation();
  const results = useQueries({
    queries: outlets.map((o) => ({
      queryKey: ['pos', 'day', o.id],
      queryFn: () => api<ZReport>(`/api/pos/outlets/${o.id}/day`),
    })),
  });
  const failed = results.find((r) => r.isError);
  if (failed)
    return <ErrorState onRetry={() => results.forEach((r) => void r.refetch())} error={failed.error} />;
  if (results.some((r) => r.isPending)) return <PageSkeleton />;
  const days = results.map((r) => r.data!);
  const sum = (f: (z: ZReport) => number) => days.reduce((n, z) => n + f(z), 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          hero
          label={t('pos.day.sales')}
          value={rupees(sum((z) => z.sales))}
          note={t('pos.day.billsCovers', { bills: sum((z) => z.bills), covers: sum((z) => z.covers) })}
        />
        <KpiTile label={t('pos.day.tax')} value={rupees(sum((z) => z.tax))} />
        <KpiTile label={t('pos.day.service')} value={rupees(sum((z) => z.serviceCharge))} />
        <KpiTile
          label={t('pos.day.discounts')}
          value={rupees(sum((z) => z.discounts))}
          note={t('pos.day.voids', {
            count: sum((z) => z.voids.count),
            value: rupees(sum((z) => z.voids.value)),
          })}
        />
      </div>
      <ul className="divide-y rounded-card border bg-card">
        {outlets.map((o, i) => {
          const z = days[i]!;
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => onOpen(o.id)}
                className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 basis-44">
                  <span className="block font-medium">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatLocalDate(z.businessDay)} ·{' '}
                    {t('pos.day.billsCovers', { bills: z.bills, covers: z.covers })}
                  </span>
                </span>
                <span className="tabular font-semibold">{rupees(z.sales)}</span>
                <span className="tabular text-xs text-muted-foreground">
                  {t('pos.day.discounts')} {rupees(z.discounts)} ·{' '}
                  {t('pos.day.voids', { count: z.voids.count, value: rupees(z.voids.value) })}
                </span>
                <StatusChip tone={z.closed ? 'ok' : 'info'}>
                  {t(z.closed ? 'pos.day.isClosed' : 'pos.day.isOpen')}
                </StatusChip>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
