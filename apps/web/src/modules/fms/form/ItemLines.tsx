import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InputProps } from './ctx';
import { ItemPicker, type ItemOption } from './ItemPicker';

type Line = { item: string; qty: string; rate: string; itemId?: string; unit?: string };
const EMPTY: Line = { item: '', qty: '', rate: '' };

/**
 * Item lines (L14): each line picks an item of the item master by code or name — its unit and rate fill in (the
 * rate can be changed), live stock shows, and the line keeps the item's id and unit. Typing an item that is not
 * in the master is offered only where the field allows it (`freeItems`; fields from before phase 11 have no
 * setting and still allow it). The public form has no item list: it types, as before.
 */
export function ItemLines({ field, value, ctx }: InputProps) {
  const { t } = useTranslation();
  // Live stock of the items picked in this form, by item id.
  const [stock, setStock] = useState<Record<string, number>>({});
  const free = field.freeItems !== false;
  const onChange = (v: Line[]) => ctx.set(field.key, v);
  const given = Array.isArray(value) ? (value as Line[]) : [];
  const lines = given.length ? given : [EMPTY];
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amount = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const total = lines.reduce((a, l) => a + amount(l), 0);
  const pick = (i: number, o: ItemOption) => {
    setStock((s) => ({ ...s, [o.id]: o.stock }));
    // The master's rate fills in; a rate already typed for this line stays.
    set(i, {
      item: o.name,
      itemId: o.id,
      unit: o.unit,
      rate: lines[i]!.rate || (o.rate ? String(o.rate) : ''),
    });
  };
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-1.5 rounded-control border p-2 sm:grid-cols-[minmax(0,1fr)_100px_110px_100px_auto] sm:border-0 sm:p-0"
        >
          <div className="order-1 col-span-2 min-w-0 sm:col-span-1">
            {ctx.publicForm ? (
              <Input
                aria-label={t('fms.item')}
                placeholder={t('fms.item')}
                value={l.item}
                onChange={(e) => set(i, { item: e.target.value })}
              />
            ) : (
              <ItemPicker
                label={t('fms.item')}
                value={l.item}
                picked={Boolean(l.itemId)}
                free={free}
                onPick={(o) => pick(i, o)}
                onTyped={(item) => set(i, { item, itemId: undefined, unit: undefined })}
              />
            )}
            {l.itemId && stock[l.itemId] !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {t('stockSteps.line.inStock', {
                  n: stock[l.itemId]!.toLocaleString('en-IN'),
                  unit: l.unit ?? '',
                })}
              </p>
            )}
            {!ctx.publicForm && !l.itemId && l.item && (
              <p className="mt-0.5 text-xs text-muted-foreground">{t('stockSteps.line.typed')}</p>
            )}
          </div>
          <Input
            className="order-3 sm:order-2"
            aria-label={t('fms.qty')}
            placeholder={l.unit ? t('stockSteps.line.qtyIn', { unit: l.unit }) : t('fms.qty')}
            inputMode="decimal"
            value={l.qty}
            onChange={(e) => set(i, { qty: e.target.value })}
          />
          <Input
            className="order-4 sm:order-3"
            aria-label={t('fms.rate')}
            placeholder={t('fms.rate')}
            inputMode="decimal"
            value={l.rate}
            onChange={(e) => set(i, { rate: e.target.value })}
          />
          <span className="tabular order-5 self-center text-right text-sm sm:order-4">
            ₹{amount(l).toLocaleString('en-IN')}
          </span>
          <Button
            className="order-2 sm:order-5"
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.remove')}
            onClick={() => onChange(lines.filter((_, j) => j !== i))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...lines, EMPTY])}>
          <Plus /> {t('fms.addLine')}
        </Button>
        <span className="tabular text-sm font-semibold">
          {t('fms.total')}: ₹{total.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
}
