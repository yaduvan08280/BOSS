import { Ban, FileText, Loader2, PackageCheck, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatINR, formatLocalDate, type PoStatus, type StatusTone } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { imsApi, qty, useImsMutation, useItems, usePos, type Po } from './api';

const TONE: Record<PoStatus, StatusTone> = {
  DRAFT: 'neutral',
  SENT: 'info',
  PARTLY_RECEIVED: 'warn',
  RECEIVED: 'ok',
  CANCELLED: 'bad',
};

/** Purchase orders: drafts (often from the OWS list), sent, received in parts or whole (§10.3, a simple PO). */
export function OrdersTab({ canOrder }: { canOrder: boolean }) {
  const { t } = useTranslation();
  const q = usePos();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const rows = q.data.filter(
    (p) =>
      !search.trim() ||
      matchScore(search, [p.number, p.vendor, ...p.lines.map((l) => l.item.name)].join(' ')) > 0,
  );
  const po = q.data.find((p) => p.id === open);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t('ims.p.search')}
          placeholder={t('ims.p.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-72"
        />
        {canOrder && (
          <Button className="ml-auto" onClick={() => setCreating(true)}>
            <Plus /> {t('ims.p.new')}
          </Button>
        )}
      </div>
      {!q.data.length ? (
        <EmptyState icon={FileText} title={t('ims.p.none')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpen(p.id)}
                className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">{p.number}</div>
                  <div className="font-medium">{p.vendor}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('ims.p.lines', { count: p.lines.length })}
                    {p.expectedOn && ` · ${t('ims.p.expected', { date: formatLocalDate(p.expectedOn) })}`}
                    {p.fromOws && ` · ${t('ims.p.fromOws')}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip tone={TONE[p.status]}>{t(`ims.po.${p.status}`)}</StatusChip>
                  <b className="tabular-nums">{formatINR(p.totalPaise, { compact: true })}</b>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {po && <PoDialog po={po} canOrder={canOrder} onClose={() => setOpen(null)} />}
      {creating && <NewPo onClose={() => setCreating(false)} />}
    </div>
  );
}

function PoDialog({ po, canOrder, onClose }: { po: Po; canOrder: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [got, setGot] = useState<Record<string, string>>({});
  const act = useImsMutation(
    (x: { action: 'send' | 'receive' | 'close' | 'cancel'; body?: object }) =>
      imsApi.poAction(po.id, x.action, x.body),
    (r) => t(`ims.p.done.${r.status}`, { number: r.number }),
  );
  const receiving = po.status === 'SENT' || po.status === 'PARTLY_RECEIVED';
  const lines = Object.entries(got)
    .map(([lineId, v]) => ({ lineId, qty: Number(v.replace(/,/g, '')) }))
    .filter((l) => l.qty > 0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={`${po.number} · ${po.vendor}`}
      description={[t(`ims.po.${po.status}`), po.by, po.note].filter(Boolean).join(' · ')}
      footer={
        canOrder && (
          <>
            {(po.status === 'DRAFT' || po.status === 'SENT') && (
              <Button
                variant="ghost"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: 'cancel' })}
              >
                <Ban /> {t('ims.p.cancel')}
              </Button>
            )}
            {po.status === 'PARTLY_RECEIVED' && (
              <Button
                variant="secondary"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: 'close' })}
              >
                {t('ims.p.closeShort')}
              </Button>
            )}
            {po.status === 'DRAFT' && (
              <Button disabled={act.isPending} onClick={() => act.mutate({ action: 'send' })}>
                <Send /> {t('ims.p.send')}
              </Button>
            )}
            {receiving && (
              <Button
                disabled={!lines.length || act.isPending}
                onClick={() =>
                  act.mutate({ action: 'receive', body: { lines } }, { onSuccess: () => setGot({}) })
                }
              >
                {act.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />} {t('ims.p.receive')}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">{t('ims.m.item')}</th>
              <th className="py-2 font-medium">{t('ims.p.ordered')}</th>
              <th className="py-2 font-medium">{t('ims.p.receivedCol')}</th>
              <th className="py-2 text-right font-medium">{t('ims.p.amount')}</th>
              {receiving && <th className="py-2 pl-3 font-medium">{t('ims.p.nowIn')}</th>}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="py-2">
                  {l.item.name} <span className="font-mono text-xs text-muted-foreground">{l.item.code}</span>
                </td>
                <td className="py-2 tabular-nums">
                  {qty(l.qty)} {l.item.unit} × {formatINR(l.ratePaise)}
                </td>
                <td className="py-2 tabular-nums">{qty(l.receivedQty)}</td>
                <td className="py-2 text-right tabular-nums">{formatINR(l.amountPaise)}</td>
                {receiving && (
                  <td className="py-1 pl-3">
                    {l.receivedQty < l.qty && (
                      <Input
                        aria-label={t('ims.p.nowInFor', { name: l.item.name })}
                        inputMode="decimal"
                        placeholder={qty(l.qty - l.receivedQty)}
                        value={got[l.id] ?? ''}
                        onChange={(e) => setGot({ ...got, [l.id]: e.target.value })}
                        className="w-24 tabular-nums"
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
            <tr className="border-t font-semibold">
              <td className="py-2" colSpan={3}>
                {t('ims.p.total')}
              </td>
              <td className="py-2 text-right tabular-nums">{formatINR(po.totalPaise)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function NewPo({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = useItems();
  const [vendor, setVendor] = useState('');
  const [expectedOn, setExpected] = useState('');
  const [lines, setLines] = useState<{ itemId: string; qty: string }[]>([{ itemId: '', qty: '' }]);
  const list = items.data?.items ?? [];
  const ok =
    vendor.trim().length >= 2 &&
    lines.length > 0 &&
    lines.every((l) => l.itemId && Number(l.qty) > 0) &&
    new Set(lines.map((l) => l.itemId)).size === lines.length;
  const save = useImsMutation(
    () =>
      imsApi.savePo({
        vendor: vendor.trim(),
        expectedOn: expectedOn || null,
        lines: lines.map((l) => ({ itemId: l.itemId, qty: Number(l.qty) })),
      }),
    (r) => t('ims.p.created', { number: r.number }),
  );
  const put = (i: number, x: Partial<(typeof lines)[number]>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...x } : l)));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ims.p.new')}
      wide
      footer={
        <Button
          disabled={!ok || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('ims.p.saveDraft')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('ims.i.col.vendor')}>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </Field>
          <Field label={t('ims.p.expectedOn')}>
            <DateInput value={expectedOn} onChange={setExpected} aria-label={t('ims.p.expectedOn')} />
          </Field>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_96px_auto] items-center gap-2">
            <Select
              value={l.itemId}
              aria-label={t('ims.m.item')}
              onChange={(e) => {
                const it = list.find((x) => x.id === e.target.value);
                put(i, { itemId: e.target.value });
                if (it && !vendor && it.vendor) setVendor(it.vendor);
              }}
            >
              <option value="">{t('org.choose')}</option>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {`${x.code} · ${x.name}`}
                </option>
              ))}
            </Select>
            <Input
              inputMode="decimal"
              aria-label={t('ims.m.qty', { unit: '' })}
              value={l.qty}
              onChange={(e) => put(i, { qty: e.target.value })}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('common.remove')}
              onClick={() => setLines(lines.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={() => setLines([...lines, { itemId: '', qty: '' }])}>
          <Plus /> {t('ims.p.addLine')}
        </Button>
      </div>
    </Dialog>
  );
}
