import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { send, useHospMutation, useMenu, useOutlets, usePrinters } from './api';

/** Printers, and which station each menu category's tickets go to at an outlet. */
export function PrintersPanel() {
  const { t } = useTranslation();
  const printers = usePrinters();
  const outlets = useOutlets();
  const menu = useMenu();
  const [p, setP] = useState({ name: '', kind: 'KOT', connection: 'NETWORK', address: '' });
  const [outletId, setOutletId] = useState('');
  const add = useHospMutation(
    () => send('POST', '/api/hosp/printers', { ...p, address: p.address || null }),
    t('org.saved'),
  );
  const drop = useHospMutation((id: string) => send('DELETE', `/api/hosp/printers/${id}`), t('org.deleted'));
  const outlet = outlets.data?.find((o) => o.id === outletId) ?? outlets.data?.[0];
  const [routes, setRoutes] = useState<Record<string, string> | null>(null);
  const saveRoutes = useHospMutation(
    (map: Record<string, string>) =>
      send('PUT', '/api/hosp/routes', {
        outletId: outlet!.id,
        routes: Object.entries(map)
          .filter(([, stationId]) => stationId)
          .map(([category, stationId]) => ({ category, stationId })),
      }),
    t('org.saved'),
  );
  if (printers.isPending || outlets.isPending) return <PageSkeleton />;
  if (printers.isError) return <ErrorState onRetry={() => void printers.refetch()} />;
  const current = routes ?? Object.fromEntries((outlet?.routes ?? []).map((r) => [r.category, r.stationId]));
  const cats = ['', ...(menu.data?.categories ?? []).map((c) => c.name)];
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.printer.title')}</h3>
        <Card className="grid grid-cols-2 items-end gap-2 p-3">
          <Field label={t('org.name')}>
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </Field>
          <Field label={t('hosp.printer.kind')}>
            <Select value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value })}>
              <option value="KOT">{t('hosp.printer.KOT')}</option>
              <option value="BILL">{t('hosp.printer.BILL')}</option>
            </Select>
          </Field>
          <Field label={t('hosp.printer.connection')}>
            <Select value={p.connection} onChange={(e) => setP({ ...p, connection: e.target.value })}>
              <option value="NETWORK">{t('hosp.printer.NETWORK')}</option>
              <option value="AGENT">{t('hosp.printer.AGENT')}</option>
            </Select>
          </Field>
          <Field label={t('hosp.printer.address')}>
            <Input
              value={p.address}
              placeholder="192.168.1.50:9100"
              className="font-mono"
              onChange={(e) => setP({ ...p, address: e.target.value })}
            />
          </Field>
          <Button
            className="col-span-2"
            variant="primary"
            disabled={!p.name.trim() || add.isPending}
            onClick={() => add.mutate(undefined, { onSuccess: () => setP({ ...p, name: '', address: '' }) })}
          >
            <Plus /> {t('hosp.printer.add')}
          </Button>
        </Card>
        <ul className="space-y-2">
          {printers.data.map((x) => (
            <li key={x.id}>
              <Card className="flex items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <div className="font-medium">{x.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t(`hosp.printer.${x.kind}`)} · {t(`hosp.printer.${x.connection}`)}
                    {x.address && <span className="font-mono"> · {x.address}</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('org.delete')}
                  onClick={() => drop.mutate(x.id)}
                >
                  <Trash2 />
                </Button>
              </Card>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t('hosp.printer.note')}</p>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t('hosp.route.title')}</h3>
        {!outlet ? (
          <p className="text-sm text-muted-foreground">{t('hosp.floor.noOutletBody')}</p>
        ) : (
          <>
            <Select
              aria-label={t('hosp.outlet.one')}
              value={outlet.id}
              onChange={(e) => {
                setOutletId(e.target.value);
                setRoutes(null);
              }}
            >
              {(outlets.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
            <ul className="space-y-2">
              {cats.map((c) => (
                <li key={c || '~default'} className="grid grid-cols-2 items-center gap-2 text-sm">
                  <span>{c || t('hosp.route.default')}</span>
                  <Select
                    aria-label={t('hosp.route.stationFor', { category: c || t('hosp.route.default') })}
                    value={current[c] ?? ''}
                    onChange={(e) => setRoutes({ ...current, [c]: e.target.value })}
                  >
                    <option value="">{c ? t('hosp.route.asDefault') : t('hosp.route.first')}</option>
                    {outlet.stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
            <Button
              variant="primary"
              disabled={!routes || saveRoutes.isPending}
              onClick={() => saveRoutes.mutate(current, { onSuccess: () => setRoutes(null) })}
            >
              {t('common.save')}
            </Button>
          </>
        )}
      </section>
    </div>
  );
}
