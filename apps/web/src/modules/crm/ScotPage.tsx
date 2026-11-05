import { Repeat } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatLocalDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { Bars } from './charts';
import { inr, useProgress, useScot } from './api';
import { CustomerSheet } from './CustomerDialogs';

const FILTERS = ['all', 'overdue', 'today', 'next7', 'later', 'sleeping'] as const;

/** Sales CRM → SCOT sheet (§11.2): each regular customer's rhythm and the date to call; calls per day; the CRR gap. */
export function ScotPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useScot();
  const progress = useProgress();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [sc, setSc] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const in7 = addDays(d.today, 7);
  const rows = d.rows
    .filter((r) =>
      filter === 'overdue'
        ? r.callOn! < d.today
        : filter === 'today'
          ? r.callOn === d.today
          : filter === 'next7'
            ? r.callOn! >= d.today && r.callOn! <= in7
            : filter === 'later'
              ? r.callOn! > in7
              : filter === 'sleeping'
                ? r.sleeping
                : true,
    )
    .filter((r) => !sc || r.scId === sc)
    .filter((r) => !search.trim() || matchScore(search, [r.name, r.city, r.mobile].join(' ')) > 0)
    .sort((a, b) => a.callOn!.localeCompare(b.callOn!));
  const scs = [...new Map(d.rows.filter((r) => r.scId).map((r) => [r.scId!, r.sc ?? '?'])).entries()];
  const busiest = d.days.reduce((a, x) => (x.calls > a.calls ? x : a), d.days[0]!);
  const workDays = d.days.filter((x) => x.working);
  const avg = workDays.length
    ? Math.round((workDays.reduce((a, x) => a + x.calls, 0) / workDays.length) * 10) / 10
    : 0;
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.scot')} subtitle={t('navDesc.scot')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label={t('crm.sc.onScot')} value={d.tiles.onScot} hero />
        <KpiTile label={t('crm.sc.today')} value={d.tiles.callsToday} />
        <KpiTile
          label={t('crm.sc.overdue')}
          value={d.tiles.overdue}
          tone={d.tiles.overdue ? 'bad' : undefined}
        />
        <KpiTile label={t('crm.sc.next7')} value={d.tiles.next7} />
        <KpiTile label={t('crm.sc.expected30')} value={inr(d.tiles.expected30, true)} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader>
            <CardTitle>{t('crm.sc.perDay')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {t('crm.sc.perDayNote', { date: formatLocalDate(busiest.date), n: busiest.calls, avg })}
            </p>
          </CardHeader>
          <CardContent>
            <Bars
              label={t('crm.sc.perDay')}
              className="h-28"
              data={d.days.map((x) => ({ label: x.date, value: x.calls, muted: !x.working }))}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('crm.sc.vsCrr')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{t('crm.sc.crrTarget')}</span>
              <b className="tabular-nums">{inr(d.gap.crrTarget, true)}</b>
            </div>
            <div className="flex justify-between">
              <span>{t('crm.sc.scotExpects')}</span>
              <b className="tabular-nums">{inr(d.gap.scotExpects, true)}</b>
            </div>
            <div className="flex justify-between text-status-warn-fg">
              <span>{t('crm.sc.gap')}</span>
              <b className="tabular-nums">{inr(d.gap.gap, true)}</b>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t('crm.sc.sleepingLost')}</span>
              <span>{d.gap.sleepingLost}</span>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('crm.c.search')}
          placeholder={t('crm.c.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-64"
        />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('crm.sc.show')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-8 rounded-pill border px-3 text-sm',
                filter === f ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
              )}
            >
              {t(`crm.sc.f.${f}`)}
            </button>
          ))}
        </div>
        {scs.length > 1 && (
          <Select
            value={sc}
            onChange={(e) => setSc(e.target.value)}
            aria-label={t('crm.sc.bySc')}
            className="w-44"
          >
            <option value="">{t('crm.sc.allSc')}</option>
            {scs.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {!d.rows.length ? (
        <EmptyState icon={Repeat} title={t('crm.sc.none')} body={t('crm.sc.noneBody')} />
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {[
                  'customer',
                  'nextCall',
                  'average',
                  'every',
                  'usual',
                  'before',
                  'due',
                  'rhythm',
                  'items',
                  'sc',
                ].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">
                    {t(`crm.sc.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.customerId}
                  className="cursor-pointer border-t hover:bg-muted/40"
                  onClick={() => setOpen(r.customerId)}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground">{r.city}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="tabular-nums">{formatLocalDate(r.callOn!)}</div>
                    {r.callOn! < d.today ? (
                      <StatusChip tone="bad">{t('crm.sc.late')}</StatusChip>
                    ) : r.callOn === d.today ? (
                      <StatusChip tone="warn">{t('crm.sc.dueToday')}</StatusChip>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{inr(r.averageOrder, true)}</td>
                  <td className="px-3 py-2 tabular-nums">{t('crm.sc.days', { count: r.everyDays ?? 0 })}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {r.usualDay ? t('crm.sc.dayOfMonth', { n: r.usualDay }) : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.callBeforeDays}</td>
                  <td className="px-3 py-2 tabular-nums">{formatLocalDate(r.nextDue!)}</td>
                  <td className="px-3 py-2">
                    {r.rhythm === 'everyN'
                      ? t('crm.sc.everyN', { n: r.everyDays })
                      : t(`crm.sc.rhythm.${r.rhythm}`)}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.topItems.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-xs">{r.sc ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <CustomerSheet
          id={open}
          me={me}
          defs={progress.data?.config.tags ?? []}
          onEdit={() => setOpen(null)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
