import { useQuery } from '@tanstack/react-query';
import { Loader2, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { useIsPhone } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { aiApi } from './api';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** "Ask" answer under the Home search (CLAUDE.md §13): a sentence, the rows behind it, and links to each. */
export function AskPanel({ question, tz, onClose }: { question: string; tz: string; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const q = useQuery({
    queryKey: ['ai', 'ask', question],
    queryFn: () => aiApi.ask(question),
    staleTime: 60_000,
    retry: false,
  });
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? t('fms.yes') : t('fms.no');
    if (typeof v === 'number') return v.toLocaleString('en-IN');
    if (typeof v === 'string' && ISO.test(v)) return formatDateTime(v, tz);
    return String(v);
  };
  const head = (c: string) => t(`ai.col.${c}`, { defaultValue: c.replace(/_/g, ' ') });
  const rows = q.data?.rows.slice(0, 50) ?? [];

  return (
    <section className="mt-4 rounded-card border bg-card p-4 shadow-sm" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-sm font-medium">{question}</p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={t('common.close')} onClick={onClose}>
          <X />
        </Button>
      </div>
      {q.isPending ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('ai.ask.looking')}
        </p>
      ) : q.isError ? (
        <p className="mt-3 text-sm text-status-bad-fg">
          {q.error instanceof ApiError ? q.error.message : t('ai.ask.failed')}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="whitespace-pre-wrap text-base">{q.data.answer}</p>
          {rows.length > 0 &&
            (phone ? (
              <ul className="space-y-2">
                {rows.map((r, i) => (
                  <li key={i}>
                    <button
                      disabled={!r.link}
                      onClick={() => r.link && navigate(r.link)}
                      className="w-full rounded-control border p-2.5 text-left text-sm"
                    >
                      {q.data.columns.map((c) => (
                        <div key={c} className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{head(c)}</span>
                          <span className="text-right font-medium">{show(r[c])}</span>
                        </div>
                      ))}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="overflow-x-auto rounded-control border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      {q.data.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                          {head(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => r.link && navigate(r.link)}
                        className={r.link ? 'cursor-pointer hover:bg-muted/40' : undefined}
                      >
                        {q.data.columns.map((c) => (
                          <td key={c} className="px-3 py-2 align-top">
                            {show(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          <p className="text-xs text-muted-foreground">
            {q.data.total > rows.length &&
              `${t('ai.ask.showing', { shown: rows.length, total: q.data.total })} `}
            {q.data.onlyMine && t('ai.ask.onlyMine')} {t('ai.ask.checkHint')}
          </p>
        </div>
      )}
    </section>
  );
}
