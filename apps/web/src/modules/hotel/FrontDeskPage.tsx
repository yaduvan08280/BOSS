import { BedDouble, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Seg } from '@/modules/stock/ui';
import { dmy, STAY_TONE, useDesk, useProperty, type Desk, type StayRow } from './api';
import { CheckInDialog } from './CheckInDialog';
import { NewBookingDialog } from './NewBookingDialog';
import { PropertyBar } from './PropertyBar';
import { StayDialog } from './StayDialog';

type Tab = keyof Omit<Desk, 'businessDate'>;

/** The front desk (phase 17): who arrives, who is in the house, who leaves — and everything done for a guest. */
export function FrontDeskPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const p = useProperty();
  const desk = useDesk(p.branchId);
  const [tab, setTab] = useState<Tab>('arrivals');
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState<StayRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canDesk = hasPermission(me.user.permissions, 'hosp.create');
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('hotel.noRooms')} body={t('hotel.noRoomsBody')} />;
  const d = desk.data;
  const tabs: Tab[] = ['arrivals', 'inHouse', 'departures', 'dueOuts'];
  return (
    <div>
      <PageHeader
        title={t('hotel.desk.title')}
        subtitle={t('hotel.desk.subtitle')}
        actions={
          canDesk &&
          d && (
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}>
              <Plus /> {t('hotel.newBooking')}
            </Button>
          )
        }
      />
      <PropertyBar
        list={p.list}
        branchId={p.branchId}
        onChange={p.setBranchId}
        businessDate={d?.businessDate}
      />
      {desk.isPending ? (
        <PageSkeleton />
      ) : desk.isError || !d ? (
        <ErrorState onRetry={() => void desk.refetch()} error={desk.error} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tabs.map((k, i) => (
              <KpiTile key={k} hero={i === 1} label={t(`hotel.desk.${k}`)} value={String(d[k].length)} />
            ))}
          </div>
          <Seg
            value={tab}
            onChange={setTab}
            options={tabs.map((k) => ({ key: k, label: t(`hotel.desk.${k}`) }))}
          />
          {d[tab].length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hotel.desk.nobody')}</p>
          ) : (
            <ul className="space-y-2">
              {d[tab].map((s) => (
                <li key={s.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => setOpenId(s.id)}>
                      <div className="font-medium">
                        {s.guest?.name} {s.room ? `· ${t('hotel.inRoom', { room: s.room })}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{s.number}</span> · {s.roomType} · {dmy(s.arrive)} →{' '}
                        {dmy(s.depart)} · {s.meal}
                      </div>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={STAY_TONE[s.status]}>{t(`hotel.status.${s.status}`)}</StatusChip>
                      {s.formCDue && <StatusChip tone="warn">{t('hotel.formCDue')}</StatusChip>}
                      {canDesk && s.status === 'BOOKED' && s.arrive <= d.businessDate && (
                        <Button size="sm" variant="primary" onClick={() => setChecking(s)}>
                          {t('hotel.checkIn')}
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setOpenId(s.id)}>
                        {t('hotel.open')}
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {adding && (
            <NewBookingDialog
              branchId={p.branchId}
              businessDate={d.businessDate}
              types={p.types}
              onClose={() => setAdding(false)}
            />
          )}
          {checking && <CheckInDialog stay={checking} rooms={p.rooms} onClose={() => setChecking(null)} />}
          {openId && (
            <StayDialog
              id={openId}
              branchId={p.branchId}
              rooms={p.rooms}
              canDesk={canDesk}
              onClose={() => setOpenId(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
