import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, toPaise, useItems, useStockMutation, type Place } from './api';
import { ItemSelect, PlaceSelect } from './ui';

const TYPES = ['IN', 'OUT', 'TRANSFER'] as const;

/** One stock entry at a location: in (with its batch or piece), out (by item or a scanned code), or a transfer inside the branch. */
export function EntryDialog({
  places,
  locationId,
  onClose,
}: {
  places: Place[];
  locationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const items = useItems();
  const [d, setD] = useState({
    type: 'IN' as (typeof TYPES)[number],
    itemId: '',
    barcode: '',
    qty: '',
    unit: '',
    locationId,
    toLocationId: '',
    batch: '',
    expiry: '',
    weight: '',
    rate: '',
    note: '',
  });
  const set = (patch: Partial<typeof d>) => setD({ ...d, ...patch });
  const save = useStockMutation(
    () =>
      post('/api/ims/stock/entry', {
        type: d.type,
        ...(d.barcode ? { barcode: d.barcode } : { itemId: d.itemId }),
        qty: Number(d.qty) || 1,
        unit: d.unit || null,
        locationId: d.locationId,
        ...(d.type === 'TRANSFER' ? { toLocationId: d.toLocationId === '~main' ? '' : d.toLocationId } : {}),
        ...(d.type === 'IN' && d.batch
          ? {
              batch: { code: d.batch, expiry: d.expiry || null },
              serials: [{ code: d.batch, qty2: Number(d.weight) || null }],
            }
          : {}),
        ...(d.type === 'IN' && d.weight ? { qty2: Number(d.weight) } : {}),
        ...(d.type === 'IN' && d.rate ? { ratePaise: toPaise(d.rate) } : {}),
        note: d.note || null,
      }),
    t('stock.entry.saved'),
  );
  const ready =
    (d.itemId || d.barcode) &&
    (Number(d.qty) > 0 || d.barcode) &&
    (d.type !== 'TRANSFER' || d.toLocationId !== '');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.entry.title')}
      footer={
        <Button
          variant="primary"
          disabled={!ready || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('stock.entry.type')}>
          <Select value={d.type} onChange={(e) => set({ type: e.target.value as typeof d.type })}>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`stock.entry.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={d.type === 'TRANSFER' ? t('stock.from') : t('stock.location')}>
          <PlaceSelect
            label={t('stock.location')}
            value={d.locationId}
            places={places}
            onChange={(id) => set({ locationId: id })}
          />
        </Field>
        {d.type === 'TRANSFER' && (
          <Field label={t('stock.to')} className="col-span-2">
            <Select value={d.toLocationId} onChange={(e) => set({ toLocationId: e.target.value })}>
              <option value="">{t('org.choose')}</option>
              {places
                .filter((p) => p.id !== d.locationId && p.id !== '~transit')
                .map((p) => (
                  <option key={p.id || '~main'} value={p.id || '~main'}>
                    {p.id === '' ? t('stock.mainStore') : p.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label={t('stock.item')} className="col-span-2">
          <ItemSelect
            label={t('stock.item')}
            value={d.itemId}
            items={(items.data?.items ?? []).filter((i) => i.active)}
            onChange={(itemId) => set({ itemId, barcode: '' })}
          />
        </Field>
        <Field label={t('stock.entry.scan')} hint={t('stock.entry.scanHint')} className="col-span-2">
          <Input
            value={d.barcode}
            className="font-mono"
            onChange={(e) => set({ barcode: e.target.value.trim(), itemId: '' })}
          />
        </Field>
        <Field label={t('stock.qty')}>
          <Input inputMode="decimal" value={d.qty} onChange={(e) => set({ qty: e.target.value })} />
        </Field>
        <Field label={t('stock.unit')} hint={t('stock.unitHint')}>
          <Input value={d.unit} onChange={(e) => set({ unit: e.target.value })} />
        </Field>
        {d.type === 'IN' && (
          <>
            <Field label={t('stock.batch')} hint={t('stock.batchHint')}>
              <Input value={d.batch} className="font-mono" onChange={(e) => set({ batch: e.target.value })} />
            </Field>
            <Field label={t('stock.expiry')}>
              <DateInput
                value={d.expiry}
                onChange={(expiry) => set({ expiry })}
                aria-label={t('stock.expiry')}
              />
            </Field>
            <Field label={t('stock.rate')}>
              <Input inputMode="decimal" value={d.rate} onChange={(e) => set({ rate: e.target.value })} />
            </Field>
            <Field label={t('stock.weight')} hint={t('stock.weightHint')}>
              <Input inputMode="decimal" value={d.weight} onChange={(e) => set({ weight: e.target.value })} />
            </Field>
          </>
        )}
        <Field label={t('stock.note')} className="col-span-2">
          <Input value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}
