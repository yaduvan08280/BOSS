import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  daysInMonth,
  formatLocalDate,
  weekdayOf,
  zonedToUtc,
  type AttendanceStatus,
} from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { hm, hrApi, STATUS_TONE, useHrMutation, type AttendanceDayRow, type MonthView } from './api';

const DOT: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-status-ok',
  LATE: 'bg-status-warn',
  HALF_DAY: 'bg-status-over',
  ABSENT: 'bg-status-bad',
  ON_LEAVE: 'bg-status-info',
  HOLIDAY: 'bg-status-neutral',
  WEEKLY_OFF: 'bg-status-neutral',
};

/** My month: one square per day with what it counted as; a day opens its reasons and the correction form. */
export function MonthGrid({
  month,
  view,
  tz,
  onMonth,
}: {
  month: string;
  view: MonthView;
  tz: string;
  onMonth: (m: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = `${month}-01`;
  const lead = weekdayOf(first) - 1;
  const days = Array.from({ length: daysInMonth(y, m) }, (_, i) => addDays(first, i));
  const byDate = new Map(view.days.map((d) => [d.date, d]));
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    onMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const status = (d: string): AttendanceDayRow | null =>
    byDate.get(d) ??
    (view.today?.date === d && view.today.final
      ? ({
          ...view.today,
          workedMin: view.today.workedMinutes,
          lateMin: view.today.lateMinutes,
        } as unknown as AttendanceDayRow)
      : null);
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.prevMonth')} onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <div className="text-sm font-semibold">
          {new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC',
          }).format(new Date(Date.UTC(y, m - 1, 1)))}
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.nextMonth')} onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {names.map((n) => (
          <div key={n}>{t(`hr.day.${n}`)}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`x${i}`} />
        ))}
        {days.map((d) => {
          const s = status(d);
          return (
            <button
              key={d}
              type="button"
              onClick={() => setOpen(d)}
              aria-label={`${formatLocalDate(d)}${s ? `: ${t(`hr.status.${s.status}`)}` : ''}`}
              className={cn(
                'flex aspect-square flex-col items-center justify-center gap-1 rounded-control border bg-card text-sm',
                !s && 'text-muted-foreground',
              )}
            >
              <span className="tabular-nums">{Number(d.slice(8))}</span>
              <span className={cn('size-2 rounded-full', s ? DOT[s.status] : 'bg-transparent')} />
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {(Object.keys(DOT) as AttendanceStatus[])
          .filter((s) => s !== 'WEEKLY_OFF')
          .map((s) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className={cn('size-2 rounded-full', DOT[s])} /> {t(`hr.status.${s}`)}
            </span>
          ))}
      </div>
      {open && <DayDialog date={open} day={status(open)} view={view} tz={tz} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DayDialog({
  date,
  day,
  view,
  tz,
  onClose,
}: {
  date: string;
  day: AttendanceDayRow | null;
  view: MonthView;
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [inAt, setIn] = useState('');
  const [outAt, setOut] = useState('');
  const [reason, setReason] = useState('');
  const left = view.corrections.limit - view.corrections.used;
  const toIso = (hhmm: string) =>
    zonedToUtc(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz).toISOString();
  const ask = useHrMutation(
    () =>
      hrApi.correction({ date, inAt: inAt ? toIso(inAt) : null, outAt: outAt ? toIso(outAt) : null, reason }),
    () => t('hr.a.correctionSent'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={formatLocalDate(date)}
      description={day ? t(`hr.status.${day.status}`) : t('hr.a.notSettled')}
      footer={
        <Button
          variant="primary"
          disabled={left <= 0 || (!inAt && !outAt) || reason.trim().length < 3 || ask.isPending}
          onClick={() => ask.mutate(undefined, { onSuccess: onClose })}
        >
          {ask.isPending && <Loader2 className="animate-spin" />} {t('hr.a.askCorrection')}
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        {day && (
          <div className="space-y-1">
            <StatusChip tone={STATUS_TONE[day.status]}>{t(`hr.status.${day.status}`)}</StatusChip>
            {day.workedMin > 0 && <div>{t('hr.a.worked', { h: hm(day.workedMin) })}</div>}
            {day.reasons.map((r) => (
              <div key={r} className="text-muted-foreground">
                {r}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {t('hr.a.correctionsLeft', { count: Math.max(0, left) })}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('hr.a.cameIn')}>
            <TimeInput value={inAt} onChange={setIn} />
          </Field>
          <Field label={t('hr.a.left')}>
            <TimeInput value={outAt} onChange={setOut} />
          </Field>
        </div>
        <Field label={t('hr.a.why')}>
          <Textarea
            rows={2}
            className="font-sans"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
