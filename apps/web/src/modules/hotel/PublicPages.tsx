import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { slotLabel } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import { rupees } from '@/modules/stock/api';

type Voucher = {
  hotel: string;
  number: string;
  status: string;
  name: string;
  arrive: string;
  depart: string;
  adults: number;
  roomType: string;
  meal: string;
  total: number;
  checkIn: number;
  checkOut: number;
};
/** The guest's booking voucher: no sign-in. */
export function StayVoucherPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['public-stay', token],
    queryFn: () => api<Voucher>(`/api/public/stay/${token}`),
    retry: false,
  });
  const v = q.data;
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-3 rounded-card border bg-card p-6">
        {q.isError ? (
          <p className="text-center font-semibold">{t('book.notFound')}</p>
        ) : !v ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : (
          <>
            <div className="text-xs text-muted-foreground">{v.hotel}</div>
            <h1 className="text-lg font-semibold">{t('hotel.voucher.title', { number: v.number })}</h1>
            <dl className="space-y-1 text-sm">
              {[
                [t('res.name'), v.name],
                [t('hotel.arrive'), `${v.arrive} · ${slotLabel(v.checkIn)}`],
                [t('hotel.depart'), `${v.depart} · ${slotLabel(v.checkOut)}`],
                [t('hotel.roomType'), `${v.roomType} · ${t(`hotel.meal.${v.meal}`)}`],
                [t('hotel.adults'), String(v.adults)],
                [t('hotel.voucher.total'), rupees(v.total)],
                [t('hotel.voucher.status'), t(`hotel.status.${v.status}`)],
              ].map(([k, val]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

/** The page behind the QR in a room: the guest asks for something; it reaches the staff as a ticket. */
export function RoomRequestPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['public-room', token],
    queryFn: () => api<{ hotel: string; room: string; minutes: number }>(`/api/public/room/${token}`),
    retry: false,
  });
  const [text, setText] = useState('');
  const [honey, setHoney] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const r = q.data;
  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/api/public/room/${token}/request`, {
        method: 'POST',
        body: { text, website: honey || undefined },
      });
      setSent(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-4 rounded-card border bg-card p-6">
        {q.isError ? (
          <p className="text-center font-semibold">{t('hotel.qr.notFound')}</p>
        ) : !r ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : sent ? (
          <div className="space-y-2 text-center">
            <CheckCircle2 className="mx-auto size-10 text-status-ok-fg" />
            <p className="font-semibold">{t('hotel.qr.sent', { minutes: r.minutes })}</p>
            <Button
              onClick={() => {
                setSent(false);
                setText('');
              }}
            >
              {t('hotel.qr.another')}
            </Button>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">{r.hotel}</div>
            <h1 className="text-lg font-semibold">{t('hotel.qr.title', { room: r.room })}</h1>
            <Field label={t('hotel.qr.what')}>
              <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] size-px opacity-0"
              name="website"
              value={honey}
              onChange={(e) => setHoney(e.target.value)}
            />
            {message && <p className="text-sm text-status-bad-fg">{message}</p>}
            <Button
              variant="primary"
              size="lg"
              disabled={busy || text.trim().length < 3}
              onClick={() => void submit()}
            >
              {t('hotel.qr.send')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
