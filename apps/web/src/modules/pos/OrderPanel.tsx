import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { COURSES } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';
import { post, useLiveMenu, useOrder, usePosMutation, type LiveItem, type OrderItem } from './api';
import { BillDialog } from './BillDialog';
import { PickDialog, VoidDialog } from './OrderDialogs';
import { enqueue, loadQueue, newKey, saveQueue } from './queue';

type Line = {
  key: string;
  item: LiveItem;
  variantKey: string;
  qty: number;
  note: string;
  course: string;
  hold: boolean;
  mods: { groupId: string; key: string }[];
};
const TONE = { HELD: 'neutral', FIRED: 'warn', READY: 'info', SERVED: 'ok', VOID: 'bad' } as const;

/** One order: pick from the menu into the cart, send it to the kitchen, see what is fired and ready, void, bill. */
export function OrderPanel({
  orderId,
  outletId,
  onClose,
}: {
  orderId: string;
  outletId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const order = useOrder(orderId);
  const menu = useLiveMenu(outletId);
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [pick, setPick] = useState<LiveItem | null>(null);
  const [voiding, setVoiding] = useState<OrderItem | null>(null);
  const [billing, setBilling] = useState(false);
  const send = usePosMutation(async (fire: boolean) => {
    const body = {
      fire,
      items: cart.map((l) => ({
        menuItemId: l.item.id,
        variantKey: l.variantKey,
        qty: l.qty,
        note: l.note || null,
        course: l.course || null,
        hold: l.hold,
        modifiers: l.mods,
        clientId: l.key,
      })),
    };
    const url = `/api/pos/orders/${orderId}/items`;
    try {
      await post(url, body);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      // The server can't be reached: the lines are kept on this device and sent when it answers.
      saveQueue(enqueue(loadQueue(), url, body));
      toast.message(t('pos.keptOffline'));
    }
    setCart([]);
  });
  const fireHeld = usePosMutation(() => post(`/api/pos/orders/${orderId}/fire`, {}), t('pos.fired'));
  const cancel = usePosMutation(() => post(`/api/pos/orders/${orderId}/cancel`), t('pos.cancelled'));
  const o = order.data;
  const cats = menu.data?.categories ?? [];
  const shown = cats.find((c) => c.id === cat) ?? cats[0];
  const add = (item: LiveItem, variantKey = '', mods: Line['mods'] = []) =>
    setCart((c) => {
      const same = c.find(
        (l) =>
          l.item.id === item.id &&
          l.variantKey === variantKey &&
          !l.note &&
          JSON.stringify(l.mods) === JSON.stringify(mods),
      );
      return same
        ? c.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { key: newKey('line'), item, variantKey, qty: 1, note: '', course: '', hold: false, mods }];
    });
  const set = (key: string, patch: Partial<Line>) =>
    setCart((c) => c.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const priceOf = (l: Line) =>
    (l.item.variants.find((v) => v.key === l.variantKey)?.price ?? l.item.price) +
    l.mods.reduce(
      (n, m) =>
        n +
        (l.item.modifierGroups.find((g) => g.id === m.groupId)?.options.find((x) => x.key === m.key)?.price ??
          0),
      0,
    );
  const open = o?.status === 'OPEN';
  const live = (o?.items ?? []).filter((i) => i.status !== 'VOID');
  return (
    <Dialog
      open
      wide
      onOpenChange={(v) => !v && onClose()}
      title={o ? t('pos.orderNo', { number: o.number }) : t('pos.order')}
      description={
        o ? `${t(`pos.type.${o.type}`)} · ${t(`pos.status.${o.status}`)} · ${rupees(o.total)}` : undefined
      }
      footer={
        o && (
          <>
            {open && live.length === 0 && cart.length === 0 && (
              <Button
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(undefined, { onSuccess: onClose })}
              >
                {t('pos.cancelOrder')}
              </Button>
            )}
            {open && live.some((i) => i.status === 'HELD') && cart.length === 0 && (
              <Button
                variant="secondary"
                disabled={fireHeld.isPending}
                onClick={() => fireHeld.mutate(undefined)}
              >
                {t('pos.fireHeld')}
              </Button>
            )}
            {open && cart.length > 0 && (
              <Button variant="primary" disabled={send.isPending} onClick={() => send.mutate(true)}>
                {t('pos.sendKitchen', { count: cart.reduce((n, l) => n + l.qty, 0) })}
              </Button>
            )}
            {o.status !== 'PAID' && o.status !== 'CANCELLED' && cart.length === 0 && live.length > 0 && (
              <Button variant="primary" onClick={() => setBilling(true)}>
                {o.status === 'BILLED' ? t('pos.payBill') : t('pos.bill')}
              </Button>
            )}
          </>
        )
      }
    >
      {order.isPending ? (
        <PageSkeleton />
      ) : order.isError || !o ? (
        <ErrorState onRetry={() => void order.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {open && (
            <section className="min-w-0">
              <div className="-mx-1 mb-2 flex gap-1 overflow-x-auto px-1" role="tablist">
                {cats.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    aria-selected={shown?.id === c.id}
                    onClick={() => setCat(c.id)}
                    className={cn(
                      'h-10 shrink-0 rounded-pill border px-3 text-sm font-medium',
                      shown?.id === c.id
                        ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                        : 'bg-card text-muted-foreground',
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(shown?.items ?? []).map((i) => {
                  const off = Boolean(i.out) || !i.available;
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={off}
                        onClick={() => (i.variants.length || i.modifierGroups.length ? setPick(i) : add(i))}
                        className={cn(
                          'flex min-h-16 w-full flex-col items-start justify-center rounded-control border bg-card p-2 text-left text-sm',
                          off && 'opacity-50',
                        )}
                      >
                        <span className="font-medium">{i.name}</span>
                        <span className="tabular text-xs text-muted-foreground">
                          {off
                            ? i.outReason
                              ? t('pos.out', { why: i.outReason })
                              : t('pos.notNow')
                            : i.variants.length
                              ? i.variants.map((v) => rupees(v.price)).join(' / ')
                              : rupees(i.price)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <section className={cn('min-w-0', !open && 'lg:col-span-2')}>
            {cart.length > 0 && (
              <ul className="mb-3 space-y-2">
                {cart.map((l) => (
                  <li key={l.key} className="rounded-control border border-dashed p-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {l.item.name}
                        {l.variantKey && ` (${l.item.variants.find((v) => v.key === l.variantKey)?.name})`}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('pos.less', { name: l.item.name })}
                        onClick={() => set(l.key, { qty: l.qty - 1 })}
                      >
                        {l.qty === 1 ? <Trash2 /> : <Minus />}
                      </Button>
                      <span className="tabular w-5 text-center">{l.qty}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('pos.more', { name: l.item.name })}
                        onClick={() => set(l.key, { qty: l.qty + 1 })}
                      >
                        <Plus />
                      </Button>
                      <span className="tabular w-20 text-right">{rupees(priceOf(l) * l.qty)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-[1fr_120px] gap-2">
                      <Input
                        aria-label={t('pos.noteFor', { name: l.item.name })}
                        placeholder={t('pos.note')}
                        value={l.note}
                        onChange={(e) => set(l.key, { note: e.target.value })}
                      />
                      <Select
                        aria-label={t('pos.course')}
                        value={l.course}
                        onChange={(e) => set(l.key, { course: e.target.value })}
                      >
                        <option value="">{t('pos.course')}</option>
                        {COURSES.map((c) => (
                          <option key={c} value={c}>
                            {t(`pos.courses.${c}`)}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs">
                      <Checkbox checked={l.hold} onChange={(e) => set(l.key, { hold: e.target.checked })} />
                      {t('pos.hold')}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <ul className="space-y-1">
              {o.items.map((i) => (
                <li
                  key={i.id}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-control border p-2 text-sm',
                    i.status === 'VOID' && 'opacity-60',
                  )}
                >
                  <span className="min-w-0 flex-1 basis-32">
                    <span className={cn('font-medium', i.status === 'VOID' && 'line-through')}>
                      {i.qty} × {i.name}
                      {i.variantName && ` (${i.variantName})`}
                    </span>
                    {(i.modifiers.length > 0 || i.note) && (
                      <span className="block text-xs text-muted-foreground">
                        {[...i.modifiers.map((m) => m.name), i.note].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <StatusChip tone={TONE[i.status]}>
                    {i.voidAsked ? t('pos.voidWaits') : t(`pos.item.${i.status}`)}
                  </StatusChip>
                  <span className="tabular">{rupees(i.price * i.qty)}</span>
                  {open && i.status !== 'VOID' && !i.voidAsked && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('pos.voidItem', { name: i.name })}
                      onClick={() => setVoiding(i)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </li>
              ))}
              {o.items.length === 0 && cart.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('pos.empty')}</p>
              )}
            </ul>
          </section>
        </div>
      )}
      {pick && <PickDialog item={pick} onClose={() => setPick(null)} onPick={(v, m) => add(pick, v, m)} />}
      {voiding && <VoidDialog orderId={orderId} item={voiding} onClose={() => setVoiding(null)} />}
      {billing && o && (
        <BillDialog order={o} outletId={outletId} onClose={() => setBilling(false)} onPaid={onClose} />
      )}
    </Dialog>
  );
}
