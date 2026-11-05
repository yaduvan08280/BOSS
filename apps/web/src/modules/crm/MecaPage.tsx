import { ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, localDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { inr, useMeca, type Grade } from './api';

const CELL: Record<Grade, string> = {
  green: 'bg-status-ok-bg text-status-ok-fg',
  yellow: 'bg-status-warn-bg text-status-warn-fg',
  red: 'bg-status-bad-bg text-status-bad-fg',
  none: 'bg-muted text-muted-foreground',
};

/** Sales CRM → MeCA / MCAP (§11.2): each sales seat's weeks — leads, conversion, average sale, calls, orders, R/Y/G. */
export function MecaPage({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(localDate(new Date(), me.company.timezone).slice(0, 7));
  const q = useMeca(month);
  const shift = (by: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const label = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.meca')} subtitle={t('navDesc.meca')} />
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.prevMonth')} onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <span className="min-w-36 text-center text-sm font-semibold">{label}</span>
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.nextMonth')} onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !q.data.rows.length ? (
        <EmptyState icon={TrendingUp} title={t('crm.m.none')} body={t('crm.m.noneBody')} />
      ) : (
        <div className="space-y-4">
          {q.data.rows.map((r) => (
            <section key={`${r.seat}${r.userId}`} className="space-y-2 rounded-card border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {r.name}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {t(`crm.seat.${r.seat}`)}
                  </span>
                </h2>
                <span className="text-sm text-muted-foreground">
                  {t('crm.m.monthTarget', { amount: inr(r.monthTarget, true) })}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 font-medium">{t('crm.m.measure')}</th>
                      {q.data.weeks.map((w) => (
                        <th key={w.week} className="px-2 py-1.5 text-center font-medium">
                          {w.week}
                          <span className="block font-normal">{formatLocalDate(w.start).slice(0, 5)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['leads', 'conversion', 'average', 'calls', 'orders'] as const).map((m) => (
                      <tr key={m} className="border-t">
                        <td className="py-1.5">{t(`crm.m.${m}`)}</td>
                        {r.weeks.map((w) => {
                          const grade: Grade = w.future
                            ? 'none'
                            : m === 'calls'
                              ? w.calls.grade
                              : m === 'orders'
                                ? w.orders.grade
                                : 'none';
                          return (
                            <td key={w.week} className="px-1 py-1">
                              <div
                                className={cn(
                                  'rounded-control px-2 py-1 text-center tabular-nums',
                                  (m === 'calls' || m === 'orders') && CELL[grade],
                                )}
                              >
                                {m === 'leads'
                                  ? w.leads
                                  : m === 'conversion'
                                    ? w.conversionPct === null
                                      ? '—'
                                      : `${w.conversionPct}%`
                                    : m === 'average'
                                      ? inr(w.averageSale, true)
                                      : m === 'calls'
                                        ? `${w.calls.done}/${w.calls.planned}`
                                        : `${inr(w.orders.value, true)} / ${inr(w.orders.target, true)}`}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {(['green', 'yellow', 'red'] as const).map((g) => (
              <span key={g} className={cn('rounded-pill px-2 py-0.5', CELL[g])}>
                {t(`crm.m.grade.${g}`)}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}
