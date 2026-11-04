import { CalendarClock, Loader2, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatINR, formatLocalDate } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { imsApi, qty, useImsMutation, useOws } from './api';
import { BandChip } from './ui';

/**
 * OWS — order when short (§10.1): on the order day, every short item with order qty = MAX − (stock + on order).
 * Untick what you don't want, change a quantity, and make the orders (one draft per vendor).
 */
export function OwsTab({ canOrder, onOrdered }: { canOrder: boolean; onOrdered: () => void }) {
  const { t } = useTranslation();
  const q = useOws();
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const order = useImsMutation(
    (lines: { itemId: string; qty: number }[]) => imsApi.orderOws(lines),
    (r) => t('ims.o.made', { count: r.orders.length, numbers: r.orders.map((o) => o.number).join(', ') }),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  const qtyOf = (id: string, dflt: number) => {
    const v = edits[id];
    return v === undefined ? dflt : Number(v.replace(/,/g, ''));
  };
  const chosen = d.lines.filter((l) => !skip.has(l.item.id));
  const bad = chosen.some((l) => !(qtyOf(l.item.id, l.qty) > 0));
  const value = chosen.reduce((s, l) => s + qtyOf(l.item.id, l.qty) * Number(l.ratePaise), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KpiTile
          label={t('ims.o.orderDay')}
          value={formatLocalDate(d.orderDay)}
          hero
          note={d.open ? t('ims.o.openNow') : t('ims.o.opensOn', { date: formatLocalDate(d.opensOn) })}
        />
        <KpiTile
          label={t('ims.o.short')}
          value={d.lines.length}
          tone={d.lines.some((l) => l.band === 'red') ? 'bad' : undefined}
        />
        <KpiTile label={t('ims.o.value')} value={formatINR(Math.round(value), { compact: true })} />
      </div>
      {!d.open && d.lines.length > 0 && (
        <p className="flex items-center gap-2 rounded-control border bg-muted/40 px-3 py-2 text-sm">
          <CalendarClock className="size-4" /> {t('ims.o.notYet', { date: formatLocalDate(d.orderDay) })}
        </p>
      )}
      {!d.lines.length ? (
        <EmptyState icon={ShoppingCart} title={t('ims.o.nothing')} body={t('ims.o.nothingBody')} />
      ) : (
        <>
          <ul className="divide-y rounded-card border bg-card">
            {d.lines.map((l) => (
              <li
                key={l.item.id}
                className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-4 py-3 text-sm sm:grid-cols-[auto_1fr_auto]"
              >
                <Checkbox
                  aria-label={l.item.name}
                  checked={!skip.has(l.item.id)}
                  onChange={(e) => {
                    const s = new Set(skip);
                    if (e.target.checked) s.delete(l.item.id);
                    else s.add(l.item.id);
                    setSkip(s);
                  }}
                />
                <div className="min-w-0">
                  <div className="font-medium">
                    {l.item.name}{' '}
                    <span className="font-mono text-xs text-muted-foreground">{l.item.code}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('ims.o.line', {
                      stock: qty(l.stock),
                      onOrder: qty(l.onOrder),
                      max: qty(l.maxQty ?? 0),
                      unit: l.item.unit,
                      vendor: l.item.vendor ?? t('ims.o.noVendor'),
                    })}
                  </div>
                </div>
                <div className="col-start-2 flex items-center gap-2 sm:col-start-auto">
                  <BandChip band={l.band} />
                  <Input
                    aria-label={t('ims.o.qty', { name: l.item.name })}
                    inputMode="decimal"
                    value={edits[l.item.id] ?? String(l.qty)}
                    onChange={(e) => setEdits({ ...edits, [l.item.id]: e.target.value })}
                    className="w-24 text-right tabular-nums"
                  />
                  <span className="w-8 text-xs text-muted-foreground">{l.item.unit}</span>
                </div>
              </li>
            ))}
          </ul>
          {canOrder && (
            <div className="flex justify-end">
              <Button
                disabled={!chosen.length || bad || order.isPending}
                onClick={() =>
                  order.mutate(
                    chosen.map((l) => ({ itemId: l.item.id, qty: qtyOf(l.item.id, l.qty) })),
                    { onSuccess: () => (setSkip(new Set()), setEdits({}), onOrdered()) },
                  )
                }
              >
                {order.isPending ? <Loader2 className="animate-spin" /> : <ShoppingCart />}{' '}
                {t('ims.o.make', { count: chosen.length })}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
