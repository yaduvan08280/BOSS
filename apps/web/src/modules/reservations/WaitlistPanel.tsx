import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { send, useQuote, useResMutation, useWaitlist, type Book, type Wait } from './api';

/** The waitlist: a walk-in is quoted a wait, called when the table is ready, and seated from here. */
export function WaitlistPanel({ book, canHost }: { book: Book; canHost: boolean }) {
  const { t } = useTranslation();
  const list = useWaitlist(book.outlet.id);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [size, setSize] = useState('2');
  const [seat, setSeat] = useState<Wait | null>(null);
  const [tableId, setTableId] = useState('');
  const party = Math.max(0, Math.floor(Number(size)));
  const quote = useQuote(book.outlet.id, party);
  const join = useResMutation(
    () =>
      send<Wait>('/api/reservations/waitlist', {
        outletId: book.outlet.id,
        partySize: party,
        name,
        mobile: mobile || null,
      }),
    (w) => t('res.wait.added', { name: w.name, minutes: w.quotedMin ?? 0 }),
  );
  const act = useResMutation(
    (x: { id: string; action: string; tableIds?: string[] }) =>
      send(`/api/reservations/waitlist/${x.id}/act`, { action: x.action, tableIds: x.tableIds }),
    t('res.done'),
  );
  const minutes = quote.data?.minutes;
  return (
    <div className="space-y-5">
      {canHost && (
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t('res.wait.add')}</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label={t('res.name')} className="sm:col-span-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('res.mobile')}>
              <Input inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Field>
            <Field label={t('res.guests')}>
              <Input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" data-testid="wait-quote">
              {minutes === undefined
                ? ''
                : minutes === null
                  ? t('res.wait.noTable', { size: party })
                  : minutes === 0
                    ? t('res.wait.now')
                    : t('res.wait.quote', { minutes })}
            </p>
            <Button
              variant="primary"
              disabled={!name.trim() || party < 1 || minutes === null || join.isPending}
              onClick={() =>
                join.mutate(undefined, {
                  onSuccess: () => {
                    setName('');
                    setMobile('');
                  },
                })
              }
            >
              {t('res.wait.join')}
            </Button>
          </div>
        </Card>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          {t('res.wait.waiting', { count: list.data?.waiting.length ?? 0 })}
        </h2>
        {list.data?.waiting.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('res.wait.nobody')}</p>
        )}
        <ul className="space-y-2">
          {(list.data?.waiting ?? []).map((w) => (
            <li key={w.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {w.name} · {t('res.forN', { count: w.partySize })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('res.wait.waited', { waited: w.waitedMin, quoted: w.quotedMin ?? 0 })}
                    {w.mobile ? ` · ${w.mobile}` : ''}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {w.status === 'CALLED' && <StatusChip tone="info">{t('res.wait.called')}</StatusChip>}
                  {canHost && (
                    <>
                      {w.status === 'WAITING' && (
                        <Button size="sm" onClick={() => act.mutate({ id: w.id, action: 'call' })}>
                          {t('res.wait.call')}
                        </Button>
                      )}
                      <Button size="sm" variant="primary" onClick={() => setSeat(w)}>
                        {t('res.seat')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act.mutate({ id: w.id, action: 'leave' })}
                      >
                        {t('res.wait.left')}
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      {(list.data?.earlier.length ?? 0) > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('res.wait.earlier')}</h2>
          <ul className="text-sm text-muted-foreground">
            {list.data!.earlier.slice(0, 20).map((w) => (
              <li key={w.id}>
                {w.name} · {w.partySize} · {t(`res.wait.status.${w.status}`)} · {w.waitedMin} min
              </li>
            ))}
          </ul>
        </section>
      )}
      {seat && (
        <Dialog
          open
          onOpenChange={(o) => !o && setSeat(null)}
          title={t('res.wait.seatTitle', { name: seat.name })}
          footer={
            <Button
              variant="primary"
              disabled={!tableId || act.isPending}
              onClick={() =>
                act.mutate(
                  { id: seat.id, action: 'seat', tableIds: [tableId] },
                  { onSuccess: () => setSeat(null) },
                )
              }
            >
              {t('res.seat')}
            </Button>
          }
        >
          <Field label={t('res.table')}>
            <Select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              <option value="">{t('res.chooseTable')}</option>
              {book.tables.map((tb) => (
                <option key={tb.id} value={tb.id}>
                  {t('res.tableSeats', { name: tb.name, seats: tb.seats })}
                </option>
              ))}
            </Select>
          </Field>
        </Dialog>
      )}
    </div>
  );
}
