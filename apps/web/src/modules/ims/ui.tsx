import { useTranslation } from 'react-i18next';
import type { Band, StatusTone } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { cn } from '@/lib/utils';

/** Bands use the fixed status colours: red = bad, yellow = warn, green = ok, purple = over (CLAUDE.md §3.1). */
const BAND_TONE: Record<Band, StatusTone> = {
  red: 'bad',
  yellow: 'warn',
  green: 'ok',
  purple: 'over',
  none: 'neutral',
};
const BAR: Record<Band, string> = {
  red: 'bg-status-bad',
  yellow: 'bg-status-warn',
  green: 'bg-status-ok',
  purple: 'bg-status-over',
  none: 'bg-status-neutral',
};

export function BandChip({ band }: { band: Band }) {
  const { t } = useTranslation();
  return <StatusChip tone={BAND_TONE[band]}>{t(`ims.band.${band}`)}</StatusChip>;
}

/** Stock against MAX: a bar with the ⅓ and ⅔ marks (over MAX fills it). */
export function StockBar({
  stock,
  max,
  band,
  className,
}: {
  stock: number;
  max: number | null;
  band: Band;
  className?: string;
}) {
  const pct = max ? Math.min(100, (stock / max) * 100) : 0;
  return (
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} aria-hidden>
      <div className={cn('h-full rounded-full', BAR[band])} style={{ width: `${pct}%` }} />
      <span className="absolute inset-y-0 left-1/3 w-px bg-background/80" />
      <span className="absolute inset-y-0 left-2/3 w-px bg-background/80" />
    </div>
  );
}
