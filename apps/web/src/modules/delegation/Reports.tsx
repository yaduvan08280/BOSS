import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, daysInMonth, localDate, weekOf, zonedToUtc, type KpiState } from '@mono/shared';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useRyg, useScorecard } from './api';
import { download } from './csv';

const STATE: Record<KpiState, string> = {
  meets: 'bg-status-ok-bg text-status-ok-fg',
  off: 'bg-status-warn-bg text-status-warn-fg',
  missedTwice: 'bg-status-bad-bg text-status-bad-fg',
  noData: 'bg-muted text-muted-foreground',
};
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

export function Reports({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'score' | 'ryg'>('score');
  return (
    <div className="space-y-4">
      <div className="flex rounded-control bg-muted p-1 sm:w-fit">
        {(['score', 'ryg'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'h-9 flex-1 whitespace-nowrap rounded-[calc(var(--radius)*0.5)] px-4 text-sm font-medium',
              mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t(`task.rep.${m}`)}
          </button>
        ))}
      </div>
      {mode === 'score' ? <Scorecard tz={tz} /> : <Ryg tz={tz} />}
    </div>
  );
}

function Scorecard({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  // Keyed on the local date, not the clock: a key that changes every render never finishes loading.
  const at = zonedToUtc(addDays(localDate(new Date(), tz), offset * 7), 12 * 60, tz).toISOString();
  const q = useScorecard(at);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const { week, rows } = q.data;
  const exportCsv = () =>
    download(`scorecard-${week.start}.csv`, [
      [
        'Person',
        'KRA / KPI',
        'Benchmark %',
        'Last week %',
        'Planned',
        'Actual',
        'Actual %',
        'Next week target %',
      ],
      ...rows.flatMap((r) =>
        r.lines.map((l) => [
          r.name,
          t(`task.kpi.${l.kpi}`, { lng: 'en' }),
          l.benchmark,
          l.lastWeekPct ?? '',
          l.planned,
          l.actual,
          l.actualPct ?? '',
          l.nextTarget,
        ]),
      ),
    ]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" onClick={() => setOffset(offset - 1)} aria-label={t('task.rep.prev')}>
          <ChevronLeft />
        </Button>
        <span className="tabular min-w-44 text-center text-sm font-semibold">
          {week.start.split('-').reverse().join('/')} – {week.end.split('-').reverse().join('/')}
        </span>
        <Button
          size="icon-sm"
          onClick={() => setOffset(offset + 1)}
          disabled={offset >= 0}
          aria-label={t('task.rep.next')}
        >
          <ChevronRight />
        </Button>
        {offset !== 0 && (
          <Button size="sm" onClick={() => setOffset(0)}>
            {t('task.range.week')}
          </Button>
        )}
        <Button size="sm" className="ml-auto" onClick={exportCsv}>
          <Download /> {t('task.rep.export')}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['person', 'kpi', 'benchmark', 'lastWeek', 'planned', 'actual', 'actualPct', 'target'].map(
                (h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {t(`task.rep.col.${h}`)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.lines.map((l, i) => (
                <tr key={`${r.personId}${l.kpi}`} className={cn(i === 0 && 'border-t')}>
                  {i === 0 && (
                    <td rowSpan={4} className="px-3 py-2 align-top font-medium">
                      {r.name}
                    </td>
                  )}
                  <td className="px-3 py-2">{t(`task.kpi.${l.kpi}`)}</td>
                  <td className="tabular px-3 py-2">{l.benchmark}%</td>
                  <td className="tabular px-3 py-2">{pct(l.lastWeekPct)}</td>
                  <td className="tabular px-3 py-2">{l.planned}</td>
                  <td className="tabular px-3 py-2">{l.actual}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn('tabular rounded-pill px-2 py-0.5 text-xs font-semibold', STATE[l.state])}
                    >
                      {pct(l.actualPct)}
                    </span>
                  </td>
                  <td className="tabular px-3 py-2">{l.nextTarget}%</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('task.rep.noData')}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {(['meets', 'off', 'missedTwice', 'noData'] as const).map((s) => (
          <span key={s} className={cn('rounded-pill px-2.5 py-1 font-medium', STATE[s])}>
            {t(`task.rep.state.${s}`)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Ryg({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const [view, setView] = useState<'week' | 'month'>('week');
  const [part, setPart] = useState(0); // month view: 0 = whole month, 1–4 = W1–W4
  const today = localDate(new Date(), tz);
  const range = (() => {
    if (view === 'week') {
      const w = weekOf(new Date(), tz);
      return { from: w.from, to: w.to };
    }
    const first = `${today.slice(0, 8)}01`;
    const days = daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
    if (!part) return { from: zonedToUtc(first, 0, tz), to: zonedToUtc(addDays(first, days), 0, tz) };
    const start = addDays(first, (part - 1) * 7);
    const end = part === 4 ? addDays(first, days) : addDays(start, 7);
    return { from: zonedToUtc(start, 0, tz), to: zonedToUtc(end, 0, tz) };
  })();
  const q = useRyg(range.from.toISOString(), range.to.toISOString());
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const sum = (k: 'green' | 'yellow' | 'red' | 'open') => q.data.reduce((a, r) => a + r[k], 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-control bg-muted p-1">
          {(['week', 'month'] as const).map((v) => (
            <button
              key={v}
              onClick={() => (setView(v), setPart(0))}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {t(`task.rep.${v}`)}
            </button>
          ))}
        </div>
        {view === 'month' &&
          [0, 1, 2, 3, 4].map((w) => (
            <Button key={w} size="sm" variant={part === w ? 'ink' : 'secondary'} onClick={() => setPart(w)}>
              {w ? `W${w}` : t('home.all')}
            </Button>
          ))}
        <Button
          size="sm"
          className="ml-auto"
          onClick={() =>
            download('ryg.csv', [
              ['Person', 'Total', 'Green', 'Yellow', 'Red', 'Open', '% G', '% Y', '% R'],
              ...q.data.map((r) => [
                r.name,
                r.total,
                r.green,
                r.yellow,
                r.red,
                r.open,
                r.pctGreen,
                r.pctYellow,
                r.pctRed,
              ]),
            ])
          }
        >
          <Download /> {t('task.rep.download')}
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile hero label={t('task.rep.graded')} value={sum('green') + sum('yellow') + sum('red')} />
        <KpiTile label={t('task.rep.green')} value={sum('green')} />
        <KpiTile label={t('task.rep.yellow')} value={sum('yellow')} />
        <KpiTile label={t('task.rep.red')} value={sum('red')} tone="bad" />
        <KpiTile label={t('task.rep.open')} value={sum('open')} />
      </div>
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {['person', 'total', 'g', 'y', 'r', 'open', 'split'].map((h) => (
                <th key={h} className="px-3 py-2.5 font-medium">
                  {t(`task.rep.rcol.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.map((r) => (
              <tr key={r.personId}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="tabular px-3 py-2">{r.total}</td>
                <td className="tabular px-3 py-2">{r.green}</td>
                <td className="tabular px-3 py-2">{r.yellow}</td>
                <td className="tabular px-3 py-2">{r.red}</td>
                <td className="tabular px-3 py-2">{r.open}</td>
                <td className="w-64 px-3 py-2">
                  <div className="flex h-2.5 overflow-hidden rounded-pill bg-muted">
                    <span className="bg-status-ok" style={{ width: `${r.pctGreen}%` }} />
                    <span className="bg-status-warn" style={{ width: `${r.pctYellow}%` }} />
                    <span className="bg-status-bad" style={{ width: `${r.pctRed}%` }} />
                  </div>
                  <div className="tabular mt-1 text-[11px] text-muted-foreground">
                    G {r.pctGreen}% · Y {r.pctYellow}% · R {r.pctRed}%
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('task.rep.noData')}</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t('task.rep.rygLegend')}</p>
    </div>
  );
}
