import { Handshake, Loader2, UserCheck } from 'lucide-react';
import { Who } from '@/components/brand';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatLocalDate, localDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateRange, DayHeading, type Span } from '@/components/date-range';
import { useDays } from '@/lib/use-days';
import { Select } from '@/components/ui/form';
import { personLabel } from '@/lib/people';
import { useUsers } from '@/modules/system/api';
import { hrApi, useHrMutation, type CoverBoard, type CoverItem } from './api';

const STATE = { covered: 'ok', accepted: 'ok', asked: 'warn', none: 'bad' } as const;

/** HR → Cover board (CLAUDE.md §9.2): who is away today, their open work, and a one-click Buddy for what has none. */
export function CoverBoardPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const today = localDate(new Date(), tz);
  const [span, setSpan] = useState<Span>({ from: today, to: today });
  const q = useDays<CoverBoard>(['hr', 'cover'], span, (d) => `/api/hr/cover?date=${d}`, 14);
  const loaded = q.days.flatMap((d) => (d.data ? [{ day: d.day, board: d.data }] : []));
  const sum = (k: 'away' | 'work' | 'uncovered') => loaded.reduce((n, d) => n + d.board.counts[k], 0);
  const busy = loaded.filter((d) => d.board.away.length);
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.coverBoard')} subtitle={t('navDesc.coverBoard')} />
      <DateRange value={span} onChange={setSpan} today={today} ahead maxDays={14} />
      {q.error ? (
        <ErrorState onRetry={q.refetch} error={q.error} />
      ) : q.isPending ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <KpiTile label={t('hr.c.away')} value={sum('away')} hero />
            <KpiTile label={t('hr.c.work')} value={sum('work')} />
            <KpiTile
              label={t('hr.c.noBuddy')}
              value={sum('uncovered')}
              tone={sum('uncovered') ? 'bad' : undefined}
            />
          </div>
          {!busy.length ? (
            <EmptyState icon={UserCheck} title={t('hr.c.everyoneIn')} />
          ) : (
            busy.map(({ day, board }) => (
              <section key={day} className="space-y-3">
                {span.from !== span.to && (
                  <DayHeading
                    day={day}
                    today={today}
                    note={t('hr.c.dayNote', { away: board.counts.away, uncovered: board.counts.uncovered })}
                  />
                )}
                <ul className="space-y-3">
                  {board.away.map((a) => (
                    <Away key={a.person.id} a={a} date={day} tz={tz} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

function Away({ a, date, tz }: { a: CoverBoard['away'][number]; date: string; tz: string }) {
  const { t } = useTranslation();
  const users = useUsers();
  const [pick, setPick] = useState('');
  const open = a.items.filter((i) => i.state === 'none');
  const give = useHrMutation(
    (x: { keys: string[]; buddyId: string }) => hrApi.cover({ userId: a.person.id, date, ...x }),
    (r) => t('hr.c.given', { count: r.covered }),
  );
  return (
    <li className="space-y-3 rounded-card border bg-card p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            <Who id={a.person.id} name={a.person.name} />
          </div>
          <div className="text-muted-foreground">{a.person.department ?? ''}</div>
        </div>
        <StatusChip tone={a.reason === 'leave' ? 'info' : 'bad'}>
          {a.reason === 'leave' && a.leave
            ? t('hr.c.onLeave', { type: a.leave.type, to: formatLocalDate(a.leave.to) })
            : t('hr.c.absent')}
        </StatusChip>
      </div>
      {!a.items.length ? (
        <p className="text-muted-foreground">{t('hr.c.noWork')}</p>
      ) : (
        <ul className="divide-y rounded-control border">
          {a.items.map((i) => (
            <Item
              key={i.key}
              i={i}
              tz={tz}
              onGive={(buddyId) => give.mutate({ keys: [i.key], buddyId })}
              busy={give.isPending}
            />
          ))}
        </ul>
      )}
      {open.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={pick}
            aria-label={t('hr.c.allTo')}
            onChange={(e) => setPick(e.target.value)}
            className="min-w-56"
          >
            <option value="">{t('hr.c.allTo')}</option>
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE' && u.id !== a.person.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {personLabel(u)}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            disabled={!pick || give.isPending}
            onClick={() => give.mutate({ keys: open.map((o) => o.key), buddyId: pick })}
          >
            {give.isPending ? <Loader2 className="animate-spin" /> : <Handshake />}{' '}
            {t('hr.c.giveAll', { count: open.length })}
          </Button>
        </div>
      )}
    </li>
  );
}

function Item({
  i,
  tz,
  onGive,
  busy,
}: {
  i: CoverItem;
  tz: string;
  onGive: (buddyId: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const first = i.suggestions[0];
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <div className="font-medium">{i.title}</div>
        {i.due && (
          <div className="text-xs text-muted-foreground">
            {t('hr.l.due', { at: formatDateTime(i.due, tz) })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={STATE[i.state]}>
          {i.state === 'none'
            ? t('hr.c.state.none')
            : t(`hr.c.state.${i.state}`, { name: i.buddy?.name ?? '' })}
        </StatusChip>
        {i.state === 'none' && first && (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onGive(first.id)}>
            <Handshake /> {t('hr.c.giveTo', { name: first.name })}
          </Button>
        )}
      </div>
    </li>
  );
}
