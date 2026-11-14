import { PackageCheck, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, qty, rupees, toPaise, useGrns, useItems, useStock, useStockMutation } from './api';
import { ItemSelect, PlaceSelect } from './ui';

/** Goods receipts (phase 13): what really came, at what rate, in which batch, what was turned back at the gate. */
export function ReceiptsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useGrns();
  const [make, setMake] = useState(false);
  return (
    <div>
      <PageHeader
        title={t('stock.grn.title')}
        subtitle={t('stock.grn.subtitle')}
        actions={
          hasPermission(me.user.permissions, 'ims.create') && (
            <Button variant="primary" onClick={() => setMake(true)}>
              <Plus /> {t('stock.grn.new')}
            </Button>
          )
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={PackageCheck} title={t('stock.grn.emptyTitle')} body={t('stock.grn.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((g) => (
            <li key={g.id}>
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">{g.vendor ?? t('stock.grn.noVendor')}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{g.number}</span> ·{' '}
                      {formatLocalDate(g.createdAt.slice(0, 10))} · {g.location}
                      {g.po && ` · ${g.po}`}
                      {g.invoiceNo && ` · ${t('stock.grn.invoice', { no: g.invoiceNo })}`}
                    </div>
                  </div>
                  {g.billId && <StatusChip tone="ok">{t('stock.grn.billed')}</StatusChip>}
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {g.lines.map((l) => (
                    <li key={l.itemId} className="flex flex-wrap items-center gap-x-3">
                      <span className="min-w-0 flex-1 basis-40">{l.item}</span>
                      {l.qtyVariance !== null && l.qtyVariance !== 0 && (
                        <StatusChip tone="warn">
                          {l.qtyVariance < 0
                            ? t('stock.grn.short', { qty: qty(-l.qtyVariance) })
                            : t('stock.grn.excess', { qty: qty(l.qtyVariance) })}
                        </StatusChip>
                      )}
                      {l.rateVariance !== null && l.rateVariance !== 0 && (
                        <StatusChip tone="warn">
                          {t('stock.grn.rateDiff', { amount: rupees(l.rateVariance) })}
                        </StatusChip>
                      )}
                      {l.rejected > 0 && (
                        <StatusChip tone="bad">
                          {t('stock.grn.rejected', { qty: qty(l.rejected) })}
                        </StatusChip>
                      )}
                      <span className="tabular">
                        {qty(l.received)} {l.stockUnit} × {rupees(l.rate)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {make && <ReceiptDialog onClose={() => setMake(false)} />}
    </div>
  );
}

type Line = {
  itemId: string;
  qty: string;
  unit: string;
  rate: string;
  rejected: string;
  batch: string;
  expiry: string;
};
const blank: Line = { itemId: '', qty: '', unit: '', rate: '', rejected: '', batch: '', expiry: '' };
function ReceiptDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const stock = useStock();
  const places = stock.data?.places ?? [];
  const [d, setD] = useState({
    vendor: '',
    locationId: places[0]?.id ?? '',
    invoiceNo: '',
    raiseBill: false,
  });
  const [lines, setLines] = useState<Line[]>([blank]);
  const kept = lines.filter((l) => l.itemId && (Number(l.qty) > 0 || Number(l.rejected) > 0));
  const set = (i: number, patch: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = useStockMutation(
    () =>
      post<{ number: string }>('/api/ims/grn', {
        vendor: d.vendor || null,
        locationId: d.locationId,
        invoiceNo: d.invoiceNo || null,
        raiseBill: d.raiseBill,
        lines: kept.map((l) => ({
          itemId: l.itemId,
          qty: Number(l.qty) || 0,
          unit: l.unit || null,
          ...(l.rate ? { ratePaise: toPaise(l.rate) } : {}),
          rejected: Number(l.rejected) || 0,
          ...(l.batch
            ? { batch: { code: l.batch, expiry: l.expiry || null }, serials: [{ code: l.batch }] }
            : {}),
        })),
      }),
    (g) => t('stock.grn.saved', { number: g.number }),
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.grn.new')}
      footer={
        <Button
          variant="primary"
          disabled={!kept.length || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('stock.grn.receive')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('stock.grn.vendor')}>
          <Input value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })} />
        </Field>
        <Field label={t('stock.grn.into')}>
          <PlaceSelect
            label={t('stock.grn.into')}
            value={d.locationId}
            places={places}
            onChange={(locationId) => setD({ ...d, locationId })}
          />
        </Field>
        <Field label={t('stock.grn.invoiceNo')}>
          <Input value={d.invoiceNo} onChange={(e) => setD({ ...d, invoiceNo: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 space-y-3">
        {lines.map((l, i) => (
          <div key={i} className="rounded-control border p-2">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <ItemSelect
                  label={t('stock.item')}
                  value={l.itemId}
                  items={(items.data?.items ?? []).filter((x) => x.active)}
                  onChange={(itemId) => set(i, { itemId })}
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.remove')}
                onClick={() => setLines(lines.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <Input
                aria-label={t('stock.qty')}
                placeholder={t('stock.qty')}
                inputMode="decimal"
                value={l.qty}
                onChange={(e) => set(i, { qty: e.target.value })}
              />
              <Input
                aria-label={t('stock.unit')}
                placeholder={t('stock.unit')}
                value={l.unit}
                onChange={(e) => set(i, { unit: e.target.value })}
              />
              <Input
                aria-label={t('stock.rate')}
                placeholder={t('stock.rate')}
                inputMode="decimal"
                value={l.rate}
                onChange={(e) => set(i, { rate: e.target.value })}
              />
              <Input
                aria-label={t('stock.grn.rejectedQty')}
                placeholder={t('stock.grn.rejectedQty')}
                inputMode="decimal"
                value={l.rejected}
                onChange={(e) => set(i, { rejected: e.target.value })}
              />
              <Input
                aria-label={t('stock.batch')}
                placeholder={t('stock.batch')}
                className="font-mono"
                value={l.batch}
                onChange={(e) => set(i, { batch: e.target.value })}
              />
              <DateInput
                value={l.expiry}
                onChange={(expiry) => set(i, { expiry })}
                aria-label={t('stock.expiry')}
              />
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => setLines([...lines, blank])}>
          <Plus /> {t('stock.addLine')}
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={d.raiseBill} onChange={(e) => setD({ ...d, raiseBill: e.target.checked })} />
          {t('stock.grn.raiseBill')}
        </label>
      </div>
    </Dialog>
  );
}
