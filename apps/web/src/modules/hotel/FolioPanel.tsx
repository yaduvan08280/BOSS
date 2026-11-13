import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useModes } from '@/modules/money/api';
import { rupees } from '@/modules/stock/api';
import { dmy, send, useHotelMutation, type Folio } from './api';

/** One folio of a stay: its lines, what it comes to, and closing it (an invoice, the advance used, the money taken). */
export function FolioPanel({
  folio,
  canDesk,
  guestFolio,
}: {
  folio: Folio;
  canDesk: boolean;
  guestFolio: boolean;
}) {
  const { t } = useTranslation();
  const modes = useModes();
  const [modeId, setModeId] = useState('');
  const [reference, setReference] = useState('');
  const [onCredit, setOnCredit] = useState(false);
  const usable = (modes.data ?? []).filter(
    (m) => m.active && !['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(m.kind),
  );
  const settle = useHotelMutation(
    () =>
      send<Folio>(`/api/hotel/folios/${folio.id}/settle`, {
        payments:
          !onCredit && folio.due > 0 ? [{ modeId, amount: folio.due, reference: reference || null }] : [],
        onCredit,
      }),
    (f) => t('hotel.folio.closed', { number: f.invoice?.number ?? '' }),
  );
  const open = folio.status === 'OPEN';
  const row = (label: string, amount: number, strong = false) => (
    <div className={cn('flex justify-between', strong && 'font-semibold')}>
      <dt className={strong ? '' : 'text-muted-foreground'}>{label}</dt>
      <dd className="tabular">{rupees(amount)}</dd>
    </div>
  );
  return (
    <section className="space-y-2 rounded-control border p-3" data-testid={`folio-${folio.no}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {t('hotel.folio.title', { no: folio.no, name: folio.name })}
        </h3>
        <StatusChip tone={open ? 'info' : 'neutral'}>{t(`hotel.folio.${folio.status}`)}</StatusChip>
      </div>
      {folio.lines.length === 0 && <p className="text-sm text-muted-foreground">{t('hotel.folio.empty')}</p>}
      <ul className="space-y-1 text-sm">
        {folio.lines.map((l) => (
          <li
            key={l.id}
            className={cn('flex justify-between gap-3', l.voided && 'text-muted-foreground line-through')}
          >
            <span className="min-w-0">
              <span className="text-xs text-muted-foreground">{dmy(l.day)} · </span>
              {l.text}
              {l.qty !== 1 ? ` × ${l.qty}` : ''}
            </span>
            <span className="tabular shrink-0">{rupees(l.kind === 'PAYMENT' ? -l.amount : l.amount)}</span>
          </li>
        ))}
      </ul>
      {folio.lines.length > 0 && (
        <dl className="space-y-1 border-t pt-2 text-sm">
          {row(t('hotel.folio.charges'), folio.charges)}
          {folio.tax > 0 && row(t('hotel.folio.tax'), folio.tax)}
          {folio.restaurant > 0 && row(t('hotel.folio.restaurant'), folio.restaurant)}
          {row(t('money.total'), folio.total, true)}
          {folio.paid > 0 && row(t('hotel.folio.paid'), -folio.paid)}
          {open && row(t('money.stillDue'), Math.max(0, folio.due), true)}
          {folio.invoice && (
            <div className="text-xs text-muted-foreground">
              {t('hotel.folio.invoice', { number: folio.invoice.number })}
              {folio.invoice.due > 0
                ? ` · ${t('hotel.folio.owed', { amount: rupees(folio.invoice.due) })}`
                : ''}
            </div>
          )}
        </dl>
      )}
      {open && canDesk && folio.lines.some((l) => !l.voided) && (
        <div className="space-y-2 border-t pt-2">
          {!guestFolio && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={onCredit} onChange={(e) => setOnCredit(e.target.checked)} />
              {t('hotel.folio.onCredit', { name: folio.name })}
            </label>
          )}
          {!onCredit && folio.due > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label={t('res.deposit.mode')}>
                <Select value={modeId} onChange={(e) => setModeId(e.target.value)}>
                  <option value="">{t('res.deposit.chooseMode')}</option>
                  {usable.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('res.deposit.reference')}>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
          )}
          <Button
            size="sm"
            variant="primary"
            disabled={settle.isPending || (!onCredit && folio.due > 0 && !modeId)}
            onClick={() => settle.mutate(undefined)}
          >
            {onCredit
              ? t('hotel.folio.billCompany')
              : folio.due > 0
                ? t('hotel.folio.payClose', { amount: rupees(folio.due) })
                : t('hotel.folio.close')}
          </Button>
        </div>
      )}
    </section>
  );
}
