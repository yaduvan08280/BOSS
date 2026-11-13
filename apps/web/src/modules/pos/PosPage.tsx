import { Plus, UtensilsCrossed, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ORDER_TYPES, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useOutlets } from '@/modules/hosp/api';
import { rupees } from '@/modules/stock/api';
import { post, useApprovals, useFloor, usePosMutation, type Approval, type TableState } from './api';
import { OrderPanel } from './OrderPanel';
import { drain, loadQueue, newKey, saveQueue } from './queue';

/** The colour of a table by its state: never colour alone — the state is written on it. */
const STATE: Record<TableState, string> = {
  FREE: 'bg-card',
  SEATED: 'bg-status-info-bg text-status-info-fg',
  ORDERED: 'bg-status-warn-bg text-status-warn-fg',
  BILLED: 'bg-status-over-bg text-status-over-fg',
  PAID: 'bg-status-ok-bg text-status-ok-fg',
};

/** The POS (phase 15): the outlet's floor with every table's state; tap a table to take its order, bill and settle. */
export function PosPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [outletId, setOutletId] = useState('');
  const current = outletId || outlets.data?.[0]?.id || '';
  const floor = useFloor(current);
  const approvals = useApprovals(current);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [seat, setSeat] = useState<{ tableId?: string; type: string } | null>(null);
  const [asks, setAsks] = useState(false);
  const [waiting, setWaiting] = useState(() => loadQueue().length);
  const canTake = hasPermission(me.user.permissions, 'hosp.create');
  // Whatever was taken while the server could not be reached is sent when it answers again.
  useEffect(() => {
    const flush = async () => {
      const r = await drain(loadQueue(), async (q) => {
        try {
          await post(q.url, q.body);
          return 'sent';
        } catch (e) {
          return e instanceof ApiError ? { refused: e.message } : 'offline';
        }
      });
      saveQueue(r.left);
      setWaiting(r.left.length);
    };
    void flush();
    const timer = setInterval(() => void flush(), 15_000);
    window.addEventListener('online', flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', flush);
    };
  }, []);
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} />;
  if (!outlets.data.length)
    return <EmptyState icon={UtensilsCrossed} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  const pending = approvals.data ?? [];
  return (
    <div>
      <PageHeader
        title={t('pos.title')}
        subtitle={t('pos.subtitle')}
        actions={
          canTake && (
            <>
              <Button variant="secondary" onClick={() => setSeat({ type: 'COUNTER' })}>
                {t('pos.counterSale')}
              </Button>
              <Button variant="primary" onClick={() => setSeat({ type: 'TAKEAWAY' })}>
                <Plus /> {t('pos.newOrder')}
              </Button>
            </>
          )
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Select
            aria-label={t('hosp.outlet.one')}
            value={current}
            onChange={(e) => setOutletId(e.target.value)}
          >
            {outlets.data.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
        {waiting > 0 && (
          <span className="flex items-center gap-1 rounded-pill bg-status-warn-bg px-3 py-1 text-sm text-status-warn-fg">
            <WifiOff className="size-4" /> {t('pos.queued', { count: waiting })}
          </span>
        )}
        {pending.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAsks(true)}>
            {t('pos.approvals', { count: pending.length })}
          </Button>
        )}
      </div>
      {floor.isPending ? (
        <PageSkeleton />
      ) : floor.isError ? (
        <ErrorState onRetry={() => void floor.refetch()} />
      ) : (
        <div className="space-y-5">
          {floor.data.floors.map((f) => (
            <section key={f.id}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{f.name}</h2>
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {f.tables.map((tb) => (
                  <li key={tb.id}>
                    <button
                      type="button"
                      disabled={!canTake && !tb.order}
                      onClick={() =>
                        tb.order ? setOrderId(tb.order.id) : setSeat({ tableId: tb.id, type: 'DINE_IN' })
                      }
                      className={cn(
                        'flex min-h-20 w-full flex-col items-center justify-center rounded-card border p-2 text-center',
                        STATE[tb.state],
                      )}
                    >
                      <span className="font-semibold">{tb.name}</span>
                      <span className="text-xs">{t(`pos.state.${tb.state}`)}</span>
                      {tb.order && <span className="tabular text-xs">{rupees(tb.order.total)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {floor.data.floors.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('pos.noTables')}</p>
          )}
          {floor.data.others.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('pos.others')}</h2>
              <ul className="space-y-2">
                {floor.data.others.map((o) => (
                  <li key={o.id}>
                    <Card>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 p-3 text-left"
                        onClick={() => setOrderId(o.id)}
                      >
                        <span>
                          <span className="font-medium">{t(`pos.type.${o.type}`)}</span>{' '}
                          <span className="font-mono text-sm">#{o.number}</span>
                          {o.guestName && (
                            <span className="text-sm text-muted-foreground"> · {o.guestName}</span>
                          )}
                        </span>
                        <span className="tabular font-semibold">{rupees(o.total)}</span>
                      </button>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {seat && (
        <SeatDialog outletId={current} seat={seat} onClose={() => setSeat(null)} onOpened={setOrderId} />
      )}
      {orderId && <OrderPanel orderId={orderId} outletId={current} onClose={() => setOrderId(null)} />}
      {asks && <ApprovalsDialog rows={pending} onClose={() => setAsks(false)} />}
    </div>
  );
}

function SeatDialog({
  outletId,
  seat,
  onClose,
  onOpened,
}: {
  outletId: string;
  seat: { tableId?: string; type: string };
  onClose: () => void;
  onOpened: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState({ type: seat.type, covers: '2', guestName: '', roomNo: '' });
  const open = usePosMutation(() =>
    post<{ id: string }>('/api/pos/orders', {
      outletId,
      type: d.type,
      tableIds: seat.tableId ? [seat.tableId] : [],
      covers: Number(d.covers) || 1,
      guestName: d.guestName || null,
      roomNo: d.roomNo || null,
      clientId: newKey('order'),
    }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={seat.tableId ? t('pos.seat') : t('pos.newOrder')}
      footer={
        <Button
          variant="primary"
          disabled={open.isPending || (d.type === 'ROOM_SERVICE' && !d.roomNo)}
          onClick={() =>
            open.mutate(undefined, {
              onSuccess: (r) => {
                onClose();
                onOpened(r.id);
              },
            })
          }
        >
          {t('pos.start')}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        {!seat.tableId && (
          <Field label={t('pos.orderType')} className="col-span-2">
            <Select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>
              {ORDER_TYPES.filter((x) => x !== 'DINE_IN').map((x) => (
                <option key={x} value={x}>
                  {t(`pos.type.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('pos.covers')}>
          <Input
            inputMode="numeric"
            value={d.covers}
            onChange={(e) => setD({ ...d, covers: e.target.value })}
          />
        </Field>
        <Field label={t('pos.guest')}>
          <Input value={d.guestName} onChange={(e) => setD({ ...d, guestName: e.target.value })} />
        </Field>
        {d.type === 'ROOM_SERVICE' && (
          <Field label={t('pos.room')} className="col-span-2">
            <Input value={d.roomNo} onChange={(e) => setD({ ...d, roomNo: e.target.value })} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function ApprovalsDialog({ rows, onClose }: { rows: Approval[]; onClose: () => void }) {
  const { t } = useTranslation();
  const decide = usePosMutation(
    (a: { id: string; approve: boolean }) =>
      post(`/api/pos/approvals/${a.id}/decide`, { approve: a.approve }),
    t('org.saved'),
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('pos.approvalsTitle')}>
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className="rounded-control border p-3 text-sm">
            <div className="font-medium">
              {t(`pos.ask.${a.kind}`)} · {a.askedBy}
            </div>
            <div className="text-muted-foreground">
              {String(a.ask.name ?? a.ask.number ?? '')}{' '}
              {String(
                a.ask.reason ??
                  (a.ask.check as { discount?: { reason?: string } } | undefined)?.discount?.reason ??
                  '',
              )}
            </div>
            {a.canDecide && (
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a.id, approve: false })}
                >
                  {t('stock.reject')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: a.id, approve: true })}
                >
                  {t('stock.approve')}
                </Button>
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">{t('pos.noApprovals')}</p>}
      </ul>
    </Dialog>
  );
}
