import { StockRoutes } from './StockRoutes';
import { Plus, Store, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OUTLET_KINDS, STATION_KINDS } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TimeInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useStock } from '@/modules/stock/api';
import { useBranches } from '@/modules/system/api';
import { hhmm, send, toMin, useHospMutation, useOutlets, usePrinters, type Outlet } from './api';

/** Outlets: what sells where, from which stock, with which charges — and each outlet's kitchen stations. */
export function OutletsPanel() {
  const { t } = useTranslation();
  const q = useOutlets();
  const [edit, setEdit] = useState<Partial<Outlet> | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEdit({})}>
          <Plus /> {t('hosp.outlet.add')}
        </Button>
      </div>
      {q.data.length === 0 ? (
        <EmptyState icon={Store} title={t('hosp.outlet.emptyTitle')} body={t('hosp.outlet.emptyBody')} />
      ) : (
        <ul className="space-y-2">
          {q.data.map((o) => (
            <li key={o.id}>
              <Card>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-3 text-left"
                  onClick={() => setEdit(o)}
                >
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="truncate font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t(`hosp.outlet.kinds.${o.kind}`)} · {o.branch} · {hhmm(o.openMin)}–{hhmm(o.closeMin)}
                    </div>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {t('hosp.outlet.summary', { stations: o.stations.length, tables: o.tables })}
                  </span>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && <OutletDialog outlet={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function OutletDialog({ outlet, onClose }: { outlet: Partial<Outlet>; onClose: () => void }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const places = useStock();
  const printers = usePrinters();
  const c = outlet.charges;
  const [d, setD] = useState({
    name: outlet.name ?? '',
    kind: outlet.kind ?? 'RESTAURANT',
    branchId: outlet.branchId ?? '',
    locationId: outlet.locationId ?? '',
    stockRoutes: outlet.stockRoutes ?? [],
    open: hhmm(outlet.openMin ?? 0),
    close: hhmm(outlet.closeMin ?? 0),
    service: String(c?.serviceChargePct ?? 0),
    packaging: String((c?.packagingPaise ?? 0) / 100),
    delivery: String((c?.deliveryPaise ?? 0) / 100),
    roundTo: String(c?.roundTo ?? 1),
    billPrinterId: outlet.billPrinterId ?? '',
  });
  const [station, setStation] = useState({ name: '', kind: 'KITCHEN' });
  const branchId = d.branchId || branches.data?.[0]?.id || '';
  const body = {
    name: d.name,
    kind: d.kind,
    branchId,
    locationId: d.locationId,
    stockRoutes: d.stockRoutes,
    openMin: toMin(d.open),
    closeMin: toMin(d.close) || 24 * 60,
    billPrinterId: d.billPrinterId || null,
    charges: {
      // What this form does not show (the UPI id …) is kept as it is.
      ...c,
      serviceChargePct: Number(d.service) || 0,
      packagingPaise: Math.round(Number(d.packaging || 0) * 100),
      deliveryPaise: Math.round(Number(d.delivery || 0) * 100),
      roundTo: Number(d.roundTo) || 0,
      chargeTaxCode: c?.chargeTaxCode ?? null,
    },
  };
  const save = useHospMutation(
    () =>
      outlet.id
        ? send('PUT', `/api/hosp/outlets/${outlet.id}`, body)
        : send('POST', '/api/hosp/outlets', body),
    t('org.saved'),
  );
  const addStation = useHospMutation(
    () => send('POST', '/api/hosp/stations', { outletId: outlet.id, ...station }),
    t('org.saved'),
  );
  const dropStation = useHospMutation(
    (id: string) => send('DELETE', `/api/hosp/stations/${id}`),
    t('org.deleted'),
  );
  const drop = useHospMutation(() => send('DELETE', `/api/hosp/outlets/${outlet.id}`), t('org.deleted'));
  const text = (k: Exclude<keyof typeof d, 'stockRoutes'>, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input inputMode="decimal" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </Field>
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={outlet.id ? outlet.name : t('hosp.outlet.add')}
      footer={
        <>
          {outlet.id && (
            <Button
              variant="ghost"
              disabled={drop.isPending}
              onClick={() => drop.mutate(undefined, { onSuccess: onClose })}
            >
              {t('org.delete')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={d.name.trim().length < 1 || !branchId || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t('org.name')}>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label={t('hosp.outlet.kind')}>
          <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })}>
            {OUTLET_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`hosp.outlet.kinds.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.outlet.branch')}>
          <Select
            value={branchId}
            onChange={(e) => setD({ ...d, branchId: e.target.value, locationId: '', stockRoutes: [] })}
          >
            {(branches.data ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('hosp.outlet.stockFrom')} hint={t('hosp.outlet.stockFromHint')}>
          <Select
            value={d.locationId || '~main'}
            onChange={(e) => setD({ ...d, locationId: e.target.value === '~main' ? '' : e.target.value })}
          >
            <option value="~main">{t('stock.mainStore')}</option>
            {(places.data?.places ?? [])
              .filter((p) => p.branchId === branchId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <StockRoutes
          places={(places.data?.places ?? []).filter((p) => p.branchId === branchId)}
          value={d.stockRoutes}
          onChange={(stockRoutes) => setD({ ...d, stockRoutes })}
        />
        <Field label={t('hosp.outlet.opens')}>
          <TimeInput
            value={d.open}
            onChange={(open) => setD({ ...d, open })}
            aria-label={t('hosp.outlet.opens')}
          />
        </Field>
        <Field label={t('hosp.outlet.closes')}>
          <TimeInput
            value={d.close}
            onChange={(close) => setD({ ...d, close })}
            aria-label={t('hosp.outlet.closes')}
          />
        </Field>
        {text('service', t('hosp.outlet.service'), t('hosp.outlet.serviceHint'))}
        {text('roundTo', t('hosp.outlet.roundTo'), t('hosp.outlet.roundToHint'))}
        {text('packaging', t('hosp.outlet.packaging'))}
        {text('delivery', t('hosp.outlet.delivery'))}
        <Field label={t('hosp.outlet.billPrinter')} className="sm:col-span-2">
          <Select value={d.billPrinterId} onChange={(e) => setD({ ...d, billPrinterId: e.target.value })}>
            <option value="">{t('hosp.none')}</option>
            {(printers.data ?? [])
              .filter((p) => p.kind === 'BILL')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
      {outlet.id && (
        <div className="mt-5 space-y-2">
          <div className="text-sm font-medium">{t('hosp.station.title')}</div>
          <ul className="space-y-1">
            {(outlet.stations ?? []).map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-control border px-3 py-1.5 text-sm"
              >
                <span>
                  {s.name}{' '}
                  <span className="text-muted-foreground">· {t(`hosp.station.kinds.${s.kind}`)}</span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('org.delete')}
                  onClick={() => dropStation.mutate(s.id, { onSuccess: onClose })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_140px_auto] items-end gap-2">
            <Input
              aria-label={t('hosp.station.name')}
              placeholder={t('hosp.station.name')}
              value={station.name}
              onChange={(e) => setStation({ ...station, name: e.target.value })}
            />
            <Select
              aria-label={t('hosp.station.kind')}
              value={station.kind}
              onChange={(e) => setStation({ ...station, kind: e.target.value })}
            >
              {STATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`hosp.station.kinds.${k}`)}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={!station.name.trim() || addStation.isPending}
              onClick={() => addStation.mutate(undefined, { onSuccess: onClose })}
            >
              <Plus /> {t('hosp.station.add')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
