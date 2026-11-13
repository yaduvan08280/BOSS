import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { addDays } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';
import { dmy } from './api';

type Offer = {
  roomTypeId: string;
  room: string;
  sleeps: number;
  ratePlanId: string;
  plan: string;
  meal: string;
  nights: number;
  total: number;
};
type Page = {
  company: string;
  logoUrl: string | null;
  property: string;
  today: string;
  arrive: string;
  depart: string;
  adults: number;
  children: number;
  offers: Offer[];
  challenge: { question: string; token: string };
};
type Made = { number: string | null; total?: number; nights?: number };

/** A property's own booking page: no login; dates and guests, what can be sold with its price, the guest's details. */
export function PublicRoomsPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [dates, setDates] = useState<{ arrive: string; depart: string } | null>(null);
  const [adults, setAdults] = useState(2);
  const [pick, setPick] = useState<Offer | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [answer, setAnswer] = useState('');
  const [honey, setHoney] = useState('');
  const [challenge, setChallenge] = useState<Page['challenge'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const q = useQuery({
    queryKey: ['public-rooms', token, dates, adults],
    queryFn: () =>
      api<Page>(
        `/api/public/rooms/${token}?adults=${adults}${dates ? `&arrive=${dates.arrive}&depart=${dates.depart}` : ''}`,
      ),
    retry: false,
  });
  const page = q.data;
  const c = challenge ?? page?.challenge;
  const chosen =
    pick && page?.offers.find((o) => o.roomTypeId === pick.roomTypeId && o.ratePlanId === pick.ratePlanId);
  const submit = async () => {
    if (!page || !c || !chosen) return;
    setBusy(true);
    setMessage(null);
    try {
      setMade(
        await api<Made>(`/api/public/rooms/${token}`, {
          method: 'POST',
          body: {
            arrive: page.arrive,
            depart: page.depart,
            adults,
            roomTypeId: chosen.roomTypeId,
            ratePlanId: chosen.ratePlanId,
            name,
            mobile,
            challenge: c.token,
            answer: Number(answer),
            website: honey || undefined,
          },
        }),
      );
    } catch (e) {
      const details = (e instanceof ApiError ? e.details : null) as { challenge?: Page['challenge'] } | null;
      if (details?.challenge) {
        setChallenge(details.challenge);
        setAnswer('');
      }
      setMessage(e instanceof Error ? e.message : t('common.somethingWrong'));
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        {q.isError ? (
          <div className="rounded-card border bg-card p-6 text-center font-semibold">{t('book.closed')}</div>
        ) : !page ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : made ? (
          <div className="space-y-2 rounded-card border bg-card p-8 text-center">
            <CheckCircle2 className="mx-auto size-10 text-status-ok-fg" />
            <p className="text-lg font-semibold">{t('connect.rooms.booked')}</p>
            {made.number && (
              <p className="text-sm text-muted-foreground">
                {t('connect.rooms.yours', {
                  number: made.number,
                  property: page.property,
                  arrive: dmy(page.arrive),
                  depart: dmy(page.depart),
                  total: rupees(made.total ?? 0),
                })}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5 rounded-card border bg-card p-5 sm:p-7">
            <div className="flex items-center gap-3">
              {page.logoUrl && (
                <img src={page.logoUrl} alt="" className="size-10 rounded-control object-contain" />
              )}
              <div>
                <div className="text-xs text-muted-foreground">{page.company}</div>
                <h1 className="text-lg font-semibold">
                  {t('connect.rooms.title', { property: page.property })}
                </h1>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label={t('connect.rooms.arrive')}>
                <DateInput
                  value={page.arrive}
                  min={page.today}
                  onChange={(v) => {
                    if (!v) return;
                    setPick(null);
                    setDates({ arrive: v, depart: page.depart > v ? page.depart : addDays(v, 1) });
                  }}
                  aria-label={t('connect.rooms.arrive')}
                />
              </Field>
              <Field label={t('connect.rooms.depart')}>
                <DateInput
                  value={page.depart}
                  min={addDays(page.arrive, 1)}
                  onChange={(v) => {
                    if (!v) return;
                    setPick(null);
                    setDates({ arrive: page.arrive, depart: v });
                  }}
                  aria-label={t('connect.rooms.depart')}
                />
              </Field>
              <Field label={t('connect.rooms.adults')}>
                <Input
                  inputMode="numeric"
                  value={String(adults)}
                  onChange={(e) => {
                    setPick(null);
                    setAdults(Math.max(1, Math.min(20, Math.floor(Number(e.target.value)) || 1)));
                  }}
                />
              </Field>
            </div>
            <div className="space-y-2" role="radiogroup" aria-label={t('connect.rooms.choose')}>
              {page.offers.map((o) => {
                const on = chosen === o;
                return (
                  <button
                    key={`${o.roomTypeId}${o.ratePlanId}`}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPick(o)}
                    className={cn(
                      'flex min-h-14 w-full items-center justify-between gap-3 rounded-control border p-3 text-left',
                      on ? 'border-transparent bg-accent-soft text-accent-soft-foreground' : 'bg-card',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{o.room}</span>
                      <span className="block text-xs opacity-80">
                        {o.plan} · {t('connect.rooms.sleeps', { count: o.sleeps })}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular">{rupees(o.total)}</span>
                      <span className="block text-xs opacity-80">
                        {t('connect.rooms.nights', { count: o.nights })}
                      </span>
                    </span>
                  </button>
                );
              })}
              {page.offers.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('connect.rooms.none')}</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t('connect.rooms.taxNote')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('res.name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('res.mobile')}>
                <Input inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </Field>
            </div>
            {/* Honeypot: hidden from people, irresistible to bots. */}
            <input
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] size-px opacity-0"
              name="website"
              value={honey}
              onChange={(e) => setHoney(e.target.value)}
            />
            {c && (
              <Field label={t('fms.pub.sum', { q: c.question })}>
                <Input
                  inputMode="numeric"
                  className="w-28"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              </Field>
            )}
            {message && <p className="text-sm text-status-bad-fg">{message}</p>}
            <Button
              variant="primary"
              size="lg"
              disabled={busy || !answer || !chosen || !name.trim() || mobile.trim().length < 8}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="animate-spin" />} {t('connect.rooms.send')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
