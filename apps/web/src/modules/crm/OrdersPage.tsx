import { Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatLocalDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { RecordDrawer } from '@/modules/fms/RecordDrawer';
import { useUsers } from '@/modules/system/api';
import { inr, useOrders, type OrderCard } from './api';

/**
 * Sales CRM → CRM Orders (§11.2): a kanban whose columns are the after-order steps. A card opens the order's
 * FMS record, where its step is done (checklist, proof, why late) like any FMS step.
 */
export function OrdersPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useOrders();
  const users = useUsers();
  const [open, setOpen] = useState<string | null>(null);
  const tz = me.company.timezone;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const total = d.columns.reduce((a, c) => a + c.cards.length, 0) + d.other.length;
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.crmOrders')} subtitle={t('navDesc.crmOrders')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <KpiTile label={t('crm.or.running')} value={total} hero />
        <KpiTile label={t('crm.or.thisMonth')} value={d.tiles.ordersThisMonth} />
        <KpiTile
          label={t('crm.or.onTime')}
          value={d.tiles.onTimePct === null ? '—' : `${d.tiles.onTimePct}%`}
        />
        <KpiTile
          label={t('crm.or.backlog')}
          value={inr(d.tiles.backlog, true)}
          note={d.tiles.late ? t('crm.or.late', { count: d.tiles.late }) : undefined}
          tone={d.tiles.late ? 'bad' : undefined}
        />
      </div>
      {!total ? (
        <EmptyState icon={Truck} title={t('crm.or.none')} body={t('crm.or.noneBody')} />
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {d.columns.map((c) => (
            <section
              key={c.key}
              className="w-72 shrink-0 space-y-2 rounded-card bg-muted/40 p-2"
              aria-label={c.name}
            >
              <h2 className="flex items-center justify-between px-1 text-sm font-semibold">
                {c.name} <span className="text-xs font-normal text-muted-foreground">{c.cards.length}</span>
              </h2>
              {c.cards.map((o) => (
                <Card key={o.id} o={o} tz={tz} onOpen={() => o.recordId && setOpen(o.recordId)} />
              ))}
            </section>
          ))}
          {d.other.length > 0 && (
            <section
              className="w-72 shrink-0 space-y-2 rounded-card bg-muted/40 p-2"
              aria-label={t('crm.or.other')}
            >
              <h2 className="px-1 text-sm font-semibold">{t('crm.or.other')}</h2>
              {d.other.map((o) => (
                <Card key={o.id} o={o} tz={tz} onOpen={() => o.recordId && setOpen(o.recordId)} />
              ))}
            </section>
          )}
        </div>
      )}
      {open && <RecordDrawer id={open} tz={tz} people={users.data ?? []} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Card({ o, tz, onOpen }: { o: OrderCard; tz: string; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full space-y-1.5 rounded-card border bg-card p-3 text-left text-sm hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{o.customer}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{o.number}</div>
        </div>
        <b className="tabular-nums">{inr(o.amount, true)}</b>
      </div>
      {o.step?.plannedAt && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {o.step.late ? (
            <StatusChip tone="bad">{t('crm.or.lateChip')}</StatusChip>
          ) : (
            <StatusChip tone="neutral">{t('crm.or.planned')}</StatusChip>
          )}
          <span className="text-muted-foreground">{formatDateTime(o.step.plannedAt, tz)}</span>
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {[o.step?.doer, o.promisedOn && t('crm.or.promised', { date: formatLocalDate(o.promisedOn) })]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </button>
  );
}
