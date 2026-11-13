import { PayLinkButton } from '@/modules/connect/PayLinkButton';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { Room } from '@/modules/hosp/api';
import { useModes } from '@/modules/money/api';
import { rupees } from '@/modules/stock/api';
import { dmy, send, STAY_TONE, useHotelMutation, useHotelRules, useStay } from './api';
import { FolioPanel } from './FolioPanel';

type Pane = 'none' | 'charge' | 'advance' | 'move' | 'dates' | 'request' | 'cancel';

/** One stay: its nights, its folios, and what the desk does to it — charges, an advance, a room move, more nights, check-out. */
export function StayDialog({
  id,
  branchId,
  rooms,
  canDesk,
  onClose,
}: {
  id: string;
  branchId: string;
  rooms: Room[];
  canDesk: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const stay = useStay(id);
  const rules = useHotelRules(branchId);
  const modes = useModes();
  const [pane, setPane] = useState<Pane>('none');
  const [f, setF] = useState({
    text: '',
    price: '',
    extra: '',
    modeId: '',
    amount: '',
    ref: '',
    roomId: '',
    reason: '',
    depart: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const done = () => setPane('none');
  const act = useHotelMutation(
    (x: { url: string; body?: object }) => send(`/api/hotel/stays/${id}/${x.url}`, x.body ?? {}),
    t('res.done'),
  );
  const s = stay.data;
  if (!s)
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title={t('hotel.stay')}>
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      </Dialog>
    );
  const inHouse = s.status === 'CHECKED_IN';
  const live = inHouse || s.status === 'BOOKED';
  const extras = rules.data?.rules.extras ?? [];
  const usable = (modes.data ?? []).filter(
    (m) => m.active && !['COMPANY', 'ROOM', 'COMPLIMENTARY'].includes(m.kind),
  );
  const go = (url: string, body?: object) => act.mutate({ url, body }, { onSuccess: done });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={`${s.guest?.name ?? ''} · ${s.number}`}
      description={t('hotel.stayLine', {
        arrive: dmy(s.arrive),
        depart: dmy(s.depart),
        nights: s.nights,
        type: s.roomType,
        meal: s.meal,
      })}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={STAY_TONE[s.status]}>{t(`hotel.status.${s.status}`)}</StatusChip>
          {s.room && <span className="text-sm font-medium">{t('hotel.inRoom', { room: s.room })}</span>}
          {s.formC && !s.formC.filedAt && <StatusChip tone="warn">{t('hotel.formCDue')}</StatusChip>}
        </div>
        <ul className="flex flex-wrap gap-2 text-xs">
          {s.nightly.map((n) => (
            <li key={n.day} className="rounded-control bg-muted px-2 py-1">
              {dmy(n.day)} · {n.room ?? '—'} · {rupees(n.rate)}
              {n.posted ? ' ✓' : ''}
            </li>
          ))}
        </ul>
        {canDesk && live && (
          <div className="flex flex-wrap gap-2">
            {inHouse && (
              <>
                <Button size="sm" onClick={() => setPane('charge')}>
                  {t('hotel.addCharge')}
                </Button>
                <Button size="sm" onClick={() => setPane('move')}>
                  {t('hotel.moveRoom')}
                </Button>
                <Button size="sm" onClick={() => setPane('request')}>
                  {t('hotel.request')}
                </Button>
              </>
            )}
            <Button size="sm" onClick={() => setPane('advance')}>
              {t('hotel.takeAdvance')}
            </Button>
            <Button size="sm" onClick={() => setPane('dates')}>
              {t('hotel.changeDates')}
            </Button>
            {s.status === 'BOOKED' && (
              <Button size="sm" variant="ghost" onClick={() => setPane('cancel')}>
                {t('hotel.cancel')}
              </Button>
            )}
            {inHouse && (
              <Button size="sm" variant="primary" disabled={act.isPending} onClick={() => go('check-out')}>
                {t('hotel.checkOut')}
              </Button>
            )}
          </div>
        )}
        {pane === 'charge' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-3">
            <Field label={t('hotel.extra')}>
              <Select value={f.extra} onChange={set('extra')}>
                <option value="">{t('hotel.typed')}</option>
                {extras.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.name} · {rupees(e.price)}
                  </option>
                ))}
              </Select>
            </Field>
            {!f.extra && (
              <>
                <Field label={t('hotel.what')}>
                  <Input value={f.text} onChange={set('text')} />
                </Field>
                <Field label={t('hotel.price')}>
                  <Input inputMode="decimal" value={f.price} onChange={set('price')} />
                </Field>
              </>
            )}
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || (!f.extra && (!f.text.trim() || !(Number(f.price) > 0)))}
              onClick={() =>
                go(
                  'charges',
                  f.extra
                    ? { extraKey: f.extra }
                    : { text: f.text, price: Math.round(Number(f.price) * 100) },
                )
              }
            >
              {t('hotel.post')}
            </Button>
          </div>
        )}
        {pane === 'advance' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-4">
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
            <Field label={t('res.deposit.reference')}>
              <Input value={f.ref} onChange={set('ref')} />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || !f.modeId || !(Number(f.amount) > 0)}
              onClick={() =>
                go('advance', {
                  modeId: f.modeId,
                  amount: Math.round(Number(f.amount) * 100),
                  reference: f.ref || null,
                })
              }
            >
              {t('hotel.takeAdvance')}
            </Button>
            <div className="sm:col-span-4">
              <PayLinkButton
                purpose="STAY_ADVANCE"
                refId={id}
                amount={Number(f.amount) > 0 ? Math.round(Number(f.amount) * 100) : undefined}
              />
            </div>
          </div>
        )}
        {pane === 'move' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-3">
            <Field label={t('hotel.room')}>
              <Select value={f.roomId} onChange={set('roomId')}>
                <option value="">{t('hotel.chooseRoom')}</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('hotel.why')}>
              <Input value={f.reason} onChange={set('reason')} />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || !f.roomId}
              onClick={() => go('room', { roomId: f.roomId, reason: f.reason || null })}
            >
              {t('hotel.moveRoom')}
            </Button>
          </div>
        )}
        {pane === 'dates' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-2">
            <Field label={t('hotel.depart')}>
              <DateInput
                value={f.depart || s.depart}
                min={s.arrive}
                onChange={(v) => setF((x) => ({ ...x, depart: v }))}
                aria-label={t('hotel.depart')}
              />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || !f.depart || f.depart === s.depart}
              onClick={() => go('dates', { depart: f.depart })}
            >
              {t('common.save')}
            </Button>
          </div>
        )}
        {pane === 'request' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-[1fr_auto]">
            <Field label={t('hotel.requestWhat')}>
              <Input value={f.text} onChange={set('text')} />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending || f.text.trim().length < 3}
              onClick={() => go('request', { text: f.text })}
            >
              {t('hotel.raise')}
            </Button>
          </div>
        )}
        {pane === 'cancel' && (
          <div className="grid gap-2 rounded-control bg-muted p-3 sm:grid-cols-[1fr_auto]">
            <Field label={t('res.reason')}>
              <Input value={f.reason} onChange={set('reason')} />
            </Field>
            <Button
              size="sm"
              variant="primary"
              className="self-end"
              disabled={act.isPending}
              onClick={() => go('cancel', { reason: f.reason || null })}
            >
              {t('hotel.cancelIt')}
            </Button>
          </div>
        )}
        {s.folios.map((folio) => (
          <FolioPanel key={folio.id} folio={folio} canDesk={canDesk} guestFolio={folio.no === 1} />
        ))}
      </div>
    </Dialog>
  );
}
