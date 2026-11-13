import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';
import { post, usePosMutation, type LiveItem, type OrderItem } from './api';

/** Choose the size and add-ons of an item. */
export function PickDialog({
  item,
  onClose,
  onPick,
}: {
  item: LiveItem;
  onClose: () => void;
  onPick: (variantKey: string, mods: { groupId: string; key: string }[]) => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(item.variants.find((x) => !x.out)?.key ?? '');
  const [mods, setMods] = useState<{ groupId: string; key: string }[]>([]);
  const ok = item.modifierGroups.every((g) => {
    const n = mods.filter((m) => m.groupId === g.id).length;
    return n >= g.min && n <= g.max;
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item.name}
      footer={
        <Button
          variant="primary"
          disabled={!ok || (item.variants.length > 0 && !v)}
          onClick={() => {
            onPick(v, mods);
            onClose();
          }}
        >
          {t('pos.addToOrder')}
        </Button>
      }
    >
      <div className="space-y-4">
        {item.variants.length > 0 && (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('pos.size')}>
            {item.variants.map((x) => (
              <button
                key={x.key}
                type="button"
                role="radio"
                aria-checked={v === x.key}
                disabled={x.out}
                onClick={() => setV(x.key)}
                className={cn(
                  'h-11 rounded-pill border px-4 text-sm font-medium',
                  v === x.key ? 'border-transparent bg-accent-soft text-accent-soft-foreground' : 'bg-card',
                  x.out && 'opacity-50',
                )}
              >
                {x.name} · {rupees(x.price)}
              </button>
            ))}
          </div>
        )}
        {item.modifierGroups.map((g) => (
          <fieldset key={g.id} className="space-y-1">
            <legend className="text-sm font-medium">{g.name}</legend>
            {g.options.map((o) => {
              const on = mods.some((m) => m.groupId === g.id && m.key === o.key);
              return (
                <label key={o.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={on}
                    onChange={(e) =>
                      setMods(
                        e.target.checked
                          ? [...mods, { groupId: g.id, key: o.key }]
                          : mods.filter((m) => !(m.groupId === g.id && m.key === o.key)),
                      )
                    }
                  />
                  {o.name}
                  {o.price > 0 && <span className="text-muted-foreground">+ {rupees(o.price)}</span>}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}

export function VoidDialog({
  orderId,
  item,
  onClose,
}: {
  orderId: string;
  item: OrderItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const fired = item.status !== 'HELD';
  const [reason, setReason] = useState('');
  const [cooked, setCooked] = useState(false);
  const go = usePosMutation(
    () =>
      post<{ pending: boolean }>(`/api/pos/orders/${orderId}/items/${item.id}/void`, {
        reason: reason || null,
        cooked,
      }),
    (r) => (r.pending ? t('pos.voidAsked') : t('pos.voided')),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pos.voidItem', { name: item.name })}
      footer={
        <Button
          variant="destructive"
          disabled={(fired && reason.trim().length < 3) || go.isPending}
          onClick={() => go.mutate(undefined, { onSuccess: onClose })}
        >
          {t('pos.void')}
        </Button>
      }
    >
      {fired ? (
        <div className="space-y-3">
          <Field label={t('pos.voidWhy')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cooked} onChange={(e) => setCooked(e.target.checked)} />
            {t('pos.cooked')}
          </label>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('pos.voidHeld')}</p>
      )}
    </Dialog>
  );
}
