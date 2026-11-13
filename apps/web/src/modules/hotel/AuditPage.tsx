import { BedDouble, Moon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Confirm } from '@/components/ui/dialog';
import { rupees } from '@/modules/stock/api';
import { dmy, send, useAudits, useHotelMutation, useProperty, type AuditPack } from './api';
import { PropertyBar } from './PropertyBar';

/** The night audit (phase 17): close the hotel's day, and read the pack of each day closed. */
export function AuditPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const p = useProperty();
  const audits = useAudits(p.branchId);
  const [asking, setAsking] = useState(false);
  const canRun = hasPermission(me.user.permissions, 'hosp.edit');
  const run = useHotelMutation(
    () => send<{ businessDate: string }>('/api/hotel/night-audit', { branchId: p.branchId }),
    (r) => t('hotel.audit.done', { date: dmy(r.businessDate) }),
  );
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('hotel.noRooms')} body={t('hotel.noRoomsBody')} />;
  const d = audits.data;
  const last: AuditPack | undefined = d?.audits[0];
  return (
    <div>
      <PageHeader
        title={t('hotel.audit.title')}
        subtitle={t('hotel.audit.subtitle')}
        actions={
          canRun &&
          d && (
            <Button size="sm" variant="primary" disabled={run.isPending} onClick={() => setAsking(true)}>
              <Moon /> {t('hotel.audit.run', { date: dmy(d.businessDate) })}
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
      {audits.isPending ? (
        <PageSkeleton />
      ) : audits.isError || !d ? (
        <ErrorState onRetry={() => void audits.refetch()} />
      ) : !last ? (
        <EmptyState icon={Moon} title={t('hotel.audit.none')} body={t('hotel.audit.noneBody')} />
      ) : (
        <div className="space-y-5">
          <h2 className="text-sm font-semibold">{t('hotel.audit.packOf', { date: dmy(last.day) })}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              hero
              label={t('hotel.audit.occupancy')}
              value={`${last.occupancyPct}%`}
              note={t('hotel.audit.soldOf', { sold: last.sold, rooms: last.rooms - last.outOfOrder })}
            />
            <KpiTile label={t('hotel.audit.adr')} value={rupees(last.adr)} />
            <KpiTile label={t('hotel.audit.revPar')} value={rupees(last.revPar)} />
            <KpiTile label={t('hotel.audit.roomRevenue')} value={rupees(last.roomRevenue)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-1 p-4 text-sm">
              <h3 className="font-semibold">{t('hotel.audit.checks')}</h3>
              <p>{t('hotel.audit.noShows', { count: last.noShows.length })}</p>
              {last.noShows.map((n) => (
                <p key={n.number} className="text-muted-foreground">
                  {n.number} · {n.guest} · {rupees(n.charge)}
                </p>
              ))}
              <p>{t('hotel.audit.dueOuts', { count: last.checks.dueOuts.length })}</p>
              <p>{t('hotel.audit.openFolios', { count: last.checks.openFoliosOfDeparted.length })}</p>
              <p>{t('hotel.audit.unpaidBills', { count: last.checks.unpaidRestaurantBills })}</p>
            </Card>
            <Card className="space-y-1 p-4 text-sm">
              <h3 className="font-semibold">{t('hotel.audit.money')}</h3>
              {last.revenueByOutlet.map((o) => (
                <p key={o.outlet} className="flex justify-between">
                  <span>{o.outlet}</span>
                  <span className="tabular">{rupees(o.amount)}</span>
                </p>
              ))}
              {last.money.map((m) => (
                <p key={m.mode} className="flex justify-between text-muted-foreground">
                  <span>{m.mode}</span>
                  <span className="tabular">{rupees(m.amount)}</span>
                </p>
              ))}
              {!last.revenueByOutlet.length && !last.money.length && (
                <p className="text-muted-foreground">{t('hotel.audit.noMoney')}</p>
              )}
            </Card>
          </div>
          <ul className="space-y-1 text-sm">
            {d.audits.slice(1, 15).map((a) => (
              <li key={a.day} className="flex flex-wrap justify-between gap-2 border-t py-1">
                <span>{dmy(a.day)}</span>
                <span className="tabular text-muted-foreground">
                  {a.occupancyPct}% · {rupees(a.adr)} · {rupees(a.roomRevenue)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {asking && d && (
        <Confirm
          open
          title={t('hotel.audit.confirm', { date: dmy(d.businessDate) })}
          body={t('hotel.audit.confirmBody')}
          confirm={t('hotel.audit.runShort')}
          onConfirm={() => run.mutate(undefined, { onSettled: () => setAsking(false) })}
          onOpenChange={(o) => !o && setAsking(false)}
        />
      )}
    </div>
  );
}
