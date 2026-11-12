import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ReportResult } from './api';
import { showNumber } from './format';

const cell = (v: string | number | null) => (v === null ? '—' : typeof v === 'number' ? showNumber(v) : v);

/**
 * A report's result: a table (cards on phones when it has many columns), or a chart with the numbers beside it —
 * colour is never the only way to read a value.
 */
export function ResultView({
  result,
  look,
}: {
  result: ReportResult;
  look: 'table' | 'bar' | 'line' | 'pie';
}) {
  const { t } = useTranslation();
  if (!result.rows.length && !result.totals)
    return (
      <p className="rounded-card border bg-card p-6 text-sm text-muted-foreground">{t('reports.noRows')}</p>
    );
  return (
    <div className="space-y-3">
      {result.pending.length > 0 && (
        <p
          role="status"
          className="rounded-control border border-status-warn bg-status-warn-bg p-3 text-sm text-status-warn-fg"
        >
          {t('reports.pending', { fields: result.pending.join(', ') })}
        </p>
      )}
      {look !== 'table' && result.grouped && result.rows.length > 0 && <Chart result={result} look={look} />}
      <Table result={result} />
      <p className="text-xs text-muted-foreground">{t('reports.matching', { count: result.total })}</p>
    </div>
  );
}

function Table({ result }: { result: ReportResult }) {
  const { t } = useTranslation();
  const wide = result.columns.length > 3;
  const totals = result.totals && result.grouped ? [t('reports.total'), ...result.totals] : null;
  return (
    <>
      <div className={cn('overflow-x-auto rounded-card border bg-card', wide && 'hidden md:block')}>
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              {result.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn('px-3 py-2.5 font-medium', c.kind === 'number' && 'text-right')}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {result.rows.map((r, i) => (
              <tr key={result.ids?.[i] ?? i}>
                {r.map((v, j) => (
                  <td key={j} className={cn('px-3 py-2', typeof v === 'number' && 'tabular text-right')}>
                    {cell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="border-t-2 font-semibold">
              <tr>
                {totals.map((v, j) => (
                  <td key={j} className={cn('px-3 py-2', j > 0 && 'tabular text-right')}>
                    {cell(v)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {wide && (
        <ul className="space-y-2 md:hidden">
          {result.rows.map((r, i) => (
            <li key={result.ids?.[i] ?? i} className="rounded-card border bg-card p-3 text-sm">
              <div className="font-semibold">{cell(r[0] ?? null)}</div>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                {r.slice(1).map((v, j) => (
                  <div key={j} className="contents">
                    <dt className="text-muted-foreground">{result.columns[j + 1]!.label}</dt>
                    <dd className={cn('text-right', typeof v === 'number' && 'tabular')}>{cell(v)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
          {totals && (
            <li className="rounded-card border-2 bg-card p-3 text-sm font-semibold">
              {totals.map((v, j) => (
                <div key={j} className="flex justify-between gap-3">
                  <span>{j === 0 ? cell(v) : result.columns[j]!.label}</span>
                  {j > 0 && <span className="tabular">{cell(v)}</span>}
                </div>
              ))}
            </li>
          )}
        </ul>
      )}
      {!result.grouped && result.totals && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-card border bg-card p-3 text-sm">
          {result.measures.map((m, i) => (
            <div key={i} className="flex gap-2">
              <dt className="text-muted-foreground">{m}</dt>
              <dd className="tabular font-semibold">{cell(result.totals![i] ?? null)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/** The first total of each group as a chart. Every bar, point and slice is also written out as text. */
function Chart({ result, look }: { result: ReportResult; look: 'bar' | 'line' | 'pie' }) {
  const { t } = useTranslation();
  const points = result.rows.map((r) => ({
    label: cell(r[0] ?? null),
    value: typeof r[1] === 'number' ? r[1] : 0,
  }));
  const max = Math.max(1, ...points.map((p) => p.value));
  const name = result.columns[1]?.label ?? '';
  const summary = t('reports.chartLabel', { measure: name, by: result.columns[0]?.label ?? '' });
  if (look === 'bar')
    return (
      <ul aria-label={summary} className="space-y-1.5 rounded-card border bg-card p-4">
        {points.map((p, i) => (
          <li key={i} className="grid grid-cols-[minmax(5rem,30%)_1fr_auto] items-center gap-2 text-sm">
            <span className="truncate" title={p.label}>
              {p.label}
            </span>
            <span className="h-4 rounded-sm bg-muted">
              <span
                className="block h-4 rounded-sm bg-primary"
                style={{ width: `${Math.max(1, (p.value / max) * 100)}%` }}
              />
            </span>
            <span className="tabular text-right font-medium">{showNumber(p.value)}</span>
          </li>
        ))}
      </ul>
    );
  if (look === 'line') {
    const step = points.length > 1 ? 100 / (points.length - 1) : 0;
    const xy = points.map(
      (p, i) => `${(points.length > 1 ? i * step : 50).toFixed(2)},${(56 - (p.value / max) * 50).toFixed(2)}`,
    );
    return (
      <div className="rounded-card border bg-card p-4">
        <svg
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
          className="h-44 w-full"
        >
          <polyline
            points={xy.join(' ')}
            fill="none"
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            className="stroke-primary"
          />
          {xy.map((p, i) => {
            const [x, y] = p.split(',');
            return <circle key={i} cx={x} cy={y} r={1.1} className="fill-foreground" />;
          })}
        </svg>
        <div className="mt-1 flex justify-between gap-2 text-xs text-muted-foreground">
          <span>{points[0]?.label}</span>
          <span>{points.at(-1)?.label}</span>
        </div>
      </div>
    );
  }
  // Pie: slices in steps of the theme colour; the legend carries the share of each as a number.
  const total = points.reduce((a, p) => a + p.value, 0) || 1;
  // Where each slice starts and ends, as a share of the whole (0 … 1).
  const ends = points.reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? 0) + p.value / total], []);
  const arcs = points.map((p, i) => {
    const from = i ? ends[i - 1]! : 0;
    const at = ends[i]!;
    const a0 = from * 2 * Math.PI - Math.PI / 2;
    const a1 = at * 2 * Math.PI - Math.PI / 2;
    const big = at - from > 0.5 ? 1 : 0;
    const full = at - from > 0.9999;
    const d = full
      ? 'M 50 10 A 40 40 0 1 1 49.99 10 Z'
      : `M 50 50 L ${50 + 40 * Math.cos(a0)} ${50 + 40 * Math.sin(a0)} A 40 40 0 ${big} 1 ${50 + 40 * Math.cos(a1)} ${50 + 40 * Math.sin(a1)} Z`;
    return {
      d,
      opacity: Math.max(0.2, 1 - (i % 6) * 0.15),
      share: Math.round((p.value / total) * 100),
      ...p,
    };
  });
  return (
    <div className="grid grid-cols-1 items-center gap-4 rounded-card border bg-card p-4 sm:grid-cols-[12rem_1fr]">
      <svg viewBox="0 0 100 100" role="img" aria-label={summary} className="mx-auto h-44 w-44">
        {arcs.map((a, i) => (
          <path
            key={i}
            d={a.d}
            style={{ opacity: a.opacity }}
            className="fill-primary stroke-card"
            strokeWidth={0.8}
          />
        ))}
      </svg>
      <ul className="space-y-1 text-sm">
        {arcs.map((a, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-sm bg-primary" style={{ opacity: a.opacity }} />
            <span className="min-w-0 flex-1 truncate">{a.label}</span>
            <span className="tabular font-medium">{showNumber(a.value)}</span>
            <span className="tabular w-10 text-right text-xs text-muted-foreground">{a.share}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
