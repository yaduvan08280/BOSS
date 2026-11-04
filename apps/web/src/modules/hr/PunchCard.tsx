import { Camera, Loader2, LogIn, LogOut, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDateTime } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { hm, hrApi, STATUS_TONE, type MonthView } from './api';

type Queued = { type: 'IN' | 'OUT'; at: string; lat?: number; lng?: number; accuracy?: number };
const QUEUE = 'mono.punchQueue';
const readQueue = (): Queued[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? '[]') as Queued[];
  } catch {
    return [];
  }
};
const writeQueue = (q: Queued[]) => {
  try {
    localStorage.setItem(QUEUE, JSON.stringify(q));
  } catch {
    // Private mode: the punch just isn't kept for later.
  }
};

/** Where the phone is (10 s at most); no position is fine — the rules decide what that means. */
function position(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    ),
  );
}

/** Punch in / out (CLAUDE.md §9.2): GPS, a selfie when the rules ask, and a queue for punches made offline. */
export function PunchCard({ month, tz }: { month: MonthView; tz: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(readQueue().length);
  const selfieInput = useRef<HTMLInputElement>(null);
  const last = month.punches.at(-1);
  const next: 'IN' | 'OUT' = last?.type === 'IN' ? 'OUT' : 'IN';
  const qc = useQueryClient();
  const refresh = useCallback(() => void qc.invalidateQueries({ queryKey: ['hr'] }), [qc]);

  const flush = useCallback(async () => {
    const q = readQueue();
    if (!q.length || !navigator.onLine) return;
    const left: Queued[] = [];
    for (const p of q) {
      try {
        await hrApi.punch(p);
      } catch (err) {
        // A punch the server refuses (too old, away from office) is dropped with a message; network trouble keeps it.
        if (err instanceof ApiError) toast.error(`${t('hr.a.queuedFailed')}: ${err.message}`);
        else left.push(p);
      }
    }
    writeQueue(left);
    setQueued(left.length);
    if (left.length < q.length) refresh();
  }, [refresh, t]);

  // Send what was punched offline: right after opening, and whenever the phone comes back online.
  useEffect(() => {
    const first = setTimeout(() => void flush(), 0);
    window.addEventListener('online', flush);
    return () => {
      clearTimeout(first);
      window.removeEventListener('online', flush);
    };
  }, [flush]);

  const doPunch = async (selfie?: File) => {
    setBusy(true);
    const at = new Date().toISOString();
    const pos = await position();
    try {
      const selfieId = selfie ? (await uploadFile(selfie, `selfie-${at}.jpg`)).id : undefined;
      await hrApi.punch({ type: next, ...pos, selfieId });
      toast.success(next === 'IN' ? t('hr.a.punchedIn') : t('hr.a.punchedOut'));
      refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else {
        // Offline: keep it with the time it was made; it is sent when the phone is back online.
        const q = [...readQueue(), { type: next, at, ...(pos ?? {}) }];
        writeQueue(q);
        setQueued(q.length);
        toast.message(t('hr.a.savedOffline'));
      }
    } finally {
      setBusy(false);
    }
  };

  const today = month.today;
  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {today &&
              (today.final ? (
                <StatusChip tone={STATUS_TONE[today.status]}>{t(`hr.status.${today.status}`)}</StatusChip>
              ) : (
                // Mid-shift the day isn't settled: show where the person is, not what the day will count as.
                <StatusChip tone={today.inAt && !today.outAt ? 'ok' : 'neutral'}>
                  {today.inAt && !today.outAt
                    ? t('hr.a.atWork')
                    : today.inAt
                      ? t('hr.a.leftWork')
                      : t('hr.a.notInYet')}
                </StatusChip>
              ))}
            {queued > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-status-warn-fg">
                <WifiOff className="size-3.5" /> {t('hr.a.queued', { count: queued })}
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {month.punches.length
              ? month.punches
                  .map(
                    (p) =>
                      `${p.type === 'IN' ? t('hr.a.in') : t('hr.a.out')} ${formatDateTime(p.at, tz).slice(-5)}`,
                  )
                  .join(' · ')
              : t('hr.a.noPunch')}
          </div>
          {today && today.workedMinutes > 0 && (
            <div className="text-xs text-muted-foreground">
              {t('hr.a.worked', { h: hm(today.workedMinutes) })}
              {today.lateMinutes > 0 && ` · ${t('hr.a.late', { m: today.lateMinutes })}`}
            </div>
          )}
        </div>
        <input
          ref={selfieInput}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          aria-label={t('hr.a.selfie')}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doPunch(f);
          }}
        />
        <Button
          variant="primary"
          size="lg"
          className="h-14 min-w-48 text-base"
          disabled={busy}
          onClick={() => (month.selfie ? selfieInput.current?.click() : void doPunch())}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : month.selfie ? (
            <Camera />
          ) : next === 'IN' ? (
            <LogIn />
          ) : (
            <LogOut />
          )}
          {next === 'IN' ? t('hr.a.punchIn') : t('hr.a.punchOut')}
        </Button>
      </CardContent>
    </Card>
  );
}
