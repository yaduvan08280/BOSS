import { useQuery } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Row = {
  branchId: string;
  name: string;
  type: string;
  people: number;
  attendance: number | null;
  checklistMissed: number | null;
  ticketHours: number | null;
  onTime: number | null;
  score: number | null;
  rank: number | null;
};
const PERIODS = ['month', 'lastMonth', 'd7', 'd30'] as const;
type Period = (typeof PERIODS)[number];

/** From (inclusive) and to (exclusive) of a period, counted on the reader's clock. */
function span(period: Period): { from: Date; to: Date } {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: day };
  if (period === 'lastMonth')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 1),
    };
  const days = period === 'd7' ? 7 : 30;
  return { from: new Date(day.getTime() - days * 86_400_000), to: day };
}

/** Good, middling or poor — said with a word-sized number and a colour, never colour alone. */
const tone = (v: number | null, good: number, ok: number, lowerIsBetter = false) => {
  if (v === null) return 'text-muted-foreground';
  const x = lowerIsBetter ? 100 - v : v;
  return x >= good ? 'text-status-ok-fg' : x >= ok ? 'text-status-warn-fg' : 'text-status-bad-fg';
};

/** Outlets side by side (phase 12): attendance, checklist misses, ticket times and on-time work, ranked. */
export function OutletsPage() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('month');
  const { from, to } = span(period);
  const q = useQuery({
    queryKey: ['outlets', period, from.toDateString()],
    queryFn: () =>
      api<{ rows: Row[] }>(`/api/branches/compare?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const cell = (label: string, value: string, className?: string) => (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('tabular text-base font-semibold', className)}>{value}</div>
    </div>
  );
  const show = (v: number | null, unit = '%') => (v === null ? '—' : `${v}${unit}`);
  return (
    <div>
      <PageHeader
        title={t('outlets.title')}
        subtitle={t('outlets.subtitle')}
        actions={
          <Select
            aria-label={t('outlets.period')}
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="w-44"
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`outlets.p.${p}`)}
              </option>
            ))}
          </Select>
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 ? (
        <EmptyState icon={Trophy} title={t('outlets.emptyTitle')} body={t('outlets.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {q.data.rows.map((r) => (
            <li key={r.branchId}>
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
                  <span
                    className={cn(
                      'tabular grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold',
                      r.rank === 1 ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground',
                    )}
                    aria-label={r.rank ? t('outlets.rankN', { n: r.rank }) : t('outlets.noRank')}
                  >
                    {r.rank ?? '—'}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`branches.type.${r.type}`)} · {t('org.peopleCount', { count: r.people })}
                    </div>
                  </div>
                </div>
                <div className="grid flex-[2] basis-72 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5">
                  {cell(t('outlets.score'), show(r.score, ''), tone(r.score, 85, 65))}
                  {cell(t('outlets.attendance'), show(r.attendance), tone(r.attendance, 90, 75))}
                  {cell(t('outlets.missed'), show(r.checklistMissed), tone(r.checklistMissed, 95, 85, true))}
                  {cell(t('outlets.onTime'), show(r.onTime), tone(r.onTime, 85, 65))}
                  {cell(t('outlets.ticketHours'), show(r.ticketHours, ' h'))}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-muted-foreground">{t('outlets.how')}</p>
    </div>
  );
}
