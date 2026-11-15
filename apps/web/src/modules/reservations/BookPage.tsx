import { CalendarClock, Plus, Settings2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, hasPermission, localDate, type Me } from '@mono/shared';
import { DateRange, DayHeading, type Span } from '@/components/date-range';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { useOutlets } from '@/modules/hosp/api';
import { useOutletChoice } from '@/modules/hosp/outletChoice';
import { Seg } from '@/modules/stock/ui';
import { useBook, useBookSpan, useWaitlist, type Book, type SpanRes } from './api';
import { BookingDialog } from './BookingDialog';
import { ReservationCard } from './ReservationCard';
import { RulesDialog } from './RulesDialog';
import { WaitlistPanel } from './WaitlistPanel';

/**
 * The reservation book (phase 16): every booking of the days chosen — the next seven to start with — at one
 * outlet or at all of them, a heading for each day; the waitlist; and an outlet's booking rules.
 */
export function BookPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [home, setHome] = useOutletChoice(outlets.data);
  const today = localDate(new Date(), me.company.timezone);
  const [outletId, setOutletId] = useState('');
  const [span, setSpan] = useState<Span>({ from: today, to: addDays(today, 6) });
  const [tab, setTab] = useState<'book' | 'waitlist'>('book');
  // A dialog works on one outlet's book: `ask` first asks which outlet when all of them are shown.
  const [ask, setAsk] = useState<'add' | 'rules' | null>(null);
  const [open, setOpen] = useState<{
    kind: 'add' | 'rules' | 'edit';
    outletId: string;
    edit?: SpanRes;
  } | null>(null);

  const book = useBookSpan(span.from, span.to, outletId);
  const waitOutlet = outletId || home;
  const waiting = useWaitlist(waitOutlet);
  const canHost = hasPermission(me.user.permissions, 'hosp.create');
  const canSetUp = hasPermission(me.user.permissions, 'hosp.edit');
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} error={outlets.error} />;
  if (!outlets.data.length)
    return <EmptyState icon={CalendarClock} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  const b = book.data;
  const start = (kind: 'add' | 'rules') =>
    outletId || outlets.data.length === 1
      ? setOpen({ kind, outletId: outletId || outlets.data[0]!.id })
      : setAsk(kind);
  const all = !outletId && outlets.data.length > 1;
  return (
    <div>
      <PageHeader
        title={t('res.title')}
        subtitle={t('res.subtitle')}
        actions={
          <>
            {canSetUp && (
              <Button size="sm" onClick={() => start('rules')}>
                <Settings2 /> {t('res.rules.button')}
              </Button>
            )}
            {canHost && (
              <Button size="sm" variant="primary" onClick={() => start('add')}>
                <Plus /> {t('res.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {outlets.data.length > 1 && (
          <div className="w-full sm:w-56">
            <Select
              aria-label={t('hosp.outlet.one')}
              value={outletId}
              onChange={(e) => {
                setOutletId(e.target.value);
                if (e.target.value) setHome(e.target.value);
              }}
            >
              <option value="">{t('res.allOutlets')}</option>
              {outlets.data.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <DateRange value={span} onChange={setSpan} today={today} ahead />
      </div>
      {book.isPending ? (
        <PageSkeleton />
      ) : book.isError || !b ? (
        <ErrorState onRetry={() => void book.refetch()} error={book.error} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile hero label={t('res.kpi.bookings')} value={String(b.counts.bookings)} />
            <KpiTile label={t('res.kpi.covers')} value={String(b.counts.covers)} />
            <KpiTile label={t('res.kpi.toConfirm')} value={String(b.counts.toConfirm)} />
            <KpiTile label={t('res.kpi.waiting')} value={String(waiting.data?.waiting.length ?? 0)} />
          </div>
          <Seg
            value={tab}
            onChange={setTab}
            options={[
              { key: 'book', label: t('res.tab.book') },
              { key: 'waitlist', label: t('res.tab.waitlist') },
            ]}
          />
          {tab === 'waitlist' ? (
            <div className="space-y-3">
              {all && (
                <Select
                  className="sm:w-56"
                  aria-label={t('hosp.outlet.one')}
                  value={waitOutlet}
                  onChange={(e) => setHome(e.target.value)}
                >
                  {outlets.data.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              )}
              <WithBook outletId={waitOutlet} day="">
                {(bk) => <WaitlistPanel book={bk} canHost={canHost} />}
              </WithBook>
            </div>
          ) : b.reservations.length === 0 ? (
            <EmptyState icon={CalendarClock} title={t('res.empty')} body={t('res.emptySpan')} />
          ) : (
            <div className="space-y-4">
              {b.days.map((d) => (
                <section key={d.day} className="space-y-2">
                  <DayHeading
                    day={d.day}
                    today={b.today}
                    note={t('res.dayNote', { bookings: d.bookings, covers: d.covers })}
                  />
                  <ul className="space-y-2">
                    {b.reservations
                      .filter((r) => r.day === d.day)
                      .map((r) => (
                        <li key={r.id}>
                          {all && (
                            <div className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">
                              {r.outlet}
                            </div>
                          )}
                          <ReservationCard
                            r={r}
                            canHost={canHost}
                            onEdit={() => setOpen({ kind: 'edit', outletId: r.outletId, edit: r })}
                          />
                        </li>
                      ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}
      {ask && (
        <Dialog open onOpenChange={(o) => !o && setAsk(null)} title={t('res.whichOutlet')}>
          <ul className="space-y-2">
            {outlets.data.map((o) => (
              <li key={o.id}>
                <Button
                  className="w-full justify-start"
                  onClick={() => {
                    setOpen({ kind: ask, outletId: o.id });
                    setAsk(null);
                  }}
                >
                  {o.name}
                </Button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
      {open && (
        <WithBook outletId={open.outletId} day={open.edit?.day ?? (span.from > today ? span.from : '')} quiet>
          {(bk) =>
            open.kind === 'rules' ? (
              <RulesDialog book={bk} onClose={() => setOpen(null)} />
            ) : (
              <BookingDialog book={bk} edit={open.edit} onClose={() => setOpen(null)} />
            )
          }
        </WithBook>
      )}
    </div>
  );
}

/** One outlet's book of a day, for the dialogs and the waitlist that work on a single outlet. */
function WithBook({
  outletId,
  day,
  quiet,
  children,
}: {
  outletId: string;
  day: string;
  quiet?: boolean;
  children: (book: Book) => ReactNode;
}) {
  const q = useBook(outletId, day);
  if (q.data) return <>{children(q.data)}</>;
  if (quiet) return null;
  return q.isError ? <ErrorState onRetry={() => void q.refetch()} error={q.error} /> : <PageSkeleton />;
}
