import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MADE, TRACKING } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { put, toPaise, useItems, useStockMutation } from './api';
import { ItemSelect } from './ui';

type Extras = {
  tracking: string;
  made: string;
  units: { unit: string; factor: number; serve?: boolean }[];
  secondUnit: string | null;
  pricedBy: string;
  barcode: string | null;
  brand: string | null;
  taxCode: string | null;
  sellPrice: number | null;
  rateKey: string | null;
  rateFactor: number | null;
  shelfLifeDays: number | null;
};

/** How an item is kept: tracked by quantity, batch, piece or lot; bought, made or a dish; its other units, barcode and price. */
export function ItemKeepDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const [itemId, setItemId] = useState('');
  const [d, setD] = useState({
    tracking: 'QTY',
    made: 'BUY',
    units: '',
    secondUnit: '',
    pricedBy: 'unit',
    barcode: '',
    brand: '',
    taxCode: '',
    sellPrice: '',
    rateKey: '',
    rateFactor: '',
    shelfLifeDays: '',
  });
  const item = items.data?.items.find((i) => i.id === itemId);
  useEffect(() => {
    if (!item) return;
    let stale = false;
    void api<{ item: Extras }>(`/api/ims/scan?code=${encodeURIComponent(item.code)}`).then(({ item: x }) => {
      if (stale) return;
      setD({
        tracking: x.tracking,
        made: x.made,
        // "bottle=750, case=9000, peg=30*" — a star marks a serving.
        units: x.units.map((u) => `${u.unit}=${u.factor}${u.serve ? '*' : ''}`).join(', '),
        secondUnit: x.secondUnit ?? '',
        pricedBy: x.pricedBy,
        barcode: x.barcode ?? '',
        brand: x.brand ?? '',
        taxCode: x.taxCode ?? '',
        sellPrice: x.sellPrice === null ? '' : String(x.sellPrice / 100),
        rateKey: x.rateKey ?? '',
        rateFactor: x.rateFactor === null ? '' : String(x.rateFactor),
        shelfLifeDays: x.shelfLifeDays === null ? '' : String(x.shelfLifeDays),
      });
    });
    return () => {
      stale = true;
    };
  }, [item]);
  const units = d.units
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [unit, f] = s.split('=');
      return {
        unit: (unit ?? '').trim(),
        factor: Number((f ?? '').replace('*', '')),
        ...(s.endsWith('*') ? { serve: true } : {}),
      };
    });
  const unitsOk = units.every((u) => u.unit && u.factor > 0);
  const save = useStockMutation(
    () =>
      put(`/api/ims/items/${itemId}/extras`, {
        tracking: d.tracking,
        made: d.made,
        units,
        secondUnit: d.secondUnit || null,
        pricedBy: d.pricedBy,
        barcode: d.barcode || null,
        brand: d.brand || null,
        taxCode: d.taxCode || null,
        sellPrice: d.sellPrice === '' ? null : toPaise(d.sellPrice),
        rateKey: d.rateKey || null,
        rateFactor: d.rateFactor === '' ? null : Number(d.rateFactor),
        shelfLifeDays: d.shelfLifeDays === '' ? null : Number(d.shelfLifeDays),
      }),
    t('org.saved'),
  );
  const text = (
    k: keyof typeof d,
    label: string,
    more: { hint?: string; mono?: boolean; num?: boolean } = {},
  ) => (
    <Field label={label} hint={more.hint}>
      <Input
        value={d[k]}
        inputMode={more.num ? 'decimal' : undefined}
        className={more.mono ? 'font-mono' : undefined}
        onChange={(e) => setD({ ...d, [k]: e.target.value })}
      />
    </Field>
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.keep.title')}
      description={t('stock.keep.subtitle')}
      footer={
        <Button
          variant="primary"
          disabled={!itemId || !unitsOk || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('stock.item')} className="sm:col-span-2">
          <ItemSelect
            label={t('stock.item')}
            value={itemId}
            items={items.data?.items ?? []}
            onChange={setItemId}
          />
        </Field>
        <Field label={t('stock.keep.tracking')} hint={t('stock.keep.trackingHint')}>
          <Select value={d.tracking} onChange={(e) => setD({ ...d, tracking: e.target.value })}>
            {TRACKING.map((k) => (
              <option key={k} value={k}>
                {t(`stock.keep.track.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('stock.keep.made')}>
          <Select value={d.made} onChange={(e) => setD({ ...d, made: e.target.value })}>
            {MADE.map((k) => (
              <option key={k} value={k}>
                {t(`stock.keep.makes.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          {text('units', t('stock.keep.units', { unit: item?.unit ?? '' }), {
            hint: t('stock.keep.unitsHint'),
            mono: true,
          })}
        </div>
        {text('secondUnit', t('stock.keep.secondUnit'), { hint: t('stock.keep.secondUnitHint') })}
        <Field label={t('stock.keep.pricedBy')}>
          <Select value={d.pricedBy} onChange={(e) => setD({ ...d, pricedBy: e.target.value })}>
            <option value="unit">{t('stock.keep.byUnit')}</option>
            <option value="second">{t('stock.keep.bySecond')}</option>
          </Select>
        </Field>
        {text('barcode', t('stock.keep.barcode'), { mono: true })}
        {text('brand', t('stock.keep.brand'))}
        {text('sellPrice', t('stock.keep.sellPrice'), { num: true })}
        {text('taxCode', t('stock.keep.taxCode'), { mono: true, hint: t('stock.keep.taxCodeHint') })}
        {text('rateKey', t('stock.keep.rateKey'), { mono: true, hint: t('stock.keep.rateKeyHint') })}
        {text('rateFactor', t('stock.keep.rateFactor'), { num: true })}
        {text('shelfLifeDays', t('stock.keep.shelfLife'), { num: true })}
      </div>
    </Dialog>
  );
}
