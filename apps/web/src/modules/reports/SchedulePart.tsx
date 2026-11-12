import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { hhmmToMinutes, minutesToHHmm, type ReportSchedule } from '@mono/shared';
import { TimeInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { useUsers } from '@/modules/system/api';
import { Block } from './BuilderParts';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

/**
 * "Send it by itself": every day, a weekday each week or a day each month, at a time (company time), to the
 * people chosen. They get a message with the report's numbers and a link, through the company's own
 * notification rule (Telegram, email, in-app).
 */
export function SchedulePart({
  schedule,
  onChange,
  me,
}: {
  schedule: ReportSchedule | null;
  onChange: (s: ReportSchedule | null) => void;
  /** Chosen first when sending is switched on. */
  me: string;
}) {
  const { t } = useTranslation();
  const people = (useUsers().data ?? []).filter((p) => p.status === 'ACTIVE');
  const names = new Map(people.map((p) => [p.id, p.name]));
  const set = (patch: Partial<ReportSchedule>) => schedule && onChange({ ...schedule, ...patch });
  return (
    <Block title={t('reports.s.title')} hint={t('reports.s.hint')}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select
          aria-label={t('reports.s.every')}
          value={schedule?.every ?? ''}
          onChange={(e) => {
            const every = e.target.value as ReportSchedule['every'] | '';
            if (!every) return onChange(null);
            onChange({
              every,
              at: schedule?.at ?? 9 * 60,
              ...(every === 'day' ? {} : { on: 1 }),
              userIds: schedule?.userIds.length ? schedule.userIds : [me],
            });
          }}
        >
          <option value="">{t('reports.s.never')}</option>
          <option value="day">{t('reports.s.day')}</option>
          <option value="week">{t('reports.s.week')}</option>
          <option value="month">{t('reports.s.month')}</option>
        </Select>
        {schedule && (
          <TimeInput
            aria-label={t('reports.s.at')}
            value={minutesToHHmm(schedule.at)}
            onChange={(hhmm) => hhmm && set({ at: hhmmToMinutes(hhmm) })}
          />
        )}
        {schedule?.every === 'week' && (
          <Select
            aria-label={t('reports.s.weekday')}
            value={String(schedule.on ?? 1)}
            onChange={(e) => set({ on: Number(e.target.value) })}
          >
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {t(`reports.s.wd.${d}`)}
              </option>
            ))}
          </Select>
        )}
        {schedule?.every === 'month' && (
          <Select
            aria-label={t('reports.s.monthDay')}
            value={String(schedule.on ?? 1)}
            onChange={(e) => set({ on: Number(e.target.value) })}
          >
            {MONTH_DAYS.map((d) => (
              <option key={d} value={d}>
                {t('reports.s.dayN', { n: d })}
              </option>
            ))}
          </Select>
        )}
      </div>
      {schedule && (
        <div className="space-y-2">
          <Select
            aria-label={t('reports.s.addPerson')}
            value=""
            onChange={(e) =>
              e.target.value &&
              !schedule.userIds.includes(e.target.value) &&
              set({ userIds: [...schedule.userIds, e.target.value] })
            }
          >
            <option value="">{t('reports.s.addPerson')}</option>
            {people
              .filter((p) => !schedule.userIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
          <ul className="flex flex-wrap gap-1.5">
            {schedule.userIds.map((id) => (
              <li key={id} className="flex items-center gap-1 rounded-pill border bg-card pl-3 text-sm">
                {names.get(id) ?? '—'}
                <button
                  type="button"
                  aria-label={t('reports.s.removePerson', { name: names.get(id) ?? '' })}
                  disabled={schedule.userIds.length === 1}
                  onClick={() => set({ userIds: schedule.userIds.filter((x) => x !== id) })}
                  className="grid size-11 place-items-center rounded-full disabled:opacity-40 md:size-8"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Block>
  );
}
