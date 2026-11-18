import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TimeWindow } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { hhmm, send, toMin, useHospMutation, useOutlets, type MenuItem, type MenuSetup } from './api';

type Win = { from: string; to: string; days: number[] };
const winOf = (w: TimeWindow | null | undefined): Win =>
  w ? { from: hhmm(w.fromMin), to: hhmm(w.toMin), days: w.days ?? [] } : { from: '', to: '', days: [] };
const toWindow = (w: Win): TimeWindow | null =>
  w.from && w.to ? { fromMin: toMin(w.from), toMin: toMin(w.to), days: w.days } : null;

/** From – to on some weekdays (none picked = every day). */
function WindowFields({ value, onChange }: { value: Win; onChange: (w: Win) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TimeInput
        aria-label={t('hosp.extras.from')}
        className="w-24"
        value={value.from}
        onChange={(from) => onChange({ ...value, from })}
      />
      <span className="text-sm text-muted-foreground">–</span>
      <TimeInput
        aria-label={t('hosp.extras.to')}
        className="w-24"
        value={value.to}
        onChange={(to) => onChange({ ...value, to })}
      />
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() =>
                onChange({
                  ...value,
                  days: on ? value.days.filter((x) => x !== d) : [...value.days, d].sort(),
                })
              }
              className={cn(
                'h-8 min-w-10 rounded-pill border px-2 text-xs font-medium',
                on
                  ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                  : 'bg-card text-muted-foreground',
              )}
            >
              {t(`org.day.${d}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * What an item has beyond its card: the hours it can be ordered, prices that differ at an outlet or in a time
 * band (happy hour), and — for a combo — the items sold together at its price.
 */
export function ItemExtrasDialog({
  item,
  setup,
  onClose,
}: {
  item: MenuItem;
  setup: MenuSetup;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [hours, setHours] = useState<Win[]>(item.windows.map(winOf));
  const [prices, setPrices] = useState(
    item.prices.map((p) => ({
      label: p.label ?? '',
      outletId: p.outletId ?? '',
      variantKey: p.variantKey,
      price: String(p.price / 100),
      win: winOf(p.window),
    })),
  );
  const [combo, setCombo] = useState(
    item.combo.map((c) => ({ menuItemId: c.menuItemId, qty: String(c.qty) })),
  );
  const others = setup.items.filter((i) => i.id !== item.id && !i.combo.length && !i.variants.length);
  const save = useHospMutation(async () => {
    const { id, off: _off, offReason: _reason, prices: _prices, ...rest } = item;
    await send('PUT', `/api/hosp/menu/items/${id}`, {
      ...rest,
      windows: hours.map(toWindow).filter((w): w is TimeWindow => w !== null),
      combo: combo
        .filter((c) => c.menuItemId)
        .map((c) => ({ menuItemId: c.menuItemId, qty: Number(c.qty) || 1 })),
    });
    await send('PUT', `/api/hosp/menu/items/${id}/prices`, {
      prices: prices
        .filter((p) => p.price !== '')
        .map((p) => ({
          variantKey: p.variantKey,
          outletId: p.outletId || null,
          label: p.label || null,
          window: toWindow(p.win),
          price: Math.round(Number(p.price) * 100),
        })),
    });
  }, t('org.saved'));
  const head = (title: string, hint: string) => (
    <div>
      <div className="text-sm font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  const remove = (onClick: () => void) => (
    <Button variant="ghost" size="icon-sm" aria-label={t('common.remove')} onClick={onClick}>
      <Trash2 />
    </Button>
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('hosp.extras.title', { name: item.name })}
      footer={
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-6">
        <section className="space-y-2">
          {head(t('hosp.extras.hours'), t('hosp.extras.hoursHint'))}
          {hours.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <WindowFields value={w} onChange={(n) => setHours(hours.map((x, j) => (j === i ? n : x)))} />
              </div>
              {remove(() => setHours(hours.filter((_, j) => j !== i)))}
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setHours([...hours, winOf(null)])}>
            <Plus /> {t('hosp.extras.addHours')}
          </Button>
        </section>

        <section className="space-y-2">
          {head(t('hosp.extras.prices'), t('hosp.extras.pricesHint'))}
          {prices.map((p, i) => {
            const set = (patch: Partial<(typeof prices)[number]>) =>
              setPrices(prices.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={i} className="space-y-2 rounded-control border p-3">
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-center gap-2">
                  <Input
                    aria-label={t('hosp.extras.label')}
                    placeholder={t('hosp.extras.label')}
                    value={p.label}
                    onChange={(e) => set({ label: e.target.value })}
                  />
                  <Input
                    aria-label={t('hosp.menu.price')}
                    placeholder={t('hosp.menu.price')}
                    inputMode="decimal"
                    value={p.price}
                    onChange={(e) => set({ price: e.target.value })}
                  />
                  {remove(() => setPrices(prices.filter((_, j) => j !== i)))}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Select
                    aria-label={t('hosp.extras.outlet')}
                    value={p.outletId}
                    onChange={(e) => set({ outletId: e.target.value })}
                  >
                    <option value="">{t('hosp.extras.everyOutlet')}</option>
                    {(outlets.data ?? []).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                  {item.variants.length > 0 && (
                    <Select
                      aria-label={t('hosp.extras.variant')}
                      value={p.variantKey}
                      onChange={(e) => set({ variantKey: e.target.value })}
                    >
                      <option value="">{t('hosp.extras.noVariant')}</option>
                      {item.variants.map((v) => (
                        <option key={v.key} value={v.key}>
                          {v.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
                <WindowFields value={p.win} onChange={(win) => set({ win })} />
              </div>
            );
          })}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPrices([...prices, { label: '', outletId: '', variantKey: '', price: '', win: winOf(null) }])
            }
          >
            <Plus /> {t('hosp.extras.addPrice')}
          </Button>
        </section>

        {item.variants.length === 0 && (
          <section className="space-y-2">
            {head(t('hosp.extras.combo'), t('hosp.extras.comboHint'))}
            {combo.map((c, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_72px_auto] gap-2">
                <Select
                  aria-label={t('hosp.extras.comboItem')}
                  value={c.menuItemId}
                  onChange={(e) =>
                    setCombo(combo.map((x, j) => (j === i ? { ...x, menuItemId: e.target.value } : x)))
                  }
                >
                  <option value="">{t('hosp.extras.comboItem')}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={t('hosp.extras.qty')}
                  inputMode="decimal"
                  value={c.qty}
                  onChange={(e) =>
                    setCombo(combo.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                  }
                />
                {remove(() => setCombo(combo.filter((_, j) => j !== i)))}
              </div>
            ))}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setCombo([...combo, { menuItemId: '', qty: '1' }])}
            >
              <Plus /> {t('hosp.extras.addCombo')}
            </Button>
          </section>
        )}
      </div>
    </Dialog>
  );
}
