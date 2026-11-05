import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/ui/date-input';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { inr, toPaise } from './api';
import type { OrderDraft } from './order';
import { MoneyInput } from './setup/shell';

/** Amount (or item lines that add up to it), GP if known, the promised date and a note. */
export function OrderForm({ value: o, onChange }: { value: OrderDraft; onChange: (o: OrderDraft) => void }) {
  const { t } = useTranslation();
  const put = (i: number, x: Partial<OrderDraft['items'][number]>) =>
    onChange({ ...o, items: o.items.map((l, k) => (k === i ? { ...l, ...x } : l)) });
  const total = o.items.reduce((a, l) => a + Math.round(Number(l.qty) * (toPaise(l.rate) ?? 0)) || 0, 0);
  return (
    <div className="space-y-3">
      {o.items.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_72px_96px_auto] items-center gap-1.5">
          <Input
            aria-label={t('fms.item')}
            placeholder={t('fms.item')}
            value={l.item}
            onChange={(e) => put(i, { item: e.target.value })}
          />
          <Input
            aria-label={t('fms.qty')}
            placeholder={t('fms.qty')}
            inputMode="decimal"
            value={l.qty}
            onChange={(e) => put(i, { qty: e.target.value })}
          />
          <Input
            aria-label={t('fms.rate')}
            placeholder={t('fms.rate')}
            inputMode="decimal"
            value={l.rate}
            onChange={(e) => put(i, { rate: e.target.value })}
          />
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('common.remove')}
            onClick={() => onChange({ ...o, items: o.items.filter((_, k) => k !== i) })}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onChange({ ...o, items: [...o.items, { item: '', qty: '', rate: '' }] })}
      >
        <Plus /> {t('crm.o.addLine')}
      </Button>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={t('crm.o.amount')}
          hint={total ? t('crm.o.fromLines', { total: inr(total) }) : t('crm.o.beforeGst')}
        >
          <MoneyInput
            label={t('crm.o.amount')}
            value={o.amount}
            onChange={(amount) => onChange({ ...o, amount })}
          />
        </Field>
        <Field label={t('crm.o.gp')} hint={t('crm.o.gpHint')}>
          <MoneyInput label={t('crm.o.gp')} value={o.gp} onChange={(gp) => onChange({ ...o, gp })} />
        </Field>
        <Field label={t('crm.o.promised')}>
          <DateInput
            value={o.promisedOn}
            onChange={(promisedOn) => onChange({ ...o, promisedOn })}
            aria-label={t('crm.o.promised')}
          />
        </Field>
      </div>
      <Field label={t('crm.o.note')}>
        <Textarea rows={2} value={o.note} onChange={(e) => onChange({ ...o, note: e.target.value })} />
      </Field>
    </div>
  );
}
