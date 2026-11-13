import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { RoomType } from '@/modules/hosp/api';
import { rupees } from '@/modules/stock/api';
import { dmy, send, useHotelMutation, usePlans, useQuote } from './api';

/** A new booking: the plan, the room type, the dates and guests — priced night by night before it is made. */
export function NewBookingDialog({
  branchId,
  businessDate,
  types,
  onClose,
}: {
  branchId: string;
  businessDate: string;
  types: RoomType[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const plans = usePlans(branchId);
  const [planId, setPlanId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [arrive, setArrive] = useState(businessDate);
  const [depart, setDepart] = useState(addDays(businessDate, 1));
  const [adults, setAdults] = useState('2');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const plan = planId || plans.data?.find((p) => p.active)?.id || '';
  const type = typeId || types[0]?.id || '';
  const ready = plan && type && depart > arrive && Number(adults) > 0;
  const quote = useQuote(
    ready
      ? `ratePlanId=${plan}&roomTypeId=${type}&arrive=${arrive}&depart=${depart}&adults=${Number(adults)}`
      : null,
  );
  const book = useHotelMutation(
    () =>
      send<{ number: string }>('/api/hotel/stays', {
        branchId,
        ratePlanId: plan,
        roomTypeId: type,
        arrive,
        depart,
        adults: Number(adults),
        guest: { name, mobile },
      }),
    (r) => t('hotel.booked', { number: r.number }),
  );
  const q = quote.data;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('hotel.newBooking')}
      footer={
        <Button
          variant="primary"
          disabled={
            !ready || !name.trim() || mobile.trim().length < 8 || Boolean(q?.problem) || book.isPending
          }
          onClick={() => book.mutate(undefined, { onSuccess: onClose })}
        >
          {t('hotel.book')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('hotel.plan')}>
            <Select value={plan} onChange={(e) => setPlanId(e.target.value)}>
              {(plans.data ?? [])
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('hotel.roomType')}>
            <Select value={type} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('hotel.arrive')}>
            <DateInput
              value={arrive}
              min={businessDate}
              onChange={setArrive}
              aria-label={t('hotel.arrive')}
            />
          </Field>
          <Field label={t('hotel.depart')}>
            <DateInput value={depart} min={arrive} onChange={setDepart} aria-label={t('hotel.depart')} />
          </Field>
          <Field label={t('hotel.adults')}>
            <Input inputMode="numeric" value={adults} onChange={(e) => setAdults(e.target.value)} />
          </Field>
        </div>
        {q && (
          <div className="rounded-control bg-muted p-3 text-sm" data-testid="hotel-quote">
            {q.problem ? (
              <p className="text-status-bad-fg">
                {t(`hotel.problem.${q.problem}`, { day: q.soldOutOn ? dmy(q.soldOutOn) : '' })}
              </p>
            ) : (
              <p>{t('hotel.quote', { nights: q.nights.length, total: rupees(q.total), meal: q.meal })}</p>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('res.mobile')}>
            <Input inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
          </Field>
          <Field label={t('res.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
