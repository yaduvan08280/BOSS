import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useModes } from '@/modules/money/api';
import { rupees } from '@/modules/stock/api';
import { dmy, EVENT_TONE, send, useBanquetMutation, usePackages, type BanquetEvent } from './api';

/** One event: its quotation, advance and confirmation, the BEO, the indent, the day's checklist, the final bill. */
export function EventDialog({
  event: e,
  canSell,
  onClose,
}: {
  event: BanquetEvent;
  canSell: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const packages = usePackages();
  const modes = useModes();
  const [f, setF] = useState({
    packageId: e.quote?.packageId ?? '',
    covers: String(e.guaranteedCovers ?? e.expectedCovers),
    extra: '',
    extraAmount: '',
    amount: '',
    modeId: '',
    actual: String(e.guaranteedCovers ?? ''),
    kitchen: e.beo?.kitchen ?? '',
    service: e.beo?.service ?? '',
    housekeeping: e.beo?.housekeeping ?? '',
    reason: '',
  });
  const set = (k: keyof typeof f) => (ev: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: ev.target.value }));
  const act = useBanquetMutation(
    (x: { what: string; body?: object }) => send(`/api/banquets/events/${e.id}/${x.what}`, x.body ?? {}),
    t('res.done'),
  );
  const go = (what: string, body?: object) => act.mutate({ what, body });
  const usable = (modes.data ?? []).filter(
    (m) => m.active && !['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(m.kind),
  );
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
  const canQuote = canSell && ['ENQUIRY', 'QUOTED', 'CONFIRMED'].includes(e.status);
  const due = e.invoice?.due ?? 0;
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`${e.occasion} · ${e.number}`}
      description={t('bq.line', {
        day: dmy(e.day),
        from: e.from,
        to: e.to,
        halls: e.halls.map((h) => h.name).join(' + '),
        guest: e.guest?.name ?? '',
      })}
    >
      <div className="space-y-4">
        <StatusChip tone={EVENT_TONE[e.status]}>{t(`bq.status.${e.status}`)}</StatusChip>
        {canQuote && (
          <section className="space-y-2 rounded-control border p-3">
            <h3 className="text-sm font-semibold">{t('bq.quotation')}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('bq.package')}>
                <Select value={f.packageId} onChange={set('packageId')}>
                  <option value="">{t('bq.choosePackage')}</option>
                  {(packages.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {rupees(p.pricePerPlate)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('bq.guaranteed')}>
                <Input inputMode="numeric" value={f.covers} onChange={set('covers')} />
              </Field>
              <Field label={t('bq.extra')}>
                <Input value={f.extra} onChange={set('extra')} />
              </Field>
              <Field label={t('bq.extraAmount')}>
                <Input inputMode="decimal" value={f.extraAmount} onChange={set('extraAmount')} />
              </Field>
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={act.isPending || !f.packageId || !(Number(f.covers) > 0)}
              onClick={() =>
                go('quote', {
                  packageId: f.packageId,
                  guaranteedCovers: Number(f.covers),
                  extras: [
                    ...(e.quote?.extras ?? []),
                    ...(f.extra.trim() && Number(f.extraAmount) > 0
                      ? [{ name: f.extra.trim(), amount: Math.round(Number(f.extraAmount) * 100) }]
                      : []),
                  ],
                })
              }
            >
              {e.quote ? t('bq.requote') : t('bq.quote')}
            </Button>
          </section>
        )}
        {e.quote && (
          <dl className="space-y-1 text-sm" data-testid="bq-totals">
            {row(t('bq.covers'), String(e.totals.covers))}
            {row(t('bq.beforeTax'), rupees(e.totals.taxable))}
            {row(t('hotel.folio.tax'), rupees(e.totals.tax))}
            {row(t('money.total'), rupees(e.totals.total), true)}
            {row(t('bq.advancePaid'), `${rupees(e.advance.paid)} / ${rupees(e.advance.needed)}`)}
            {e.invoice && row(t('bq.invoice', { number: e.invoice.number }), rupees(e.invoice.due), true)}
          </dl>
        )}
        {canSell && ['QUOTED', 'CONFIRMED'].includes(e.status) && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-3">
            <Field label={t('hotel.amount')}>
              <Input inputMode="decimal" value={f.amount} onChange={set('amount')} />
            </Field>
            <Field label={t('res.deposit.mode')}>
              <Select value={f.modeId} onChange={set('modeId')}>
                <option value="">{t('res.deposit.chooseMode')}</option>
                {usable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              className="self-end"
              disabled={act.isPending || !f.modeId || !(Number(f.amount) > 0)}
              onClick={() => go('advance', { modeId: f.modeId, amount: Math.round(Number(f.amount) * 100) })}
            >
              {t('hotel.takeAdvance')}
            </Button>
          </div>
        )}
        {canSell && e.status === 'QUOTED' && (
          <Button
            variant="primary"
            disabled={act.isPending || e.advance.paid < e.advance.needed}
            onClick={() => go('confirm')}
          >
            {t('bq.confirm')}
          </Button>
        )}
        {e.status === 'CONFIRMED' && (
          <>
            <section className="space-y-2 rounded-control border p-3">
              <h3 className="text-sm font-semibold">
                {t('bq.beo', { version: e.beoVersion })}{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  {e.beoSentAt ? t('bq.beoSent') : t('bq.beoNotSent')}
                </span>
              </h3>
              {(['kitchen', 'service', 'housekeeping'] as const).map((k) => (
                <Field key={k} label={t(`bq.dept.${k}`)}>
                  <Textarea rows={2} value={f[k]} disabled={!canSell} onChange={set(k)} />
                </Field>
              ))}
              {canSell && (
                <Button
                  size="sm"
                  disabled={act.isPending}
                  onClick={() =>
                    go('beo', {
                      kitchen: f.kitchen,
                      service: f.service,
                      housekeeping: f.housekeeping,
                      send: true,
                    })
                  }
                >
                  {t('bq.sendBeo')}
                </Button>
              )}
            </section>
            {e.indent.length > 0 && (
              <section className="space-y-1 text-sm">
                <h3 className="font-semibold">{t('bq.indent')}</h3>
                {e.indent.map((i) => (
                  <div key={i.itemId} className="flex justify-between gap-3">
                    <span>{i.name}</span>
                    <span className="tabular">
                      {i.need} {i.unit}
                      {i.short > 0 ? ` · ${t('bq.short', { qty: i.short, unit: i.unit })}` : ''}
                    </span>
                  </div>
                ))}
              </section>
            )}
            <section className="space-y-1 text-sm">
              <h3 className="font-semibold">{t('bq.checklist')}</h3>
              {e.checklist.map((c, i) => (
                <label key={i} className="flex min-h-9 items-center gap-2">
                  <Checkbox
                    checked={c.done}
                    disabled={!canSell || act.isPending}
                    onChange={(ev) => go('checklist', { index: i, done: ev.target.checked })}
                  />
                  {c.text}
                </label>
              ))}
            </section>
            {canSell && (
              <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-[1fr_auto]">
                <Field label={t('bq.actual')}>
                  <Input inputMode="numeric" value={f.actual} onChange={set('actual')} />
                </Field>
                <Button
                  size="sm"
                  variant="primary"
                  className="self-end"
                  disabled={act.isPending || !e.checklist.every((c) => c.done) || f.actual === ''}
                  onClick={() => go('complete', { actualCovers: Number(f.actual) })}
                >
                  {t('bq.complete')}
                </Button>
              </div>
            )}
          </>
        )}
        {e.status === 'COMPLETED' && canSell && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-[1fr_auto]">
            <Field label={t('res.deposit.mode')}>
              <Select value={f.modeId} onChange={set('modeId')}>
                <option value="">{t('res.deposit.chooseMode')}</option>
                {usable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || (due > 0 && !f.modeId)}
              onClick={() => go('settle', { payments: due > 0 ? [{ modeId: f.modeId, amount: due }] : [] })}
            >
              {due > 0 ? t('hotel.folio.payClose', { amount: rupees(due) }) : t('bq.close')}
            </Button>
          </div>
        )}
        {canSell && ['ENQUIRY', 'QUOTED', 'CONFIRMED'].includes(e.status) && (
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Field label={t('res.reason')}>
              <Input value={f.reason} onChange={set('reason')} />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              className="self-end"
              disabled={act.isPending || f.reason.trim().length < 3}
              onClick={() => go('end', { reason: f.reason })}
            >
              {e.status === 'CONFIRMED' ? t('bq.cancel') : t('bq.lost')}
            </Button>
          </div>
        )}
        {e.note && <p className="text-sm text-status-warn-fg">{e.note}</p>}
      </div>
    </Dialog>
  );
}
