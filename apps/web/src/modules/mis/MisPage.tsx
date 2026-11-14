import { useQuery } from '@tanstack/react-query';
import { ChartColumn, ChevronLeft, ChevronRight, Download, FileDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  formatLocalDate,
  localDate,
  zonedToUtc,
  type Me,
  type MisPart,
  type MisRow,
} from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { useIsPhone } from '@/components/ui/dialog';
import { useParamState } from '@/lib/work';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Row = MisRow & { name: string; department: string | null };
type Report = { week: { start: string; end: string }; rows: Row[] };
const PARTS = ['done', 'onTime', 'verifications', 'checklists', 'tickets', 'fms'] as const;
const partOf = (r: Row, k: (typeof PARTS)[number]): MisPart =>
  k === 'done' ? r.tasks.done : k === 'onTime' ? r.tasks.onTime : r[k];

function Pct({ p, strong }: { p: MisPart | number | null; strong?: boolean }) {
  const pct = typeof p === 'number' || p === null ? p : p.pct;
  if (pct === null) return <span className="text-muted-foreground">—</span>;
  const tone = pct >= 90 ? 'text-status-ok-fg' : pct >= 70 ? 'text-status-warn-fg' : 'text-status-bad-fg';
  return (
    <span
      className={cn('tabular', tone, strong && 'text-base font-semibold')}
      title={typeof p === 'object' && p ? `${p.good}/${p.total}` : undefined}
    >
      {pct}%
    </span>
  );
}

/** Weekly MIS (CLAUDE.md §5.6): per person, across modules; PDF and Excel (CSV) export. */
export function MisPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const phone = useIsPhone();
  const { params } = useParamState('tab', ['mis'] as const, 'mis');
  const [offset, setOffset] = useState(0);
  const base = params.get('at') ? new Date(params.get('at')!) : new Date();
  const at = zonedToUtc(addDays(localDate(base, tz), offset * 7), 12 * 60, tz).toISOString();
  const q = useQuery({
    queryKey: ['mis', at],
    queryFn: () => api<Report>(`/api/mis?at=${encodeURIComponent(at)}`),
  });
  const r = q.data;

  const csv = () => {
    if (!r) return;
    const head = [
      'Person',
      'Department',
      'Tasks',
      'Done %',
      'On time %',
      'Verified in time %',
      'Checklists %',
      'Tickets %',
      'FMS steps %',
      'Score',
    ];
    const rows = r.rows.map((x) => [
      x.name,
      x.department ?? '',
      x.tasks.planned,
      ...PARTS.map((k) => partOf(x, k).pct ?? ''),
      x.score ?? '',
    ]);
    const text = [head, ...rows]
      .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv' }));
    a.download = `mis-${r.week.start}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.weeklyMis')} subtitle={t('navDesc.weeklyMis')} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('task.rep.prev')}
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular text-sm font-semibold">
          {r ? `${formatLocalDate(r.week.start)} – ${formatLocalDate(r.week.end)}` : '…'}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('task.rep.next')}
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight />
        </Button>
        {offset !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            {t('task.range.week')}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={csv} disabled={!r}>
            <Download /> {t('mis.excel')}
          </Button>
          <Button size="sm" variant="primary" asChild>
            <a href={`/api/mis/pdf?at=${encodeURIComponent(at)}`}>
              <FileDown /> PDF
            </a>
          </Button>
        </div>
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError || !r ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : !r.rows.length ? (
        <EmptyState icon={ChartColumn} title={t('mis.empty')} />
      ) : phone ? (
        <ul className="space-y-2">
          {r.rows.map((x) => (
            <li key={x.personId} className="rounded-card border bg-card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{x.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {x.department ?? '—'} · {t('mis.tasksN', { count: x.tasks.planned })}
                  </div>
                </div>
                <Pct p={x.score} strong />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                {PARTS.map((k) => (
                  <div key={k}>
                    <dt className="text-muted-foreground">{t(`mis.col.${k}`)}</dt>
                    <dd>
                      <Pct p={partOf(x, k)} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">{t('mis.col.person')}</th>
                <th className="px-3 font-medium">{t('mis.col.tasks')}</th>
                {PARTS.map((k) => (
                  <th key={k} className="whitespace-nowrap px-3 font-medium">
                    {t(`mis.col.${k}`)}
                  </th>
                ))}
                <th className="px-3 font-medium">{t('mis.col.score')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.rows.map((x) => (
                <tr key={x.personId} className="hover:bg-muted/40">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-muted-foreground">{x.department ?? '—'}</div>
                  </td>
                  <td className="tabular px-3">{x.tasks.planned}</td>
                  {PARTS.map((k) => (
                    <td key={k} className="px-3">
                      <Pct p={partOf(x, k)} />
                    </td>
                  ))}
                  <td className="px-3">
                    <Pct p={x.score} strong />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('mis.legend')}</p>
    </div>
  );
}
