import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowStep } from '@mono/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toPayload, type Values } from './payload';

type Line = {
  text: string;
  itemId: string | null;
  code: string | null;
  name: string;
  unit: string | null;
  qty: number;
  stock: number | null;
  after: number | null;
  short: boolean;
  shortBy: number;
  from: string | null;
  to: string | null;
};
type Plan = {
  action: 'ISSUE' | 'RECEIVE' | 'TRANSFER';
  short: 'block' | 'flag' | 'note';
  lines: Line[];
  problem: string | null;
  blocked: boolean;
};

const n = (x: number | null) => (x === null ? '—' : x.toLocaleString('en-IN', { maximumFractionDigits: 3 }));

/**
 * Above "Mark done" (L15): what this step will move for the values typed so far — item, quantity, stock now and
 * after, and what is short. The server works it out with the same code that moves the stock.
 */
export function StockPreview({
  stepId,
  step,
  values,
  tz,
}: {
  stepId: string;
  step: FlowStep;
  values: Values;
  tz: string;
}) {
  const { t } = useTranslation();
  const typed = JSON.stringify(toPayload(step.fields, values, tz));
  // Ask a moment after the typing stops, not on every key.
  const [sent, setSent] = useState(typed);
  useEffect(() => {
    const id = setTimeout(() => setSent(typed), 400);
    return () => clearTimeout(id);
  }, [typed]);
  const q = useQuery({
    queryKey: ['fms', 'stock-preview', stepId, sent],
    queryFn: () =>
      api<{ stock: Plan | null }>(`/api/fms/steps/${stepId}/stock-preview`, {
        method: 'POST',
        body: { data: JSON.parse(sent) as Values },
      }),
    enabled: Boolean(step.stock),
    placeholderData: keepPreviousData,
    retry: false,
  });
  if (!step.stock) return null;
  const plan = q.data?.stock;
  return (
    <section aria-live="polite" className="space-y-2 rounded-control border bg-muted/40 p-3">
      <h3 className="text-sm font-semibold">
        {t('stockSteps.preview.title')}
        {plan && (
          <span className="ml-2 font-normal text-muted-foreground">
            {t(`stockSteps.preview.action.${plan.action}`)}
          </span>
        )}
      </h3>
      {q.isError ? (
        <p className="text-sm text-status-bad-fg">{t('stockSteps.preview.failed')}</p>
      ) : !plan ? (
        <div className="h-9 animate-pulse rounded-control bg-muted" />
      ) : !plan.lines.length ? (
        <p className="text-sm text-muted-foreground">{t('stockSteps.preview.noLines')}</p>
      ) : (
        <ul className="divide-y">
          {plan.lines.map((l, i) => (
            <li
              key={i}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{l.name}</span>
                {l.code && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{l.code}</span>}
                <span className="ml-2 tabular-nums">
                  {n(l.qty)} {l.unit}
                </span>
              </span>
              {l.itemId ? (
                <span className={cn('tabular-nums', l.short && 'font-semibold text-status-bad-fg')}>
                  {l.short ? (
                    <>
                      <TriangleAlert className="mr-1 inline size-3.5" />
                      {t('stockSteps.preview.shortBy', { n: n(l.shortBy), unit: l.unit })} ·{' '}
                      {t('stockSteps.preview.now')} {n(l.stock)}
                    </>
                  ) : (
                    <>
                      {t('stockSteps.preview.now')} {n(l.stock)}
                      <ArrowRight
                        className="mx-1 inline size-3.5"
                        aria-label={t('stockSteps.preview.after')}
                      />
                      {n(l.after)}
                    </>
                  )}
                </span>
              ) : (
                <span className="text-xs text-status-warn-fg">{t('stockSteps.preview.unknown')}</span>
              )}
              {(l.from || l.to) && (
                <span className="w-full text-xs text-muted-foreground">
                  {[
                    l.from && t('stockSteps.preview.from', { place: l.from }),
                    l.to && t('stockSteps.preview.to', { place: l.to }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {plan?.problem && (
        <p role="alert" className="text-sm text-status-bad-fg">
          {t('stockSteps.preview.needsTo')}
        </p>
      )}
      {plan?.lines.some((l) => l.short) && (
        <p
          role="alert"
          className={cn('text-sm', plan.short === 'block' ? 'text-status-bad-fg' : 'text-status-warn-fg')}
        >
          {t(
            `stockSteps.preview.${plan.short === 'block' ? 'blocked' : plan.short === 'flag' ? 'flagged' : 'noted'}`,
          )}
        </p>
      )}
    </section>
  );
}
