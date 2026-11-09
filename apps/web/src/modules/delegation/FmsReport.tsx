import { ChevronLeft, ChevronRight, Download, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { addDays, localDate, zonedToUtc, type FmsWeekRow } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFmsReport } from './api';
import { download } from './csv';

const COLS = ['due', 'done', 'onTime', 'late', 'open', 'onTimePct'] as const;
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);

/**
 * Delegation sheet → FMS report: this week's process steps per person and per flow.
 * Steps are graded once — in the week they are done, or in the week they fall due while still open.
 */
export function FmsReport({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const [offset, setOffset] = useState(0);
  // Keyed on the local date, not the clock, so the query key stays the same between renders.
  const at = zonedToUtc(addDays(localDate(new Date(), tz), offset * 7), 12 * 60, tz).toISOString();
  const q = useFmsReport(at);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const { week, total, rows, flows } = q.data;
  const head = (c: string) => t(`task.fmsRep.col.${c}`);
  const exportCsv = () =>
    download(`fms-report-${week.start}.csv`, [
      ['Person', ...COLS.map((c) => t(`task.fmsRep.col.${c}`, { lng: 'en' }))],
      ...rows.map((r) => [r.name, ...COLS.map((c) => r[c] ?? '')]),
      [],
      ['Flow', ...COLS.map((c) => t(`task.fmsRep.col.${c}`, { lng: 'en' }))],
      ...flows.map((f) => [f.name, ...COLS.map((c) => f[c] ?? '')]),
    ]);

  return (
    <div className="space-y-4">
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
        <Button size="sm" className="ml-auto" onClick={exportCsv} disabled={!rows.length}>
          <Download /> {t('task.rep.export')}
        </Button>
      </div>

      {!rows.length ? (
        <EmptyState icon={Workflow} title={t('task.fmsRep.emptyTitle')} body={t('task.fmsRep.emptyBody')} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              hero
              label={head('onTimePct')}
              value={pct(total.onTimePct)}
              note={t('task.fmsRep.graded', { n: total.onTime + total.late })}
            />
            <KpiTile label={head('due')} value={total.due} note={t('task.fmsRep.dueNote')} />
            <KpiTile
              label={head('late')}
              value={total.late}
              tone={total.late ? 'bad' : undefined}
              note={t('task.fmsRep.lateNote')}
            />
            <KpiTile label={head('open')} value={total.open} note={t('task.fmsRep.openNote')} />
          </div>
          <Table
            title={t('task.fmsRep.byPerson')}
            first={t('task.rep.col.person')}
            rows={rows.map((r) => ({ key: r.personId, name: r.name, row: r }))}
          />
          <Table
            title={t('task.fmsRep.byFlow')}
            first={t('task.fmsRep.flow')}
            rows={flows.map((f) => ({
              key: f.flowId,
              name: f.name,
              row: f,
              to: `/fms/live?flow=${f.flowId}&tab=${f.late ? 'late' : 'running'}`,
            }))}
          />
          <p className="text-xs text-muted-foreground">{t('task.fmsRep.legend')}</p>
        </>
      )}
    </div>
  );
}

function Table({
  title,
  first,
  rows,
}: {
  title: string;
  first: string;
  rows: { key: string; name: string; row: FmsWeekRow; to?: string }[];
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">{first}</th>
              {COLS.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
                  {t(`task.fmsRep.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ key, name, row, to }) => (
              <tr key={key}>
                <td className="px-3 py-2 font-medium">
                  {to ? (
                    <Link to={to} className="underline-offset-2 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </td>
                <td className="tabular px-3 py-2 text-right">{row.due}</td>
                <td className="tabular px-3 py-2 text-right">{row.done}</td>
                <td className="tabular px-3 py-2 text-right">{row.onTime}</td>
                <td
                  className={cn(
                    'tabular px-3 py-2 text-right',
                    row.late > 0 && 'font-semibold text-status-bad-fg',
                  )}
                >
                  {row.late}
                </td>
                <td className="tabular px-3 py-2 text-right">{row.open}</td>
                <td className="tabular px-3 py-2 text-right font-semibold">{pct(row.onTimePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
