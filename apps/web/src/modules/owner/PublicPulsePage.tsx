import { Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { cn } from '@/lib/utils';

type Page = { outlet: string; company: string };

/** The guest's ten-second rating, opened from the QR on the table or the bill. No sign-in. */
export function PublicPulsePage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const [page, setPage] = useState<Page | null | 'gone'>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [billNo, setBillNo] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'ask' | 'sending' | 'done' | 'failed'>('ask');

  useEffect(() => {
    let live = true;
    fetch(`/api/public/pulse/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Page>) : Promise.reject(new Error('gone'))))
      .then((p) => live && setPage(p))
      .catch(() => live && setPage('gone'));
    return () => {
      live = false;
    };
  }, [token]);

  const send = async () => {
    setState('sending');
    const res = await fetch(`/api/public/pulse/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stars,
        comment: comment || null,
        billNo: billNo || null,
        website: website || undefined,
      }),
    }).catch(() => null);
    setState(res?.ok ? 'done' : 'failed');
  };

  const shell = (children: React.ReactNode) => (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 bg-background p-5 text-foreground">
      {children}
    </main>
  );
  if (page === null) return shell(<p className="text-center text-muted-foreground">{t('common.loading')}</p>);
  if (page === 'gone') return shell(<p className="text-center">{t('pulse.gone')}</p>);
  if (state === 'done')
    return shell(
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold">{t('pulse.thanks')}</h1>
        <p className="text-muted-foreground">
          {t(stars <= 2 ? 'pulse.thanksLow' : 'pulse.thanksHigh', { outlet: page.outlet })}
        </p>
      </div>,
    );
  return shell(
    <>
      <header className="text-center">
        <div className="text-sm text-muted-foreground">{page.company}</div>
        <h1 className="text-2xl font-semibold">{t('pulse.title', { outlet: page.outlet })}</h1>
      </header>
      <div className="flex justify-center gap-1.5" role="radiogroup" aria-label={t('pulse.stars')}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={t('pulse.nStars', { count: n })}
            onClick={() => setStars(n)}
            className="grid size-14 place-items-center rounded-full"
          >
            <Star
              className={cn('size-10', n <= stars ? 'fill-primary text-primary' : 'text-muted-foreground')}
            />
          </button>
        ))}
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">
          {t(stars > 0 && stars <= 2 ? 'pulse.whatWrong' : 'pulse.anything')}
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
          rows={3}
          className="w-full rounded-control border bg-card p-3 text-base"
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t('pulse.bill')}</span>
        <input
          value={billNo}
          onChange={(e) => setBillNo(e.target.value)}
          maxLength={40}
          className="h-12 w-full rounded-control border bg-card px-3 text-base"
        />
      </label>
      {/* Hidden from people; robots fill it in and are ignored. */}
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0"
      />
      <button
        type="button"
        disabled={!stars || state === 'sending'}
        onClick={() => void send()}
        className="h-12 rounded-control bg-primary font-semibold text-primary-foreground disabled:opacity-50"
      >
        {t('pulse.send')}
      </button>
      {state === 'failed' && <p className="text-center text-sm text-status-bad-fg">{t('pulse.failed')}</p>}
    </>,
  );
}
