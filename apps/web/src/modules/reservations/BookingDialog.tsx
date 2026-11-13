import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RESERVATION_SOURCES } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';
import { send, useResMutation, useSlots, type Book, type Res } from './api';

/** Make a booking, or change one: the free times for the day and party, the best table unless one is chosen. */
export function BookingDialog({ book, edit, onClose }: { book: Book; edit?: Res; onClose: () => void }) {
  const { t } = useTranslation();
  const [day, setDay] = useState(edit?.day ?? book.day);
  const [size, setSize] = useState(String(edit?.partySize ?? 2));
  const [startMin, setStartMin] = useState<number | null>(edit?.startMin ?? null);
  const [tableId, setTableId] = useState('');
  const [name, setName] = useState(edit?.guest?.name ?? '');
  const [mobile, setMobile] = useState(edit?.guest?.mobile ?? '');
  const [occasion, setOccasion] = useState(edit?.occasion ?? '');
  const [requests, setRequests] = useState(edit?.requests ?? '');
  const [source, setSource] = useState<string>(edit?.source ?? 'PHONE');
  const party = Math.max(0, Math.floor(Number(size)));
  const slots = useSlots(book.outlet.id, day, party, edit?.id);
  const save = useResMutation(
    () =>
      edit
        ? send<Res>(
            `/api/reservations/${edit.id}`,
            {
              day,
              startMin,
              partySize: party,
              occasion: occasion || null,
              requests: requests || null,
              ...(tableId ? { tableIds: [tableId] } : {}),
            },
            'PATCH',
          )
        : send<Res>('/api/reservations', {
            outletId: book.outlet.id,
            day,
            startMin,
            partySize: party,
            guest: { name, mobile },
            occasion: occasion || null,
            requests: requests || null,
            source,
            ...(tableId ? { tableIds: [tableId] } : {}),
          }),
    (r) => t('res.saved', { number: r.number, tables: r.tables.join(' + ') }),
  );
  const ready = party > 0 && startMin !== null && (edit || (name.trim() && mobile.trim().length >= 8));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={edit ? t('res.change', { number: edit.number }) : t('res.new')}
      footer={
        <Button
          variant="primary"
          disabled={!ready || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {edit ? t('common.save') : t('res.book')}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('res.day')}>
            <DateInput value={day} onChange={setDay} min={book.today} aria-label={t('res.day')} />
          </Field>
          <Field label={t('res.guests')}>
            <Input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium">{t('res.time')}</div>
          {slots.isPending && party > 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : (
            <div
              className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
              role="radiogroup"
              aria-label={t('res.time')}
            >
              {(slots.data?.slots ?? []).map((s) => (
                <button
                  key={s.startMin}
                  type="button"
                  role="radio"
                  aria-checked={startMin === s.startMin}
                  disabled={!s.free && startMin !== s.startMin}
                  onClick={() => setStartMin(s.startMin)}
                  className={cn(
                    'h-11 min-w-16 rounded-pill border px-3 text-sm font-medium tabular',
                    startMin === s.startMin
                      ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                      : 'bg-card',
                    !s.free && startMin !== s.startMin && 'opacity-40 line-through',
                  )}
                >
                  {s.time}
                </button>
              ))}
              {slots.data && !slots.data.slots.some((s) => s.free) && (
                <p className="text-sm text-muted-foreground">{t('res.noSlots')}</p>
              )}
            </div>
          )}
          {slots.data && slots.data.deposit > 0 && !edit && (
            <p className="mt-2 text-sm text-status-warn-fg">
              {t('res.depositNeeded', { amount: rupees(slots.data.deposit) })}
            </p>
          )}
        </div>
        <Field label={t('res.table')} hint={t('res.tableHint')}>
          <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
            <option value="">{t('res.bestFit')}</option>
            {book.tables.map((tb) => (
              <option key={tb.id} value={tb.id}>
                {t('res.tableSeats', { name: tb.name, seats: tb.seats })}
              </option>
            ))}
          </Select>
        </Field>
        {!edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('res.mobile')}>
              <Input inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Field>
            <Field label={t('res.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('res.occasion')}>
            <Input value={occasion} onChange={(e) => setOccasion(e.target.value)} />
          </Field>
          {!edit && (
            <Field label={t('res.source')}>
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                {RESERVATION_SOURCES.filter((s) => s !== 'ONLINE').map((s) => (
                  <option key={s} value={s}>
                    {t(`res.sources.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label={t('res.requests')}>
          <Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
