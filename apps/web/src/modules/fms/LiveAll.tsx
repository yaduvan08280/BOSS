import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { api } from '@/lib/api';
import type { RecordRow } from './api';

type Live = {
  tiles: Record<'running' | 'late' | 'dueToday' | 'onHold' | 'closed', number> | null;
  records: RecordRow[];
};
const KEYS = ['running', 'late', 'dueToday', 'onHold', 'closed'] as const;

/**
 * Every live process side by side: how many records run, are late, fall due today or are on hold in each — and
 * every late record of all of them in one list, the oldest first. A tap opens the process or the record.
 */
export function LiveAll({
  flows,
  tz,
  names,
  onFlow,
  onRecord,
}: {
  flows: { id: string; code: string; name: string }[];
  tz: string;
  names: Map<string, string>;
  onFlow: (flowId: string) => void;
  onRecord: (flowId: string, recordId: string) => void;
}) {
  const { t } = useTranslation();
  const results = useQueries({
    queries: flows.map((f) => ({
      queryKey: ['fms', 'live', f.id, 'late'],
      queryFn: () => api<Live>(`/api/fms/live?tab=late&flowId=${f.id}`),
    })),
  });
  const failed = results.find((r) => r.isError);
  if (failed)
    return <ErrorState onRetry={() => results.forEach((r) => void r.refetch())} error={failed.error} />;
  if (results.some((r) => r.isPending)) return <PageSkeleton />;
  const rows = flows.map((f, i) => ({ flow: f, live: results[i]!.data! }));
  const sum = (k: (typeof KEYS)[number]) => rows.reduce((n, r) => n + (r.live.tiles?.[k] ?? 0), 0);
  const late = rows
    .flatMap((r) => r.live.records.map((rec) => ({ rec, flow: r.flow })))
    .sort((a, b) => (a.rec.steps[0]?.plannedAt ?? '').localeCompare(b.rec.steps[0]?.plannedAt ?? ''));
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {KEYS.map((k, i) => (
          <KpiTile
            key={k}
            hero={i === 0}
            label={t(`fms.live.${k}`)}
            value={sum(k)}
            tone={k === 'late' && sum(k) ? 'bad' : undefined}
          />
        ))}
      </div>
      <div className="scroll-hint @container overflow-x-auto rounded-card border">
        {/* A narrow card keeps running, late and closed; due today and on hold return with room. */}
        <table className="w-full text-sm @max-md:[&_:is(td,th):is(:nth-child(4),:nth-child(5))]:hidden @max-md:[&_:is(td,th)]:px-2">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">{t('fms.flow')}</th>
              {KEYS.map((k) => (
                <th key={k} className="px-3 py-2.5 text-right font-medium whitespace-nowrap">
                  {t(`fms.live.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(({ flow, live }) => (
              <tr key={flow.id} className="cursor-pointer hover:bg-muted/40" onClick={() => onFlow(flow.id)}>
                <td className="px-3 py-2.5">
                  <button type="button" className="text-left font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{flow.code}</span> {flow.name}
                  </button>
                </td>
                {KEYS.map((k) => (
                  <td
                    key={k}
                    className={`tabular px-3 py-2.5 text-right ${
                      k === 'late' && live.tiles?.late ? 'font-semibold text-status-bad-fg' : ''
                    }`}
                  >
                    {live.tiles?.[k] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {late.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{t('fmsAll.late', { count: late.length })}</h2>
          <ul className="divide-y rounded-card border bg-card">
            {late.map(({ rec, flow }) => {
              const s = rec.steps[0];
              return (
                <li key={rec.id}>
                  <button
                    type="button"
                    onClick={() => onRecord(flow.id, rec.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-0.5 px-4 py-2.5 text-left text-sm hover:bg-muted/40"
                  >
                    <span className="min-w-0 flex-1 basis-48">
                      <span className="block break-words font-medium">{rec.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {flow.name} · #{rec.number}
                        {s ? ` · ${s.stepName}` : ''}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s?.doerId ? (names.get(s.doerId) ?? '') : ''}
                    </span>
                    {s && (
                      <span className="tabular text-xs font-medium text-status-bad-fg">
                        {formatDateTime(s.plannedAt, tz)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
