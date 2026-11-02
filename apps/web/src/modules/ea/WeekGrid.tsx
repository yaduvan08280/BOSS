import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, hhmmToMinutes, minutesToHHmm, weekdayOf } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { useIsPhone } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { EaBoard, EaItem } from './api';

const ROW = 44; // px per hour
const KIND_TONE: Record<string, string> = {
  meeting: 'bg-status-info-bg text-status-info-fg border-status-info',
  call: 'bg-status-ok-bg text-status-ok-fg border-status-ok',
  review: 'bg-status-over-bg text-status-over-fg border-status-over',
  task: 'bg-card text-foreground border-border',
};

/** The owner's weekly schedule: a day × hour grid on desktop, an agenda on phones. Tap a free hour to book it. */
export function WeekGrid({
  board,
  today,
  onOpen,
  onSlot,
}: {
  board: EaBoard;
  today: string;
  onOpen: (item: EaItem) => void;
  onSlot: (date: string, start: string) => void;
}) {
  const { t } = useTranslation();
  const phone = useIsPhone();
  const s = board.settings;
  const [offset, setOffset] = useState(0);
  const first = addDays(today, -((weekdayOf(today) - s.weekStartsOn + 7) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const from = Math.floor(hhmmToMinutes(s.dayStart) / 60);
  const to = Math.ceil(hhmmToMinutes(s.dayEnd) / 60);
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const scheduled = board.items.filter((i) => i.stage === 'SCHEDULED' && i.scheduledDate);
  const dayLabel = (d: string) => `${t(`ea.day.${weekdayOf(d)}`)} ${d.slice(8)}/${d.slice(5, 7)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('task.rep.prev')}
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeft />
        </Button>
        <span className="tabular text-sm font-semibold">
          {dayLabel(days[0]!)} – {dayLabel(days[6]!)}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t('task.rep.next')}
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight />
        </Button>
        {offset !== 0 && (
          <Button size="sm" variant="ghost" onClick={() => setOffset(0)}>
            {t('task.range.week')}
          </Button>
        )}
      </div>
      {phone ? (
        <div className="space-y-3">
          {days.map((d) => {
            const items = scheduled
              .filter((i) => i.scheduledDate === d)
              .sort((a, b) => (a.slotStart ?? 0) - (b.slotStart ?? 0));
            return (
              <section
                key={d}
                className={cn('rounded-card border bg-card p-3', d === today && 'border-primary')}
              >
                <h3 className="mb-2 text-sm font-semibold">{dayLabel(d)}</h3>
                {items.length ? (
                  <ul className="space-y-1.5">
                    {items.map((i) => (
                      <li key={i.id}>
                        <button
                          onClick={() => onOpen(i)}
                          className={cn(
                            'w-full rounded-control border px-2.5 py-2 text-left text-sm',
                            KIND_TONE[i.kind ?? 'task'],
                          )}
                        >
                          <span className="tabular mr-2 text-xs font-semibold">
                            {minutesToHHmm(i.slotStart ?? 0)}
                          </span>
                          {i.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button className="text-xs text-muted-foreground" onClick={() => onSlot(d, s.dayStart)}>
                    {t('ea.free')}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <div className="grid min-w-[880px] grid-cols-[56px_repeat(7,1fr)]">
            <div className="border-b" />
            {days.map((d) => (
              <div
                key={d}
                className={cn(
                  'border-b border-l px-2 py-2 text-center text-xs font-semibold',
                  d === today && 'bg-primary/10',
                )}
              >
                {dayLabel(d)}
              </div>
            ))}
            <div>
              {hours.map((h) => (
                <div
                  key={h}
                  style={{ height: ROW }}
                  className="tabular border-b px-2 pt-1 text-right text-[11px] text-muted-foreground"
                >
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {days.map((d) => (
              <div key={d} className="relative border-l">
                {hours.map((h) => (
                  <button
                    key={h}
                    style={{ height: ROW }}
                    aria-label={`${dayLabel(d)} ${h}:00`}
                    onClick={() => onSlot(d, `${String(h).padStart(2, '0')}:00`)}
                    className="block w-full border-b hover:bg-primary/5"
                  />
                ))}
                {scheduled
                  .filter((i) => i.scheduledDate === d)
                  .map((i) => (
                    <button
                      key={i.id}
                      onClick={() => onOpen(i)}
                      style={{
                        top: (((i.slotStart ?? 0) - from * 60) / 60) * ROW,
                        height: Math.max(22, ((i.slotMinutes ?? 30) / 60) * ROW - 2),
                      }}
                      className={cn(
                        'absolute inset-x-1 overflow-hidden rounded-[6px] border-l-4 px-1.5 py-0.5 text-left text-[11px] leading-tight shadow-sm',
                        KIND_TONE[i.kind ?? 'task'],
                      )}
                    >
                      <span className="tabular font-semibold">{minutesToHHmm(i.slotStart ?? 0)}</span>{' '}
                      {i.text}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
