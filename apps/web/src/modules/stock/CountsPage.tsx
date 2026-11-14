import { ClipboardList, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { post, put, qty, rupees, useCount, useCounts, useStock, useStockMutation } from './api';
import { PlaceSelect } from './ui';

const TONE = { OPEN: 'info', SUBMITTED: 'warn', APPROVED: 'ok', REJECTED: 'bad' } as const;

/** Closing counts (phase 13): count a location (blind if wanted), see the variance, have it approved. */
export function CountsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useCounts();
  const [make, setMake] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <PageHeader
        title={t('stock.count.title')}
        subtitle={t('stock.count.subtitle')}
        actions={
          hasPermission(me.user.permissions, 'ims.create') && (
            <Button variant="primary" onClick={() => setMake(true)}>
              <Plus /> {t('stock.count.new')}
            </Button>
          )
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={t('stock.count.emptyTitle')}
          body={t('stock.count.emptyBody')}
        />
      ) : (
        <ul className="space-y-2">
          {q.data.map((c) => (
            <li key={c.id}>
              <Card>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
                  onClick={() => setOpen(c.id)}
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">{c.location}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{c.number}</span> · {formatLocalDate(c.date)} ·{' '}
                      {t('stock.count.progress', { counted: c.counted, items: c.items })}
                    </div>
                  </div>
                  {c.flagged > 0 && (
                    <StatusChip tone="bad">{t('stock.count.flagged', { count: c.flagged })}</StatusChip>
                  )}
                  <StatusChip tone={TONE[c.status as keyof typeof TONE] ?? 'neutral'}>
                    {t(`stock.count.status.${c.status}`)}
                  </StatusChip>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {make && <OpenDialog onClose={() => setMake(false)} onMade={setOpen} />}
      {open && <Sheet id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OpenDialog({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const { t } = useTranslation();
  const stock = useStock();
  const places = stock.data?.places ?? [];
  const [d, setD] = useState({ locationId: places[0]?.id ?? '', blind: true });
  const save = useStockMutation(() => post<{ id: string }>('/api/ims/closing', d));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('stock.count.new')}
      footer={
        <Button
          variant="primary"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: (r) => {
                onClose();
                onMade(r.id);
              },
            })
          }
        >
          {t('stock.count.start')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Field label={t('stock.location')}>
          <PlaceSelect
            label={t('stock.location')}
            value={d.locationId}
            places={places}
            onChange={(locationId) => setD({ ...d, locationId })}
          />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={d.blind} onChange={(e) => setD({ ...d, blind: e.target.checked })} />
          <span>{t('stock.count.blind')}</span>
        </label>
      </div>
    </Dialog>
  );
}

function Sheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useCount(id);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const c = q.data;
  const lines = () =>
    (c?.lines ?? [])
      .filter((l) => typed[l.itemId] !== undefined && typed[l.itemId] !== '')
      .map((l) => ({ itemId: l.itemId, counted: Number(typed[l.itemId]) }));
  const save = useStockMutation(async (submit: boolean) => {
    if (lines().length) await put(`/api/ims/closing/${id}`, { lines: lines() });
    if (submit) await post(`/api/ims/closing/${id}/submit`);
  }, t('org.saved'));
  const decide = useStockMutation(
    (action: 'approve' | 'reject') => post(`/api/ims/closing/${id}/${action}`, {}),
    t('org.saved'),
  );
  const done = (c?.lines ?? []).every((l) => l.counted !== null || (typed[l.itemId] ?? '') !== '');
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={c ? `${t('stock.count.one')} ${c.number}` : t('stock.count.one')}
      description={
        c
          ? `${c.location.id === '' ? t('stock.mainStore') : c.location.name} · ${formatLocalDate(c.date)}${c.blind ? ` · ${t('stock.count.isBlind')}` : ''}`
          : undefined
      }
      footer={
        c?.status === 'OPEN' ? (
          <>
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => save.mutate(false, { onSuccess: () => setTyped({}) })}
            >
              {t('stock.count.saveSoFar')}
            </Button>
            <Button
              variant="primary"
              disabled={!done || save.isPending}
              onClick={() => save.mutate(true, { onSuccess: () => setTyped({}) })}
            >
              {t('stock.count.submit')}
            </Button>
          </>
        ) : c?.canDecide ? (
          <>
            <Button
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => decide.mutate('reject', { onSuccess: onClose })}
            >
              {t('stock.reject')}
            </Button>
            <Button
              variant="primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate('approve', { onSuccess: onClose })}
            >
              {t('stock.count.approve')}
            </Button>
          </>
        ) : undefined
      }
    >
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError || !c ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : (
        <ul className="space-y-2">
          {c.lines.map((l) => (
            <li
              key={l.itemId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border p-2 text-sm"
            >
              <div className="min-w-0 flex-1 basis-40">
                <div className="truncate font-medium">{l.name}</div>
                <div className="tabular text-xs text-muted-foreground">
                  <span className="font-mono">{l.code}</span>
                  {l.system !== null &&
                    ` · ${t('stock.count.system', { qty: `${qty(l.system)} ${l.unit}` })}`}
                </div>
              </div>
              {c.status === 'OPEN' ? (
                <Input
                  aria-label={t('stock.count.countedOf', { name: l.name })}
                  placeholder={l.unit}
                  inputMode="decimal"
                  className="w-28"
                  value={typed[l.itemId] ?? (l.counted === null ? '' : String(l.counted))}
                  onChange={(e) => setTyped({ ...typed, [l.itemId]: e.target.value })}
                />
              ) : (
                <>
                  <span className="tabular">
                    {t('stock.count.counted', { qty: `${qty(l.counted ?? 0)} ${l.unit}` })}
                  </span>
                  {l.diff !== null && l.diff !== 0 && (
                    <StatusChip tone={l.flagged ? 'bad' : 'warn'}>
                      {`${l.diff > 0 ? '+' : ''}${qty(l.diff)} ${l.unit}${l.pct !== null ? ` · ${l.pct}%` : ''}${l.value ? ` · ${rupees(l.value)}` : ''}`}
                    </StatusChip>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
