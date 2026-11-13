import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Checkbox, Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { rupees } from '@/modules/stock/api';

type Page = {
  company: string;
  logoUrl: string | null;
  outlet: string;
  today: string;
  lastDay: string;
  maxOnline: number;
  day: string;
  size: number;
  deposit: number;
  slots: { startMin: number; time: string; free: boolean }[];
  challenge: { question: string; token: string };
};
type Made = { number: string | null; status?: string; when?: string; deposit?: number; manage?: string };

/** The public booking page of an outlet: no login; free times, the guest's details, a sum instead of a captcha. */
export function PublicBookPage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const [day, setDay] = useState('');
  const [size, setSize] = useState(2);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [requests, setRequests] = useState('');
  const [marketing, setMarketing] = useState(false);
  const [answer, setAnswer] = useState('');
  const [honey, setHoney] = useState('');
  const [challenge, setChallenge] = useState<Page['challenge'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const q = useQuery({
    queryKey: ['public-book', token, day, size],
    queryFn: () => api<Page>(`/api/public/book/${token}?size=${size}${day ? `&day=${day}` : ''}`),
    retry: false,
  });
  const page = q.data;
  const c = challenge ?? page?.challenge;
  const submit = async () => {
    if (!page || !c || startMin === null) return;
    setBusy(true);
    setMessage(null);
    try {
      setMade(
        await api<Made>(`/api/public/book/${token}`, {
          method: 'POST',
          body: {
            day: page.day,
            startMin,
            partySize: size,
            name,
            mobile,
            requests: requests || null,
            marketing,
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
            <p className="text-lg font-semibold">
              {made.status === 'CONFIRMED' ? t('book.confirmed') : t('book.received')}
            </p>
            {made.number && (
              <p className="text-sm text-muted-foreground">
                {t('book.yours', { number: made.number, when: made.when, outlet: page.outlet })}
              </p>
            )}
            {(made.deposit ?? 0) > 0 && (
              <p className="text-sm text-status-warn-fg">
                {t('book.depositDue', { amount: rupees(made.deposit!) })}
              </p>
            )}
            {made.manage && (
              <a className="text-sm underline" href={`/book/manage/${made.manage}`}>
                {t('book.manage')}
              </a>
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
                <h1 className="text-lg font-semibold">{t('book.title', { outlet: page.outlet })}</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('res.day')}>
                <DateInput
                  value={page.day}
                  min={page.today}
                  max={page.lastDay}
                  onChange={(v) => {
                    setDay(v);
                    setStartMin(null);
                  }}
                  aria-label={t('res.day')}
                />
              </Field>
              <Field label={t('res.guests')}>
                <Input
                  inputMode="numeric"
                  value={String(size)}
                  onChange={(e) => {
                    setSize(Math.max(1, Math.min(page.maxOnline, Math.floor(Number(e.target.value)) || 1)));
                    setStartMin(null);
                  }}
                />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{t('book.larger', { max: page.maxOnline })}</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('res.time')}>
              {page.slots
                .filter((s) => s.free)
                .map((s) => (
                  <button
                    key={s.startMin}
                    type="button"
                    role="radio"
                    aria-checked={startMin === s.startMin}
                    onClick={() => setStartMin(s.startMin)}
                    className={cn(
                      'h-11 min-w-16 rounded-pill border px-3 text-sm font-medium tabular',
                      startMin === s.startMin
                        ? 'border-transparent bg-accent-soft text-accent-soft-foreground'
                        : 'bg-card',
                    )}
                  >
                    {s.time}
                  </button>
                ))}
              {!page.slots.some((s) => s.free) && (
                <p className="text-sm text-muted-foreground">{t('res.noSlots')}</p>
              )}
            </div>
            {page.deposit > 0 && (
              <p className="text-sm text-status-warn-fg">
                {t('res.depositNeeded', { amount: rupees(page.deposit) })}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('res.name')}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t('res.mobile')}>
                <Input inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </Field>
            </div>
            <Field label={t('res.requests')}>
              <Textarea rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} />
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
              {t('book.offers', { company: page.company })}
            </label>
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
              disabled={busy || !answer || startMin === null || !name.trim() || mobile.trim().length < 8}
              onClick={() => void submit()}
            >
              {busy && <Loader2 className="animate-spin" />} {t('book.send')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

type Mine = {
  outlet: string;
  number: string;
  status: string;
  day: string;
  time: string;
  partySize: number;
  name: string;
  deposit: { amount: number; state: string } | null;
  canCancel: boolean;
  cancelFreeHours: number;
};
/** The guest's own link: the booking, and cancelling it. */
export function PublicManagePage() {
  const { t } = useTranslation();
  const { token } = useParams();
  const q = useQuery({
    queryKey: ['public-booking', token],
    queryFn: () => api<Mine>(`/api/public/booking/${token}`),
    retry: false,
  });
  const [busy, setBusy] = useState(false);
  const b = q.data;
  const cancel = async () => {
    setBusy(true);
    try {
      await api(`/api/public/booking/${token}/cancel`, { method: 'POST', body: {} });
    } finally {
      setBusy(false);
      void q.refetch();
    }
  };
  return (
    <div className="min-h-dvh bg-background px-4 py-8">
      <div className="mx-auto max-w-md space-y-3 rounded-card border bg-card p-6 text-center">
        {q.isError ? (
          <p className="font-semibold">{t('book.notFound')}</p>
        ) : !b ? (
          <Loader2 className="mx-auto animate-spin" />
        ) : (
          <>
            <div className="text-xs text-muted-foreground">{b.outlet}</div>
            <h1 className="text-lg font-semibold">
              {t('book.yours', {
                number: b.number,
                when: `${b.day.split('-').reverse().join('/')} ${b.time}`,
                outlet: b.outlet,
              })}
            </h1>
            <p className="text-sm">
              {b.name} · {t('res.forN', { count: b.partySize })} · {t(`res.status.${b.status}`)}
            </p>
            {b.deposit && (
              <p className="text-sm text-muted-foreground">
                {t(`res.deposit.state.${b.deposit.state}`, { amount: rupees(b.deposit.amount) })}
              </p>
            )}
            {b.canCancel && (
              <>
                <p className="text-xs text-muted-foreground">
                  {t('book.cancelRule', { hours: b.cancelFreeHours })}
                </p>
                <Button disabled={busy} onClick={() => void cancel()}>
                  {t('book.cancel')}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
