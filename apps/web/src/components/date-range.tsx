import { useTranslation } from 'react-i18next';
import { addDays, weekdayOf } from '@mono/shared';
import { DateInput } from '@/components/ui/date-input';
import { cn } from '@/lib/utils';

import type { Span } from '@/lib/days';

export type { Span };

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const monthEnd = (day: string) => addDays(monthStart(addDays(monthStart(day), 32)), -1);

/**
 * From – to, with one-tap spans. `ahead` offers the days to come (bookings, plans); otherwise the days behind
 * (what happened). A span is never wider than `maxDays`: the far end follows the one that was changed.
 */
export function DateRange({
  value,
  onChange,
  today,
  ahead = false,
  maxDays = 62,
  className,
}: {
  value: Span;
  onChange: (span: Span) => void;
  today: string;
  ahead?: boolean;
  maxDays?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const set = (part: Partial<Span>) => {
    let { from, to } = { ...value, ...part };
    if (!from || !to) return;
    if (to < from) [from, to] = part.from ? [from, from] : [to, to];
    if (addDays(from, maxDays - 1) < to) {
      if (part.from) to = addDays(from, maxDays - 1);
      else from = addDays(to, -(maxDays - 1));
    }
    onChange({ from, to });
  };
  const monday = addDays(today, 1 - weekdayOf(today));
  const presets: { key: string; span: Span }[] = ahead
    ? [
        { key: 'today', span: { from: today, to: today } },
        { key: 'next7', span: { from: today, to: addDays(today, 6) } },
        { key: 'next30', span: { from: today, to: addDays(today, 29) } },
      ]
    : [
        { key: 'today', span: { from: today, to: today } },
        { key: 'yesterday', span: { from: addDays(today, -1), to: addDays(today, -1) } },
        { key: 'week', span: { from: monday, to: today } },
        { key: 'month', span: { from: monthStart(today), to: ahead ? monthEnd(today) : today } },
      ];
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <DateInput
          value={value.from}
          onChange={(from) => set({ from })}
          aria-label={t('span.from')}
          className="w-36"
        />
        <span className="text-muted-foreground">–</span>
        <DateInput
          value={value.to}
          onChange={(to) => set({ to })}
          aria-label={t('span.to')}
          className="w-36"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const on = p.span.from === value.from && p.span.to === value.to;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.span)}
              className={cn(
                'h-9 rounded-pill border px-3 text-xs font-medium',
                on
                  ? 'border-ink bg-ink text-ink-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`span.${p.key}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The heading that separates one day's rows from the next in a list that spans several days. */
export function DayHeading({ day, today, note }: { day: string; today?: string; note?: string }) {
  const { t } = useTranslation();
  const [y, m, d] = day.split('-');
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b bg-background/95 px-1 py-2 backdrop-blur">
      <h3 className="text-sm font-semibold">
        {t(`span.weekday.${weekdayOf(day)}`)}, <span className="tabular">{`${d}/${m}/${y}`}</span>
      </h3>
      {day === today && (
        <span className="rounded-pill bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
          {t('span.today')}
        </span>
      )}
      {note && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}
