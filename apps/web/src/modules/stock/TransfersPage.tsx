import { Plus, Trash2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, qty, rupees, useItems, useStock, useStockMutation, useTransfers, type Transfer } from './api';
import { usePlaceName } from './place-name';
import { ItemSelect, PlaceSelect, Seg } from './ui';

const TONE: Record<Transfer['status'], 'neutral' | 'info' | 'warn' | 'ok' | 'bad'> = {
  REQUESTED: 'warn',
  APPROVED: 'info',
  DISPATCHED: 'info',
  RECEIVED: 'warn',
  CLOSED: 'ok',
  REJECTED: 'bad',
  CANCELLED: 'neutral',
};
const TABS = ['open', 'transit', 'done'] as const;

/** Indents and transfers (phase 13): ask a store or kitchen, approve, dispatch, see what is on the road, receive. */
export function TransfersPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useTransfers();
  const [tab, setTab] = useState<(typeof TABS)[number]>('open');
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const name = usePlaceName();
  const rows = (q.data ?? []).filter((r) =>
    tab === 'transit'
      ? r.inTransit
      : tab === 'open'
        ? ['REQUESTED', 'APPROVED'].includes(r.status)
        : ['CLOSED', 'REJECTED', 'CANCELLED'].includes(r.status),
  );
  const current = q.data?.find((r) => r.id === open) ?? null;
  return (
    <div>
      <PageHeader
        title={t('stock.transfers.title')}
        subtitle={t('stock.transfers.subtitle')}
        actions={
          hasPermission(me.user.permissions, 'ims.create') && (
            <Button variant="primary" onClick={() => setAsk(true)}>
              <Plus /> {t('stock.transfers.ask')}
            </Button>
          )
        }
      />
      <Seg
        value={tab}
        onChange={setTab}
        options={TABS.map((k) => ({ key: k, label: t(`stock.transfers.tab.${k}`) }))}
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title={t('stock.transfers.emptyTitle')}
          body={t('stock.transfers.emptyBody')}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
                  onClick={() => setOpen(r.id)}
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">
                      {name(r.from)} → {name(r.to)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{r.number}</span> ·{' '}
                      {formatLocalDate(r.createdAt.slice(0, 10))} ·{' '}
                      {r.lines.map((l) => l.item?.name).join(', ')}
                    </div>
                  </div>
                  {r.kind === 'EMERGENCY' && (
                    <StatusChip tone="bad">{t('stock.transfers.emergency')}</StatusChip>
                  )}
                  <StatusChip tone={TONE[r.status]}>{t(`stock.transfers.status.${r.status}`)}</StatusChip>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {ask && <AskDialog onClose={() => setAsk(false)} />}
      {current && <TransferDialog t0={current} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AskDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const stock = useStock();
  const items = useItems();
  const places = (stock.data?.places ?? []).filter((p) => p.id !== '~transit');
  const [d, setD] = useState({ kind: 'INDENT', to: places[0]?.id ?? '', from: '', reason: '' });
  const [lines, setLines] = useState([{ itemId: '', qty: '', unit: '' }]);
  const kept = lines.filter((l) => l.itemId && Number(l.qty) > 0);
  const save = useStockMutation(
    () =>
      post<{ number: string }>('/api/ims/transfers', {
        kind: d.kind,
        toLocationId: d.to,
        ...(d.from ? { fromLocationId: d.from === '~main' ? '' : d.from } : {}),
        reason: d.reason || null,
        lines: kept.map((l) => ({ itemId: l.itemId, qty: Number(l.qty), unit: l.unit || null })),
      }),
    (r) => t('stock.transfers.asked', { number: r.number }),
  );
  const set = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.transfers.ask')}
      footer={
        <Button
          variant="primary"
          disabled={!kept.length || (d.kind === 'EMERGENCY' && !d.reason) || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('stock.transfers.send')}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={t('stock.transfers.kind')}>
          <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
            {['INDENT', 'EMERGENCY', 'DIRECT'].map((k) => (
              <option key={k} value={k}>
                {t(`stock.transfers.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('stock.transfers.for')}>
          <PlaceSelect
            label={t('stock.transfers.for')}
            value={d.to}
            places={places}
            onChange={(to) => setD({ ...d, to })}
          />
        </Field>
        <Field label={t('stock.transfers.supplier')} hint={t('stock.transfers.supplierHint')}>
          <Select value={d.from} onChange={(e) => setD({ ...d, from: e.target.value })}>
            <option value="">{t('stock.transfers.byRoute')}</option>
            {places
              .filter((p) => p.id !== d.to)
              .map((p) => (
                <option key={p.id || '~main'} value={p.id || '~main'}>
                  {p.id === '' ? t('stock.mainStore') : p.branch ? `${p.name} · ${p.branch}` : p.name}
                </option>
              ))}
          </Select>
        </Field>
        {d.kind === 'EMERGENCY' && (
          <Field label={t('stock.transfers.why')} className="sm:col-span-3">
            <Input value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} />
          </Field>
        )}
      </div>
      <div className="mt-4 space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_110px_110px_auto]">
            <ItemSelect
              label={t('stock.item')}
              value={l.itemId}
              items={(items.data?.items ?? []).filter((x) => x.active)}
              onChange={(itemId) => set(i, { itemId })}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="sm:order-last"
              aria-label={t('common.remove')}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
            <Input
              aria-label={t('stock.qty')}
              placeholder={t('stock.qty')}
              inputMode="decimal"
              value={l.qty}
              onChange={(e) => set(i, { qty: e.target.value })}
            />
            <Input
              aria-label={t('stock.unit')}
              placeholder={t('stock.unit')}
              value={l.unit}
              onChange={(e) => set(i, { unit: e.target.value })}
            />
          </div>
        ))}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLines([...lines, { itemId: '', qty: '', unit: '' }])}
        >
          <Plus /> {t('stock.addLine')}
        </Button>
      </div>
    </Dialog>
  );
}

/** One transfer: its lines and the next thing this person can do with it. */
function TransferDialog({ t0, onClose }: { t0: Transfer; onClose: () => void }) {
  const { t } = useTranslation();
  const name = usePlaceName();
  // What the person types for each line: approved (supplier) or received and damaged (receiver).
  const [typed, setTyped] = useState<Record<string, { a?: string; r?: string; d?: string }>>({});
  const val = (id: string, k: 'a' | 'r' | 'd', fallback: number) => typed[id]?.[k] ?? String(fallback);
  const put = (id: string, k: 'a' | 'r' | 'd', v: string) =>
    setTyped({ ...typed, [id]: { ...typed[id], [k]: v } });
  const act = useStockMutation(
    (a: { action: string; body?: object }) => post(`/api/ims/transfers/${t0.id}/${a.action}`, a.body ?? {}),
    t('org.saved'),
  );
  const go = (action: string, body?: object) => act.mutate({ action, body }, { onSuccess: onClose });
  const stage = t0.status;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`${t(`stock.transfers.kinds.${t0.kind}`)} ${t0.number}`}
      description={`${name(t0.from)} → ${name(t0.to)}`}
      footer={
        <>
          {stage === 'REQUESTED' && t0.iSupply && (
            <>
              <Button variant="ghost" disabled={act.isPending} onClick={() => go('reject')}>
                {t('stock.transfers.reject')}
              </Button>
              <Button
                variant="primary"
                disabled={act.isPending}
                onClick={() =>
                  go('approve', {
                    lines: t0.lines.map((l) => ({
                      itemId: l.itemId,
                      approved: Number(val(l.itemId, 'a', l.asked)),
                    })),
                  })
                }
              >
                {t('stock.transfers.approve')}
              </Button>
            </>
          )}
          {stage === 'REQUESTED' && !t0.iSupply && t0.kind === 'EMERGENCY' && (
            <Button variant="primary" disabled={act.isPending} onClick={() => go('approve')}>
              {t('stock.transfers.approve')}
            </Button>
          )}
          {stage === 'APPROVED' && t0.iSupply && (
            <Button variant="primary" disabled={act.isPending} onClick={() => go('dispatch')}>
              {t('stock.transfers.dispatch')}
            </Button>
          )}
          {stage === 'DISPATCHED' && t0.iReceive && (
            <Button
              variant="primary"
              disabled={act.isPending}
              onClick={() =>
                go('receive', {
                  lines: t0.lines
                    .filter((l) => l.dispatched > 0)
                    .map((l) => ({
                      itemId: l.itemId,
                      received: Number(val(l.itemId, 'r', l.dispatched)),
                      damaged: Number(val(l.itemId, 'd', 0)),
                    })),
                })
              }
            >
              {t('stock.transfers.receive')}
            </Button>
          )}
          {stage === 'RECEIVED' && (
            <Button variant="primary" disabled={act.isPending} onClick={() => go('settle')}>
              {t('stock.transfers.settle')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={TONE[t0.status]}>{t(`stock.transfers.status.${t0.status}`)}</StatusChip>
          {t0.paper && (
            <span className="text-sm text-muted-foreground">
              {t(`money.kind.${t0.paper.type}`)} <span className="font-mono">{t0.paper.number}</span> ·{' '}
              {rupees(t0.paper.total)}
            </span>
          )}
        </div>
        {t0.reason && <p className="text-sm">{t0.reason}</p>}
        <ul className="space-y-2">
          {t0.lines.map((l) => (
            <li key={l.itemId} className="rounded-control border p-3 text-sm">
              <div className="font-medium">
                {l.item?.name}
                {l.substitute && <span className="text-muted-foreground"> → {l.substitute.name}</span>}
              </div>
              <div className="tabular mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                <span>
                  {t('stock.transfers.askedQty', {
                    qty: `${qty(l.unitQty)} ${l.unit ?? l.item?.unit ?? ''}`,
                  })}
                </span>
                {l.approved !== null && (
                  <span>{t('stock.transfers.approvedQty', { qty: qty(l.approved) })}</span>
                )}
                {l.dispatched > 0 && (
                  <span>{t('stock.transfers.dispatchedQty', { qty: qty(l.dispatched) })}</span>
                )}
                {['RECEIVED', 'CLOSED'].includes(stage) && (
                  <span>{t('stock.transfers.receivedQty', { qty: qty(l.received) })}</span>
                )}
                {(l.short > 0 || l.damaged > 0 || l.excess > 0) && (
                  <span className="text-status-bad-fg">
                    {t('stock.transfers.diff', {
                      short: qty(l.short),
                      damaged: qty(l.damaged),
                      excess: qty(l.excess),
                    })}
                  </span>
                )}
              </div>
              {stage === 'REQUESTED' && t0.iSupply && (
                <Field
                  label={t('stock.transfers.approveQty', { unit: l.item?.unit ?? '' })}
                  className="mt-2 max-w-48"
                >
                  <Input
                    inputMode="decimal"
                    value={val(l.itemId, 'a', l.asked)}
                    onChange={(e) => put(l.itemId, 'a', e.target.value)}
                  />
                </Field>
              )}
              {stage === 'DISPATCHED' && t0.iReceive && l.dispatched > 0 && (
                <div className="mt-2 grid max-w-sm grid-cols-2 gap-2">
                  <Field label={t('stock.transfers.gotQty')}>
                    <Input
                      inputMode="decimal"
                      value={val(l.itemId, 'r', l.dispatched)}
                      onChange={(e) => put(l.itemId, 'r', e.target.value)}
                    />
                  </Field>
                  <Field label={t('stock.transfers.damagedQty')}>
                    <Input
                      inputMode="decimal"
                      value={val(l.itemId, 'd', 0)}
                      onChange={(e) => put(l.itemId, 'd', e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
