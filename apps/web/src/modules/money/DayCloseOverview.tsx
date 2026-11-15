import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DayHeading, type Span } from '@/components/date-range';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { api } from '@/lib/api';
import { daysOf } from '@/lib/days';
import { money } from './api';

export type Sheet = {
  closed: boolean;
  modes: {
    modeId: string;
    name: string;
    kind: string;
    expected: number;
    counted: number | null;
    difference: number | null;
  }[];
};

/**
 * Several days and / or several branches at a glance: for each day, each branch's money expected, counted and
 * the difference, and whether the day is closed. Read-only — a day is closed on its own branch and date.
 */
export function DayCloseOverview({
  branches,
  span,
  today,
  onOpen,
}: {
  branches: { id: string; name: string }[];
  span: Span;
  today: string;
  onOpen: (branchId: string, day: string) => void;
}) {
  const { t } = useTranslation();
  // Newest first, and never more than 90 requests however wide the span.
  const days = daysOf(span, Math.max(1, Math.floor(90 / Math.max(1, branches.length)))).reverse();
  const cells = days.flatMap((day) => branches.map((b) => ({ day, b })));
  const results = useQueries({
    queries: cells.map(({ day, b }) => ({
      queryKey: ['money', 'day-close', b.id, day],
      queryFn: () => api<Sheet>(`/api/money/day-close?branchId=${b.id}&date=${day}`),
    })),
  });
  const failed = results.find((r) => r.isError);
  if (failed)
    return <ErrorState onRetry={() => results.forEach((r) => void r.refetch())} error={failed.error} />;
  if (results.some((r) => r.isPending)) return <PageSkeleton />;
  const sum = (s: Sheet, k: 'expected' | 'counted' | 'difference') =>
    s.modes.reduce((n, m) => n + (m[k] ?? 0), 0);
  return (
    <div className="max-w-3xl space-y-4">
      {days.map((day) => (
        <section key={day} className="space-y-2">
          <DayHeading day={day} today={today} />
          <ul className="divide-y rounded-card border bg-card">
            {cells
              .map((c, i) => ({ ...c, sheet: results[i]!.data! }))
              .filter((c) => c.day === day)
              .map(({ b, sheet }) => {
                const diff = sum(sheet, 'difference');
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(b.id, day)}
                      className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1 basis-40 font-medium">{b.name}</span>
                      <span className="tabular text-muted-foreground">
                        {t('money.close.expected', { amount: money(sum(sheet, 'expected')) })}
                      </span>
                      {sheet.closed && diff !== 0 && (
                        <span className="tabular font-medium text-status-bad-fg">
                          {t(diff < 0 ? 'money.close.short' : 'money.close.over', {
                            amount: money(Math.abs(diff)),
                          })}
                        </span>
                      )}
                      <StatusChip tone={sheet.closed ? 'ok' : sum(sheet, 'expected') ? 'warn' : 'neutral'}>
                        {t(sheet.closed ? 'moneyClose.closed' : 'moneyClose.open')}
                      </StatusChip>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
