import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DIETS } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useItems } from '@/modules/stock/api';
import { ItemSelect } from '@/modules/stock/ui';
import { send, useHospMutation, type MenuItem, type MenuSetup } from './api';

const keyOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'v';

/** One menu item: its category, price, marks, the stock dish it uses, its variants and add-on groups. */
export function MenuItemDialog({
  item,
  setup,
  onClose,
}: {
  item: Partial<MenuItem>;
  setup: MenuSetup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const stock = useItems();
  const [d, setD] = useState({
    categoryId: item.categoryId ?? setup.categories[0]?.id ?? '',
    name: item.name ?? '',
    nameHi: item.nameHi ?? '',
    itemId: item.itemId ?? '',
    diet: item.diet ?? 'VEG',
    spice: String(item.spice ?? 0),
    allergens: (item.allergens ?? []).join(', '),
    hsn: item.hsn ?? '',
    taxCode: item.taxCode ?? '',
    price: item.price === undefined ? '' : String(item.price / 100),
    groups: item.modifierGroupIds ?? [],
  });
  const [variants, setVariants] = useState(
    (item.variants ?? []).map((v) => ({
      key: v.key,
      name: v.name,
      price: String(v.price / 100),
      factor: String(v.factor ?? 1),
    })),
  );
  const kept = variants.filter((v) => v.name.trim());
  const body = {
    categoryId: d.categoryId,
    name: d.name,
    nameHi: d.nameHi || null,
    itemId: d.itemId || null,
    diet: d.diet,
    spice: Number(d.spice) || 0,
    allergens: d.allergens
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    hsn: d.hsn || null,
    taxCode: d.taxCode || null,
    price: Math.round(Number(d.price || kept[0]?.price || 0) * 100),
    variants: kept.map((v) => ({
      key: v.key || keyOf(v.name),
      name: v.name,
      price: Math.round(Number(v.price || 0) * 100),
      factor: Number(v.factor) || 1,
    })),
    modifierGroupIds: d.groups,
    combo: item.combo ?? [],
    windows: item.windows ?? [],
    outletIds: item.outletIds ?? [],
    active: item.active ?? true,
  };
  const save = useHospMutation(
    () =>
      item.id
        ? send('PUT', `/api/hosp/menu/items/${item.id}`, body)
        : send('POST', '/api/hosp/menu/items', body),
    t('org.saved'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/menu/items/${item.id}`), t('org.deleted'));
  const set = (i: number, patch: Partial<(typeof variants)[number]>) =>
    setVariants(variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const text = (
    k: 'name' | 'nameHi' | 'price' | 'allergens' | 'hsn' | 'taxCode',
    label: string,
    more: { num?: boolean; hint?: string; mono?: boolean } = {},
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
      title={item.id ? item.name : t('hosp.menu.item')}
      footer={
        <>
          {item.id && (
            <Button
              variant="ghost"
              disabled={drop.isPending}
              onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
            >
              {t('org.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!d.name.trim() || !d.categoryId || (d.price === '' && !kept.length) || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {text('name', t('org.name'))}
        {text('nameHi', t('hosp.menu.nameHi'))}
        <Field label={t('hosp.menu.categoryOf')}>
          <Select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>
            {setup.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {text('price', t('hosp.menu.price'), { num: true })}
        <Field label={t('hosp.menu.dietOf')}>
          <Select value={d.diet} onChange={(e) => setD({ ...d, diet: e.target.value as typeof d.diet })}>
            {DIETS.map((k) => (
              <option key={k} value={k}>
                {t(`hosp.menu.diet.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.menu.spice')}>
          <Select value={d.spice} onChange={(e) => setD({ ...d, spice: e.target.value })}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={String(n)}>
                {t(`hosp.menu.spices.${n}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.menu.stockItem')} hint={t('hosp.menu.stockItemHint')} className="sm:col-span-2">
          <ItemSelect
            label={t('hosp.menu.stockItem')}
            value={d.itemId}
            items={stock.data?.items ?? []}
            onChange={(itemId) => setD({ ...d, itemId })}
          />
        </Field>
        {text('allergens', t('hosp.menu.allergens'), { hint: t('hosp.menu.allergensHint') })}
        {text('taxCode', t('hosp.menu.taxCode'), { mono: true, hint: t('hosp.menu.taxCodeHint') })}
        {text('hsn', t('hosp.menu.hsn'), { mono: true })}
      </div>
      <div className="mt-5 space-y-2">
        <div className="text-sm font-medium">{t('hosp.menu.variants')}</div>
        {variants.map((v, i) => (
          <div key={i} className="grid grid-cols-[1fr_100px_80px_auto] gap-2">
            <Input
              aria-label={t('hosp.menu.variantName')}
              placeholder={t('hosp.menu.variantName')}
              value={v.name}
              onChange={(e) => set(i, { name: e.target.value })}
            />
            <Input
              aria-label={t('hosp.menu.variantPrice')}
              placeholder={t('hosp.menu.price')}
              inputMode="decimal"
              value={v.price}
              onChange={(e) => set(i, { price: e.target.value })}
            />
            <Input
              aria-label={t('hosp.menu.factor')}
              placeholder={t('hosp.menu.factor')}
              inputMode="decimal"
              value={v.factor}
              onChange={(e) => set(i, { factor: e.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.remove')}
              onClick={() => setVariants(variants.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setVariants([...variants, { key: '', name: '', price: '', factor: '1' }])}
        >
          <Plus /> {t('hosp.menu.addVariant')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('hosp.menu.factorHint')}</p>
      </div>
      {setup.groups.length > 0 && (
        <div className="mt-5 space-y-2">
          <div className="text-sm font-medium">{t('hosp.menu.groups')}</div>
          {setup.groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={d.groups.includes(g.id)}
                onChange={(e) =>
                  setD({
                    ...d,
                    groups: e.target.checked ? [...d.groups, g.id] : d.groups.filter((x) => x !== g.id),
                  })
                }
              />
              {g.name}{' '}
              <span className="text-muted-foreground">· {g.options.map((o) => o.name).join(', ')}</span>
            </label>
          ))}
        </div>
      )}
    </Dialog>
  );
}
