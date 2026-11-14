import { useTranslation } from 'react-i18next';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { cn } from '@/lib/utils';
import { useCashFlow, useVendors, type CashFlow, type Vendors } from './api';
import { dmy, percent, rupees } from './format';
import { DataList, Flagged, Section, type Column } from './parts';

/** How each vendor delivers, and where another vendor is cheaper for the same item. */
export function VendorsTab() {
  const { t } = useTranslation();
  const q = useVendors();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const cols: Column<Vendors['vendors'][number]>[] = [
    { key: 'vendor', label: t('owner.v.vendor'), head: true, cell: (r) => r.vendor },
    { key: 'value', label: t('owner.v.value'), num: true, cell: (r) => rupees(r.value) },
    { key: 'orders', label: t('owner.v.orders'), num: true, cell: (r) => `${r.orders} · ${r.deliveries}` },
    {
      key: 'ontime',
      label: t('owner.v.onTime'),
      num: true,
      cell: (r) => <Flagged bad={(r.onTimePct ?? 100) < 80}>{percent(r.onTimePct)}</Flagged>,
    },
    {
      key: 'rej',
      label: t('owner.v.rejected'),
      num: true,
      cell: (r) => <Flagged bad={(r.rejectedPct ?? 0) > 3}>{percent(r.rejectedPct)}</Flagged>,
    },
    {
      key: 'rate',
      label: t('owner.v.rates'),
      num: true,
      cell: (r) => (r.rateUps || r.rateDowns ? `↑${r.rateUps} ↓${r.rateDowns}` : '—'),
    },
  ];
  const cheaper: Column<Vendors['cheaper'][number]>[] = [
    { key: 'item', label: t('owner.v.item'), head: true, cell: (r) => r.item },
    { key: 'now', label: t('owner.v.paying'), cell: (r) => `${r.vendor} · ${rupees(r.rate)}/${r.unit}` },
    {
      key: 'other',
      label: t('owner.v.cheaper'),
      cell: (r) => `${r.other} · ${rupees(r.otherRate)}/${r.unit}`,
    },
    { key: 'save', label: t('owner.v.save'), num: true, cell: (r) => `${r.savePct}%` },
  ];
  return (
    <div className="space-y-6">
      <Section title={t('owner.v.title')} hint={t('owner.v.hint', { since: dmy(q.data.since) })}>
        <DataList columns={cols} rows={q.data.vendors} rowKey={(r) => r.vendor} empty={t('owner.v.none')} />
      </Section>
      <Section title={t('owner.v.cheaperTitle')} hint={t('owner.v.cheaperHint')}>
        <DataList
          columns={cheaper}
          rows={q.data.cheaper}
          rowKey={(r, i) => `${i}`}
          empty={t('owner.v.noCheaper')}
        />
      </Section>
    </div>
  );
}

/** The next 60 days of money in and out, day by day. */
export function CashFlowTab() {
  const { t } = useTranslation();
  const q = useCashFlow();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d: CashFlow = q.data;
  const max = Math.max(1, ...d.days.map((x) => Math.max(x.in, x.out)));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          hero
          label={t('owner.c.net')}
          value={rupees(d.totals.in - d.totals.out)}
          note={t('owner.c.span', { from: dmy(d.from), to: dmy(d.to) })}
        />
        <KpiTile
          label={t('owner.c.in')}
          value={rupees(d.totals.in)}
          note={d.totals.overdueIn ? t('owner.c.overdue', { amount: rupees(d.totals.overdueIn) }) : undefined}
        />
        <KpiTile
          label={t('owner.c.out')}
          value={rupees(d.totals.out)}
          note={
            d.totals.overdueOut ? t('owner.c.overdue', { amount: rupees(d.totals.overdueOut) }) : undefined
          }
        />
        <KpiTile
          label={t('owner.c.lowest')}
          tone={d.lowest ? 'bad' : undefined}
          value={d.lowest ? rupees(d.lowest.running) : '—'}
          note={d.lowest ? dmy(d.lowest.day) : t('owner.c.neverNegative')}
        />
      </div>
      <Section title={t('owner.c.title')} hint={t('owner.c.hint')}>
        {d.days.length ? (
          <ol className="divide-y rounded-card border bg-card">
            {d.days.map((x) => (
              <li
                key={x.day}
                className="grid grid-cols-[5.5rem_1fr] gap-3 px-4 py-3 text-sm sm:grid-cols-[6.5rem_1fr_9rem]"
              >
                <div>
                  <div className="tabular font-semibold">{dmy(x.day)}</div>
                  <div
                    className={cn(
                      'tabular text-xs',
                      x.running < 0 ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground',
                    )}
                  >
                    {x.running < 0 ? '▼ ' : ''}
                    {rupees(x.running)}
                  </div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex h-2 gap-1" aria-hidden>
                    <span className="rounded-pill bg-status-ok" style={{ width: `${(x.in / max) * 50}%` }} />
                    <span
                      className="rounded-pill bg-status-bad"
                      style={{ width: `${(x.out / max) * 50}%` }}
                    />
                  </div>
                  <ul className="text-xs text-muted-foreground">
                    {x.notes.slice(0, 4).map((n, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {t(`owner.c.kind.${n.kind}`)} · {n.text}
                        </span>
                        {n.amount > 0 && <span className="tabular shrink-0">{rupees(n.amount)}</span>}
                      </li>
                    ))}
                    {x.notes.length > 4 && <li>{t('owner.c.more', { count: x.notes.length - 4 })}</li>}
                  </ul>
                </div>
                <div className="tabular col-span-2 text-right text-xs sm:col-span-1 sm:text-sm">
                  <span className="text-status-ok-fg">+{rupees(x.in)}</span>{' '}
                  <span className="text-status-bad-fg">−{rupees(x.out)}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">{t('owner.c.none')}</p>
        )}
      </Section>
    </div>
  );
}
