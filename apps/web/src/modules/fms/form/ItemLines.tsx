import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InputProps } from './ctx';

type Line = { item: string; qty: string; rate: string; itemId?: string; unit?: string };

/** Item lines: item, quantity, rate; the amount is worked out. */
export function ItemLines({ field, value, ctx }: InputProps) {
  const { t } = useTranslation();
  const onChange = (v: Line[]) => ctx.set(field.key, v);
  const given = Array.isArray(value) ? (value as Line[]) : [];
  const lines = given.length ? given : [{ item: '', qty: '', rate: '' }];
  const set = (i: number, patch: Partial<Line>) =>
    onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const amount = (l: Line) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const total = lines.reduce((a, l) => a + amount(l), 0);
  return (
    <div className="space-y-2">
      {lines.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_70px_90px_auto] items-center gap-1.5 sm:grid-cols-[1fr_90px_110px_110px_auto]"
        >
          <Input
            aria-label={t('fms.item')}
            placeholder={t('fms.item')}
            value={l.item}
            onChange={(e) => set(i, { item: e.target.value })}
          />
          <Input
            aria-label={t('fms.qty')}
            placeholder={t('fms.qty')}
            inputMode="decimal"
            value={l.qty}
            onChange={(e) => set(i, { qty: e.target.value })}
          />
          <Input
            aria-label={t('fms.rate')}
            placeholder={t('fms.rate')}
            inputMode="decimal"
            value={l.rate}
            onChange={(e) => set(i, { rate: e.target.value })}
          />
          <span className="tabular hidden text-right text-sm sm:block">
            ₹{amount(l).toLocaleString('en-IN')}
          </span>
          <Button
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange([...lines, { item: '', qty: '', rate: '' }])}
        >
          <Plus /> {t('fms.addLine')}
        </Button>
        <span className="tabular text-sm font-semibold">
          {t('fms.total')}: ₹{total.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  );
}
