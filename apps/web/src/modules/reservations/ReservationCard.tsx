import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useModes } from '@/modules/money/api';
import { rupees } from '@/modules/stock/api';
import { send, STATUS_TONE, useResMutation, type Res } from './api';

const OPEN = ['REQUESTED', 'CONFIRMED', 'REMINDED', 'ARRIVED'];

/** One booking in the book: who, when, where, its deposit, and what a host can do next. */
export function ReservationCard({ r, canHost, onEdit }: { r: Res; canHost: boolean; onEdit: () => void }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const act = useResMutation(
    (x: { action: string; reason?: string }) => send<Res>(`/api/reservations/${r.id}/act`, x),
    (o) => t(`res.status.${o.status}`),
  );
  const refund = useResMutation(
    () => send(`/api/reservations/${r.id}/deposit/refund`, {}),
    t('res.deposit.refunded'),
  );
  const live = OPEN.includes(r.status);
  const due = r.deposit?.state === 'DUE';
  return (
    <Card className="space-y-2 p-3" data-testid={`res-${r.number}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-lg font-semibold">{r.time}</span>
            <span className="font-medium">{r.guest?.name}</span>
            <span className="text-sm text-muted-foreground">{t('res.forN', { count: r.partySize })}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{r.number}</span> · {r.tables.join(' + ') || t('res.noTable')} ·{' '}
            {r.guest?.mobile} · {t(`res.sources.${r.source}`)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={STATUS_TONE[r.status]}>{t(`res.status.${r.status}`)}</StatusChip>
          {r.deposit && (
            <StatusChip tone={due ? 'warn' : 'neutral'}>
              {t(`res.deposit.state.${r.deposit.state}`, { amount: rupees(r.deposit.amount) })}
            </StatusChip>
          )}
        </div>
      </div>
      {(r.occasion || r.requests || r.guest?.allergies || (r.guest?.tags.length ?? 0) > 0) && (
        <p className="text-sm">
          {[
            ...(r.guest?.tags ?? []),
            r.occasion,
            r.requests,
            r.guest?.allergies ? t('res.allergies', { what: r.guest.allergies }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {canHost && (
        <div className="flex flex-wrap gap-2">
          {due && live && (
            <Button size="sm" variant="primary" onClick={() => setPaying(true)}>
              {t('res.deposit.take', { amount: rupees(r.deposit!.amount) })}
            </Button>
          )}
          {r.status === 'REQUESTED' && !due && (
            <Button size="sm" variant="primary" onClick={() => act.mutate({ action: 'confirm' })}>
              {t('res.confirm')}
            </Button>
          )}
          {(r.status === 'CONFIRMED' || r.status === 'REMINDED') && (
            <Button size="sm" onClick={() => act.mutate({ action: 'arrive' })}>
              {t('res.arrived')}
            </Button>
          )}
          {['CONFIRMED', 'REMINDED', 'ARRIVED'].includes(r.status) && (
            <Button size="sm" variant="primary" onClick={() => act.mutate({ action: 'seat' })}>
              {t('res.seat')}
            </Button>
          )}
          {(r.status === 'CONFIRMED' || r.status === 'REMINDED') && (
            <Button size="sm" variant="ghost" onClick={() => act.mutate({ action: 'noShow' })}>
              {t('res.noShow')}
            </Button>
          )}
          {r.status === 'NO_SHOW' && (
            <Button size="sm" onClick={() => act.mutate({ action: 'restore' })}>
              {t('res.restore')}
            </Button>
          )}
          {live && (
            <>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                {t('res.edit')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelling(true)}>
                {t('common.cancel')}
              </Button>
            </>
          )}
          {r.status === 'SEATED' && r.orderId && (
            <Button size="sm" onClick={() => nav('/hosp/pos')}>
              {t('res.openPos')}
            </Button>
          )}
          {(r.deposit?.state === 'REFUND_DUE' || r.deposit?.state === 'KEPT') && (
            <Button size="sm" disabled={refund.isPending} onClick={() => refund.mutate(undefined)}>
              {t('res.deposit.refund', { amount: rupees(r.deposit.amount) })}
            </Button>
          )}
        </div>
      )}
      {paying && <DepositDialog r={r} onClose={() => setPaying(false)} />}
      {cancelling && (
        <Dialog
          open
          onOpenChange={(o) => !o && setCancelling(false)}
          title={t('res.cancelTitle', { number: r.number })}
          footer={
            <Button
              variant="primary"
              disabled={act.isPending}
              onClick={() =>
                act.mutate(
                  { action: 'cancel', reason: reason || undefined },
                  { onSuccess: () => setCancelling(false) },
                )
              }
            >
              {t('res.cancelIt')}
            </Button>
          }
        >
          <Field label={t('res.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Dialog>
      )}
    </Card>
  );
}

/** The deposit was paid: how, and its reference. */
function DepositDialog({ r, onClose }: { r: Res; onClose: () => void }) {
  const { t } = useTranslation();
  const modes = useModes();
  const [modeId, setModeId] = useState('');
  const [reference, setReference] = useState('');
  const usable = (modes.data ?? []).filter((m) => !['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(m.kind));
  const pay = useResMutation(
    () => send(`/api/reservations/${r.id}/deposit`, { modeId, reference: reference || null }),
    t('res.deposit.paid'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('res.deposit.title', { amount: rupees(r.deposit?.amount ?? 0) })}
      description={t('res.deposit.body')}
      footer={
        <Button
          variant="primary"
          disabled={!modeId || pay.isPending}
          onClick={() => pay.mutate(undefined, { onSuccess: onClose })}
        >
          {t('res.deposit.record')}
        </Button>
      }
    >
      <div className="space-y-3">
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
    </Dialog>
  );
}
