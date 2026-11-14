import { HandCoins } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { money, useOwed } from './api';

const BUCKETS = ['0_30', '31_60', '61_90', '90_plus'] as const;

/** Who owes us, and whom we owe: by party, oldest first, with ageing. */
export function OwedPage() {
  const { t } = useTranslation();
  const [side, setSide] = useState<'receivable' | 'payable'>('receivable');
  const q = useOwed(side);
  const rows = q.data?.rows ?? [];
  // Amounts in different currencies are never added: the tiles show the first currency in the list.
  const currency = rows[0]?.currency ?? 'INR';
  const same = rows.filter((r) => r.currency === currency);
  const sum = (f: (r: (typeof rows)[number]) => number) => same.reduce((n, r) => n + f(r), 0);
  return (
    <div>
      <PageHeader title={t('money.owed.title')} subtitle={t('money.owed.subtitle')} />
      <div role="tablist" className="mb-4 inline-flex rounded-control bg-muted p-1">
        {(['receivable', 'payable'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            onClick={() => setSide(s)}
            className={cn(
              'h-9 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium',
              side === s ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t(`money.owed.${s}`)}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={t('money.owed.emptyTitle')}
          body={t(`money.owed.empty.${side}`)}
        />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label={t('money.owed.total')}
              value={money(
                sum((r) => r.due),
                currency,
              )}
              hero
            />
            <KpiTile
              label={t('money.owed.overdue')}
              value={money(
                sum((r) => r.overdue),
                currency,
              )}
            />
            {BUCKETS.map((b) => (
              <KpiTile
                key={b}
                label={t(`money.owed.b.${b}`)}
                value={money(
                  sum((r) => r.ageing[b]),
                  currency,
                )}
              />
            ))}
          </div>
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={`${r.party.id}${r.currency}`}>
                <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">{r.party.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[r.party.code, r.party.mobile, t('money.owed.papers', { count: r.bills })]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('money.owed.dueSince', { date: formatLocalDate(r.oldestDueOn) })}
                      {r.promisedOn
                        ? ` · ${t('money.owed.promised', { date: formatLocalDate(r.promisedOn) })}`
                        : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular font-semibold">{money(r.due, r.currency)}</div>
                    {r.overdue > 0 && (
                      <div className="tabular text-xs text-status-bad-fg">
                        {t('money.owed.overdueAmount', { amount: money(r.overdue, r.currency) })}
                      </div>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
