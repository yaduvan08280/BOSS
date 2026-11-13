import { CalendarClock, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { useOutlets } from '@/modules/hosp/api';
import { Seg } from '@/modules/stock/ui';
import { useBook, useWaitlist, type Res } from './api';
import { BookingDialog } from './BookingDialog';
import { ReservationCard } from './ReservationCard';
import { RulesDialog } from './RulesDialog';
import { WaitlistPanel } from './WaitlistPanel';

/** The reservation book (phase 16): the day's bookings at an outlet, the waitlist, and the outlet's booking rules. */
export function BookPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [outletId, setOutletId] = useState('');
  const [day, setDay] = useState('');
  const [tab, setTab] = useState<'book' | 'waitlist'>('book');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Res | null>(null);
  const [rules, setRules] = useState(false);
  const current = outletId || outlets.data?.[0]?.id || '';
  const book = useBook(current, day);
  const waiting = useWaitlist(current);
  const canHost = hasPermission(me.user.permissions, 'hosp.create');
  const canSetUp = hasPermission(me.user.permissions, 'hosp.edit');
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} />;
  if (!outlets.data.length)
    return <EmptyState icon={CalendarClock} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  const b = book.data;
  return (
    <div>
      <PageHeader
        title={t('res.title')}
        subtitle={t('res.subtitle')}
        actions={
          <>
            {canSetUp && b && (
              <Button size="sm" onClick={() => setRules(true)}>
                <Settings2 /> {t('res.rules.button')}
              </Button>
            )}
            {canHost && b && (
              <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
                <Plus /> {t('res.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <Select
            aria-label={t('hosp.outlet.one')}
            value={current}
            onChange={(e) => setOutletId(e.target.value)}
          >
            {outlets.data.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <DateInput value={day || b?.day || ''} onChange={setDay} aria-label={t('res.day')} />
        </div>
        {b && b.day !== b.today && (
          <Button size="sm" variant="ghost" onClick={() => setDay('')}>
            {t('res.today')}
          </Button>
        )}
      </div>
      {book.isPending ? (
        <PageSkeleton />
      ) : book.isError || !b ? (
        <ErrorState onRetry={() => void book.refetch()} />
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
            <WaitlistPanel book={b} canHost={canHost} />
          ) : b.reservations.length === 0 ? (
            <EmptyState icon={CalendarClock} title={t('res.empty')} body={t('res.emptyBody')} />
          ) : (
            <ul className="space-y-2">
              {b.reservations.map((r) => (
                <li key={r.id}>
                  <ReservationCard r={r} canHost={canHost} onEdit={() => setEditing(r)} />
                </li>
              ))}
            </ul>
          )}
          {adding && <BookingDialog book={b} onClose={() => setAdding(false)} />}
          {editing && <BookingDialog book={b} edit={editing} onClose={() => setEditing(null)} />}
          {rules && <RulesDialog book={b} onClose={() => setRules(false)} />}
        </>
      )}
    </div>
  );
}
