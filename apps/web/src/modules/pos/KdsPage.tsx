import { ChefHat } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { useOutlets } from '@/modules/hosp/api';
import { useOutletChoice } from '@/modules/hosp/outletChoice';
import { Seg } from '@/modules/stock/ui';
import { post, useKds, usePosMutation } from './api';

const TONE = {
  ok: 'border-status-ok-fg',
  warn: 'border-status-warn-fg',
  bad: 'border-status-bad-fg',
} as const;

/** The kitchen display (phase 15): tickets per station with their age; tap an item when it is ready, bump a ticket, recall it. */
export function KdsPage() {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [current, setOutletId] = useOutletChoice(outlets.data);
  const [stationId, setStationId] = useState('');
  const [show, setShow] = useState<'open' | 'bumped'>('open');

  const q = useKds(current, stationId, show);
  const act = usePosMutation((a: { id: string; action: 'ready' | 'bump' | 'recall' }) =>
    post(`/api/pos/kots/${a.id}/${a.action}`),
  );
  const ready = usePosMutation((a: { id: string; ready: boolean }) =>
    post(`/api/pos/items/${a.id}/ready`, { ready: a.ready }),
  );
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} />;
  return (
    <div>
      <PageHeader title={t('pos.kds.title')} subtitle={t('pos.kds.subtitle')} />
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-[240px_240px_1fr]">
        <Select
          aria-label={t('hosp.outlet.one')}
          value={current}
          onChange={(e) => {
            setOutletId(e.target.value);
            setStationId('');
          }}
        >
          {(outlets.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('pos.kds.station')}
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
        >
          <option value="">{t('pos.kds.expo')}</option>
          {(q.data?.stations ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <Seg
        value={show}
        onChange={setShow}
        options={[
          { key: 'open', label: t('pos.kds.open') },
          { key: 'bumped', label: t('pos.kds.bumped') },
        ]}
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.tickets.length === 0 ? (
        <EmptyState icon={ChefHat} title={t('pos.kds.emptyTitle')} body={t('pos.kds.emptyBody')} />
      ) : (
        <>
          {show === 'open' && q.data.allDay.length > 0 && (
            <p className="mb-3 text-sm">
              <span className="font-semibold">{t('pos.kds.allDay')}:</span>{' '}
              {q.data.allDay.map((a) => `${a.qty} × ${a.name}`).join(' · ')}
            </p>
          )}
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {q.data.tickets.map((k) => (
              <li key={k.id} className={cn('rounded-card border-2 bg-card p-3', TONE[k.tone])}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-semibold">
                    {t('pos.kds.kot', { number: k.number })}
                    {k.order?.table && ` · ${k.order.table}`}
                  </span>
                  <span className="tabular text-sm">{t('pos.kds.minutes', { count: k.minutes })}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {k.station} · {k.order ? t(`pos.type.${k.order.type}`) : ''}
                </div>
                <ul className="mt-2 space-y-1">
                  {k.items.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={show === 'bumped' || i.status === 'VOID' || ready.isPending}
                        aria-pressed={i.status === 'READY'}
                        onClick={() => ready.mutate({ id: i.id, ready: i.status !== 'READY' })}
                        className={cn(
                          'flex min-h-11 w-full items-start gap-2 rounded-control px-2 py-1 text-left',
                          i.status === 'READY' && 'bg-status-ok-bg text-status-ok-fg',
                          i.status === 'VOID' && 'line-through opacity-60',
                        )}
                      >
                        <span className="tabular font-semibold">{i.qty} ×</span>
                        <span className="min-w-0 flex-1">
                          {i.name}
                          {(i.mods.length > 0 || i.note) && (
                            <span className="block text-xs">
                              {[...i.mods.map((m) => `+ ${m}`), i.note ? `* ${i.note}` : '']
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                        {i.status === 'READY' && <span className="text-xs">{t('pos.item.READY')}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex justify-end">
                  {show === 'open' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: k.id, action: 'bump' })}
                    >
                      {t('pos.kds.bump')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: k.id, action: 'recall' })}
                    >
                      {t('pos.kds.recall')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
