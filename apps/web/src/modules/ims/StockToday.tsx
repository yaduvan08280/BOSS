import { ArrowDownUp, Package } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BANDS, formatINR, type Band } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { qty, useItems } from './api';
import { MoveDialog } from './MoveDialog';
import { BandChip, StockBar } from './ui';

/** Stock today (§10.3): every item by colour band, with stock against MAX and what is on order. */
export function StockToday({ canMove, canAdjust }: { canMove: boolean; canAdjust: boolean }) {
  const { t } = useTranslation();
  const q = useItems();
  const [band, setBand] = useState<Band | 'all'>('all');
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [moving, setMoving] = useState<string | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const { items, counts } = q.data;
  const rows = items
    .filter((i) => band === 'all' || i.band === band)
    .filter(
      (i) =>
        !search.trim() ||
        matchScore(search, [i.code, i.name, i.category, i.location, i.vendor].join(' ')) > 0,
    );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label={t('ims.s.value')} value={formatINR(q.data.valuePaise, { compact: true })} hero />
        <KpiTile
          label={t('ims.s.red')}
          value={counts.red}
          tone={counts.red ? 'bad' : undefined}
          note={t('ims.s.redNote')}
        />
        <KpiTile label={t('ims.s.yellow')} value={counts.yellow} />
        <KpiTile label={t('ims.s.purple')} value={counts.purple} note={t('ims.s.purpleNote')} />
      </div>
      {!items.length ? (
        <EmptyState icon={Package} title={t('ims.s.empty')} body={t('ims.s.emptyBody')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t('ims.s.search')}
              placeholder={t('ims.s.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 sm:max-w-72"
            />
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('ims.s.byBand')}>
              {(['all', ...BANDS] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={band === b}
                  onClick={() => setBand(b)}
                  className={cn(
                    'h-9 rounded-pill border px-3 text-sm',
                    band === b ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
                  )}
                >
                  {b === 'all'
                    ? t('ims.s.all', { count: items.length })
                    : `${t(`ims.band.${b}`)} ${counts[b]}`}
                </button>
              ))}
            </div>
            {canMove && (
              <Button className="ml-auto" onClick={() => setMoving('')}>
                <ArrowDownUp /> {t('ims.s.move')}
              </Button>
            )}
          </div>
          {!rows.length && <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>}
          <ul className="divide-y rounded-card border bg-card">
            {rows.map((i) => (
              <li
                key={i.id}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[minmax(0,2fr)_7rem_minmax(0,1.4fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{i.code}</span>
                    {[i.category, i.location].filter(Boolean).map((x) => ` · ${x}`)}
                  </div>
                </div>
                <div className="justify-self-end sm:justify-self-start">
                  <BandChip band={i.band} />
                </div>
                <div className="col-span-2 space-y-1 sm:col-span-1">
                  <div className="flex justify-between gap-2 text-xs tabular-nums">
                    <span>
                      <b className="text-sm">{qty(i.stock)}</b> {i.unit}
                    </span>
                    <span className="text-muted-foreground">
                      {i.maxQty ? t('ims.s.ofMax', { max: qty(i.maxQty) }) : t('ims.s.noMax')}
                      {i.onOrder > 0 && ` · ${t('ims.s.onOrder', { n: qty(i.onOrder) })}`}
                    </span>
                  </div>
                  <StockBar stock={i.stock} max={i.maxQty} band={i.band} />
                </div>
                {canMove ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="col-span-2 sm:col-span-1"
                    onClick={() => setMoving(i.id)}
                  >
                    <ArrowDownUp /> {t('ims.s.moveOne')}
                  </Button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {moving !== null && (
        <MoveDialog
          key={moving}
          open
          items={items}
          itemId={moving || undefined}
          canAdjust={canAdjust}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}
