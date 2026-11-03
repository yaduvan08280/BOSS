import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, weekdayOf } from '@mono/shared';
import { cn } from '@/lib/utils';
import { dmyToIso, isoToDmy, maskDmy, parseTime } from '@/lib/date-text';

const box =
  'h-11 w-full min-w-0 rounded-control border border-input bg-card px-3 text-base tabular-nums outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 aria-invalid:border-status-bad sm:h-10 sm:text-sm';

/**
 * A date typed as DD/MM/YYYY (slashes are added for you), or picked from a calendar.
 * Never the browser's own picker, which follows the browser's locale (MM/DD in en-US).
 * `value` / `onChange` use YYYY-MM-DD.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  className?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const text = draft ?? isoToDmy(value);
  const parsed = draft !== null ? dmyToIso(draft) : value;
  const outOfRange = Boolean(parsed && ((min && parsed < min) || (max && parsed > max)));
  const bad = draft !== null && draft.length >= 6 && (!parsed || outOfRange);

  const type = (raw: string) => {
    const next = maskDmy(raw);
    setDraft(next);
    const iso = next.length === 10 ? dmyToIso(next) : null;
    if (iso && !(min && iso < min) && !(max && iso > max)) onChange(iso);
  };
  const commit = () => {
    const iso = draft !== null ? dmyToIso(draft) : null;
    if (iso && !(min && iso < min) && !(max && iso > max)) onChange(iso);
    setDraft(null);
  };

  return (
    <div className={cn('relative', className)}>
      <input
        className={cn(box, 'pr-10')}
        inputMode="numeric"
        placeholder={t('common.dmy')}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        value={text}
        onChange={(e) => type(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={t('common.openCalendar')}
            className="absolute right-1 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[calc(var(--radius)*0.5)] text-muted-foreground hover:bg-muted"
          >
            <CalendarDays className="size-4" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-[60] rounded-card border bg-card p-3 shadow-lg"
          >
            <Calendar
              value={value}
              min={min}
              max={max}
              onPick={(iso) => {
                onChange(iso);
                setDraft(null);
                setOpen(false);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** Month grid, Monday first, in DD/MM/YYYY terms. */
function Calendar({
  value,
  min,
  max,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  onPick: (iso: string) => void;
}) {
  const { t } = useTranslation();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [month, setMonth] = useState((value || today).slice(0, 7));
  const first = `${month}-01`;
  const start = addDays(first, 1 - weekdayOf(first));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const shift = (by: number) => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div className="w-[264px]">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          className="grid size-8 place-items-center rounded-control hover:bg-muted"
          aria-label={t('task.rep.prev')}
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold">
          {t(`common.month.${Number(month.slice(5))}`)} {month.slice(0, 4)}
        </span>
        <button
          type="button"
          className="grid size-8 place-items-center rounded-control hover:bg-muted"
          aria-label={t('task.rep.next')}
          onClick={() => shift(1)}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-muted-foreground">
        {DAYS.map((d) => (
          <span key={d} className="py-1">
            {t(`ea.day.${d}`)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d) => {
          const off = (min && d < min) || (max && d > max);
          return (
            <button
              key={d}
              type="button"
              disabled={Boolean(off)}
              aria-label={isoToDmy(d)}
              aria-pressed={d === value}
              onClick={() => onPick(d)}
              className={cn(
                'tabular h-8 rounded-[calc(var(--radius)*0.5)] text-sm hover:bg-muted disabled:opacity-30',
                d.slice(0, 7) !== month && 'text-muted-foreground',
                d === today && 'font-semibold ring-1 ring-primary',
                d === value && 'bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A 24-hour time: type 18:00, 1800 or 6pm. `value` / `onChange` use HH:mm. */
export function TimeInput({
  value,
  onChange,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (hhmm: string) => void;
  className?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const bad = draft !== null && draft.trim().length >= 3 && !parseTime(draft);
  const commit = () => {
    const v = draft !== null ? parseTime(draft) : null;
    if (v) onChange(v);
    setDraft(null);
  };
  return (
    <input
      className={cn(box, 'w-[6.5rem]', className)}
      placeholder={t('common.hhmm')}
      aria-label={ariaLabel}
      aria-invalid={bad || undefined}
      value={draft ?? value}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = /^\d{2}:\d{2}$/.test(e.target.value) ? parseTime(e.target.value) : null;
        if (v) onChange(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/** Date + time side by side. `value` / `onChange` use the "YYYY-MM-DDTHH:mm" the forms already work with. */
export function DateTimeInput({
  value,
  onChange,
  min,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const [date = '', time = '00:00'] = value.split('T');
  return (
    <div className="flex gap-2">
      <DateInput
        className="flex-1"
        aria-label={ariaLabel}
        value={date}
        min={min}
        onChange={(d) => onChange(`${d}T${time.slice(0, 5)}`)}
      />
      <TimeInput
        aria-label={t('common.time')}
        value={time.slice(0, 5)}
        onChange={(tm) => onChange(`${date}T${tm}`)}
      />
    </div>
  );
}
