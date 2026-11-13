import { Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WASTE_REASONS, formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, qty, rupees, useItems, useStock, useStockMutation, useWaste } from './api';
import { ItemSelect, PlaceSelect } from './ui';

/** The wastage register (phase 13): what was thrown away, why, what it was worth, and what waits for a yes. */
export function WastagePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useWaste();
  const [make, setMake] = useState(false);
  const decide = useStockMutation(
    (a: { id: string; approve: boolean }) => post(`/api/ims/moves/${a.id}/decide`, { approve: a.approve }),
    t('org.saved'),
  );
  const total = (q.data?.byReason ?? []).reduce((n, r) => n + r.value, 0);
  return (
    <div>
      <PageHeader
        title={t('stock.waste.title')}
        subtitle={t('stock.waste.subtitle')}
        actions={
          hasPermission(me.user.permissions, 'ims.create') && (
            <Button variant="primary" onClick={() => setMake(true)}>
              <Plus /> {t('stock.waste.new')}
            </Button>
          )
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.rows.length === 0 ? (
        <EmptyState icon={Trash} title={t('stock.waste.emptyTitle')} body={t('stock.waste.emptyBody')} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile hero label={t('stock.waste.total')} value={rupees(total)} />
            {q.data.byReason.slice(0, 3).map((r) => (
              <KpiTile key={r.reason} label={t(`stock.waste.reason.${r.reason}`)} value={rupees(r.value)} />
            ))}
          </div>
          <ul className="space-y-2">
            {q.data.rows.map((r) => (
              <li key={r.id}>
                <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">
                      {r.item.name} · {qty(r.unitQty)} {r.unit}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatLocalDate(r.at.slice(0, 10))} · {r.location}
                      {r.by && ` · ${r.by}`}
                      {r.note && ` · ${r.note}`}
                    </div>
                  </div>
                  <StatusChip tone="neutral">{t(`stock.waste.reason.${r.reason}`)}</StatusChip>
                  {r.status !== 'APPLIED' && (
                    <StatusChip tone={r.status === 'PENDING' ? 'warn' : 'bad'}>
                      {t(`stock.waste.status.${r.status}`)}
                    </StatusChip>
                  )}
                  <span className="tabular font-semibold">{rupees(r.value)}</span>
                  {r.canDecide && (
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, approve: false })}
                      >
                        {t('stock.reject')}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: r.id, approve: true })}
                      >
                        {t('stock.approve')}
                      </Button>
                    </span>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {make && <WasteDialog onClose={() => setMake(false)} />}
    </div>
  );
}

function WasteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const stock = useStock();
  const places = stock.data?.places ?? [];
  const [d, setD] = useState({
    itemId: '',
    locationId: places[0]?.id ?? '',
    qty: '',
    unit: '',
    reason: 'SPOILED',
    note: '',
  });
  const save = useStockMutation(
    () =>
      post<{ pending: boolean }>('/api/ims/wastage', {
        ...d,
        qty: Number(d.qty),
        unit: d.unit || null,
        note: d.note || null,
      }),
    (r) => (r.pending ? t('stock.waste.waits') : t('stock.waste.saved')),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.waste.new')}
      footer={
        <Button
          variant="primary"
          disabled={!d.itemId || !(Number(d.qty) > 0) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('stock.item')} className="col-span-2">
          <ItemSelect
            label={t('stock.item')}
            value={d.itemId}
            items={(items.data?.items ?? []).filter((x) => x.active)}
            onChange={(itemId) => setD({ ...d, itemId })}
          />
        </Field>
        <Field label={t('stock.location')} className="col-span-2">
          <PlaceSelect
            label={t('stock.location')}
            value={d.locationId}
            places={places}
            onChange={(locationId) => setD({ ...d, locationId })}
          />
        </Field>
        <Field label={t('stock.qty')}>
          <Input inputMode="decimal" value={d.qty} onChange={(e) => setD({ ...d, qty: e.target.value })} />
        </Field>
        <Field label={t('stock.unit')} hint={t('stock.unitHint')}>
          <Input value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} />
        </Field>
        <Field label={t('stock.waste.why')} className="col-span-2">
          <Select value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })}>
            {WASTE_REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`stock.waste.reason.${r}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('stock.note')} className="col-span-2">
          <Input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
