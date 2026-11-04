import { ArrowDown, ArrowUp, Check, Loader2, RefreshCw, Scale, SkipForward } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { imsApi, qty, useImsMutation, useReviews, type Review } from './api';

/**
 * Inventory → MAX review (§10.1): every N days each item gets a proposal — the safety factor up after red
 * days, down after purple days, and MAX = daily use × lead time × safety factor. The reviewer applies it.
 */
export function MaxReviewPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const q = useReviews();
  const run = useImsMutation(
    () => imsApi.reviewNow(),
    (r) => t('ims.v.proposed', { count: r.proposed }),
  );
  const apply = useImsMutation(
    (x: { ids: string[]; safetyFactor?: number; skip?: boolean }) => imsApi.applyReviews(x),
    (r) => t('ims.v.applied', { count: r.done }),
  );
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.maxReview')} subtitle={t('navDesc.maxReview')} />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <>
          {q.data.canReview && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={run.isPending} onClick={() => run.mutate(undefined)}>
                {run.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} {t('ims.v.runNow')}
              </Button>
              {q.data.due.length > 1 && (
                <Button
                  disabled={apply.isPending}
                  onClick={() => apply.mutate({ ids: q.data.due.map((r) => r.id) })}
                >
                  <Check /> {t('ims.v.applyAll', { count: q.data.due.length })}
                </Button>
              )}
            </div>
          )}
          {!q.data.due.length ? (
            <EmptyState icon={Scale} title={t('ims.v.nothing')} body={t('ims.v.nothingBody')} />
          ) : (
            <ul className="space-y-2">
              {q.data.due.map((r) => (
                <Proposal
                  key={r.id}
                  r={r}
                  canReview={q.data.canReview}
                  busy={apply.isPending}
                  onApply={(x) => apply.mutate({ ids: [r.id], ...x })}
                />
              ))}
            </ul>
          )}
          {q.data.done.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t('ims.v.history')}</h2>
              <ul className="divide-y rounded-card border bg-card text-sm">
                {q.data.done.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                    <span>
                      {r.item.name}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{r.item.code}</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {r.status === 'SKIPPED'
                        ? t('ims.v.skipped')
                        : t('ims.v.was', {
                            sf: r.safetyBefore,
                            max: qty(r.maxBefore ?? 0),
                            sf2: r.safetyAfter,
                            max2: qty(r.maxAfter),
                          })}
                      {r.decidedAt && ` · ${formatDateTime(r.decidedAt, tz)}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Proposal({
  r,
  canReview,
  busy,
  onApply,
}: {
  r: Review;
  canReview: boolean;
  busy: boolean;
  onApply: (x: { safetyFactor?: number; skip?: boolean }) => void;
}) {
  const { t } = useTranslation();
  const [own, setOwn] = useState('');
  const sf = Number(own);
  const Icon = r.change === 'raised' ? ArrowUp : r.change === 'lowered' ? ArrowDown : Check;
  return (
    <li className="space-y-3 rounded-card border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {r.item.name} <span className="font-mono text-xs text-muted-foreground">{r.item.code}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t('ims.v.why', {
              use: qty(r.avgDailyUse),
              unit: r.item.unit,
              lead: r.item.leadTimeDays,
              red: r.redDays,
              purple: r.purpleDays,
            })}
          </div>
        </div>
        <StatusChip tone={r.change === 'raised' ? 'warn' : r.change === 'lowered' ? 'info' : 'ok'}>
          {t(`ims.v.change.${r.change}`)}
        </StatusChip>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-base tabular-nums">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground line-through">
          {t('ims.v.sfMax', {
            sf: r.safetyBefore,
            max: r.maxBefore === null ? '—' : qty(r.maxBefore),
            unit: r.item.unit,
          })}
        </span>
        <span>→</span>
        <b>{t('ims.v.sfMax', { sf: r.safetyAfter, max: qty(r.maxAfter), unit: r.item.unit })}</b>
      </div>
      {canReview && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => onApply({})}>
            <Check /> {t('ims.v.apply')}
          </Button>
          <Input
            aria-label={t('ims.v.ownSf')}
            placeholder={t('ims.v.ownSf')}
            inputMode="decimal"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            className="w-36"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !(sf >= 0.5 && sf <= 10)}
            onClick={() => onApply({ safetyFactor: sf })}
          >
            {t('ims.v.applyOwn')}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onApply({ skip: true })}>
            <SkipForward /> {t('ims.v.skip')}
          </Button>
        </div>
      )}
    </li>
  );
}
