import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FolderOpen, HardDrive, Loader2, PauseCircle, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { formatDateTime } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import { useMe } from '@/modules/auth/session';
import { CopyButton } from '@/modules/system/apikeys/SecretOnce';
import { DriveFaq } from './DriveFaq';

type DriveStatus = {
  status: 'none' | 'waiting' | 'connected' | 'error' | 'off';
  clientId: string | null;
  accountEmail: string | null;
  folderUrl: string | null;
  connectedAt: string | null;
  lastError: string | null;
  redirectUri: string;
  folderName: string;
  filesOnDrive: number;
  filesWaiting: number;
  canSetUp: boolean;
};

const STEPS = ['project', 'consent', 'client'] as const;
const LINKS: Record<(typeof STEPS)[number], string> = {
  project: 'https://console.cloud.google.com/apis/library/drive.googleapis.com',
  consent: 'https://console.cloud.google.com/auth/overview',
  client: 'https://console.cloud.google.com/auth/clients',
};
const TICKS = 'mono.drive.ticks';
const readTicks = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(TICKS) ?? '[]') as string[];
  } catch {
    return [];
  }
};

/** Integration → Google Drive (CLAUDE.md §12): "Where your files go", four guided steps, the FAQ. */
export function DriveTab() {
  const { t } = useTranslation();
  const me = useMe();
  const tz = me.data?.company.timezone;
  const appName = me.data?.company.appName ?? 'MONO';
  const q = useQuery({
    queryKey: ['drive'],
    queryFn: () => api<DriveStatus>('/api/integrations/google-drive'),
  });
  const [params, setParams] = useSearchParams();
  const [ticks, setTicks] = useState<string[]>(readTicks);
  const [typedId, setClientId] = useState<string | null>(null);
  const clientId = typedId ?? q.data?.clientId ?? '';
  const [clientSecret, setClientSecret] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const connect = useWorkMutation(
    () =>
      api<{ url: string }>('/api/integrations/google-drive/start', {
        method: 'POST',
        body: { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
      }),
    [['drive']],
  );
  const pause = useWorkMutation(
    () => api('/api/integrations/google-drive/pause', { method: 'POST' }),
    [['drive']],
    () => t('drive.paused'),
  );

  // Back from Google: say how it went once, then tidy the address.
  useEffect(() => {
    const r = params.get('drive');
    if (!r) return;
    if (r === 'connected') toast.success(t('drive.back.connected'));
    else toast.error(t(`drive.back.${r}`, { defaultValue: t('drive.back.error') }));
    params.delete('drive');
    setParams(params, { replace: true });
  }, [params, setParams, t]);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const s = q.data;
  const tick = (k: string) => {
    const next = ticks.includes(k) ? ticks.filter((x) => x !== k) : [...ticks, k];
    setTicks(next);
    try {
      localStorage.setItem(TICKS, JSON.stringify(next));
    } catch {
      // private window: ticks just aren't remembered
    }
  };
  const ready = STEPS.every((k) => ticks.includes(k));
  const onDrive = s.status === 'connected';
  return (
    <div className="grid gap-5 @container lg:grid-cols-[1fr_20rem]">
      <div className="space-y-5">
        <section className="space-y-3 rounded-card border bg-card p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-control bg-muted">
              <HardDrive className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t('drive.where')}</h2>
              <p className="text-sm text-muted-foreground">
                {onDrive
                  ? t('drive.nowDrive', { folder: s.folderName, account: s.accountEmail ?? '' })
                  : t('drive.nowServer', { app: appName })}
              </p>
            </div>
            <StatusChip
              tone={
                onDrive ? 'ok' : s.status === 'error' ? 'bad' : s.status === 'waiting' ? 'warn' : 'neutral'
              }
            >
              {t(`drive.st.${s.status}`)}
            </StatusChip>
          </div>
          {onDrive && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                {t('drive.counts', { on: s.filesOnDrive, waiting: s.filesWaiting })}
                {s.connectedAt && ` · ${t('drive.since', { when: formatDateTime(s.connectedAt, tz) })}`}
              </span>
              {s.folderUrl && (
                <Button asChild size="sm" variant="secondary" className="ml-auto">
                  <a href={s.folderUrl} target="_blank" rel="noreferrer">
                    <FolderOpen /> {t('drive.openFolder')}
                  </a>
                </Button>
              )}
              {s.canSetUp && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pause.isPending}
                  onClick={() => pause.mutate(undefined)}
                >
                  <PauseCircle /> {t('drive.pause')}
                </Button>
              )}
            </div>
          )}
          {s.lastError && (
            <p className="rounded-control bg-status-bad-bg p-2 text-sm text-status-bad-fg">{s.lastError}</p>
          )}
        </section>

        {!s.canSetUp ? (
          <p className="text-sm text-muted-foreground">{t('drive.ownerOnly')}</p>
        ) : (
          <ol className="space-y-3">
            {STEPS.map((k, i) => (
              <li key={k} className="rounded-card border bg-card p-4">
                <label className="flex items-start gap-3">
                  <Checkbox checked={ticks.includes(k)} onChange={() => tick(k)} className="mt-1" />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block font-medium">
                      {i + 1}. {t(`drive.step.${k}.title`)}
                    </span>
                    <span className="block text-sm whitespace-pre-line text-muted-foreground">
                      {t(`drive.step.${k}.body`)}
                    </span>
                  </span>
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                  <Button asChild size="sm" variant="ghost">
                    <a href={LINKS[k]} target="_blank" rel="noreferrer">
                      <ExternalLink /> {t(`drive.step.${k}.link`)}
                    </a>
                  </Button>
                  {k === 'consent' && (
                    <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
                      https://www.googleapis.com/auth/drive.file
                    </code>
                  )}
                </div>
                {k === 'client' && (
                  <div className="mt-2 flex items-center gap-2 rounded-control border bg-muted/50 px-3 py-1.5 sm:ml-8">
                    <code className="min-w-0 flex-1 font-mono text-xs break-all">{s.redirectUri}</code>
                    <CopyButton value={s.redirectUri} />
                  </div>
                )}
              </li>
            ))}
            <li className="space-y-3 rounded-card border bg-card p-4">
              <div className="font-medium">4. {t('drive.step.connect.title')}</div>
              <Field label={t('drive.clientId')} error={errors.clientId}>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="1234…apps.googleusercontent.com"
                  autoComplete="off"
                />
              </Field>
              <Field label={t('drive.clientSecret')} hint={t('drive.secretHint')} error={errors.clientSecret}>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="GOCSPX-…"
                  autoComplete="off"
                />
              </Field>
              {!ready && <p className="text-xs text-muted-foreground">{t('drive.tickFirst')}</p>}
              <Button
                disabled={!ready || !clientId.trim() || !clientSecret.trim() || connect.isPending}
                onClick={() =>
                  connect.mutate(undefined, {
                    onSuccess: (r) => window.location.assign(r.url),
                    onError: (e) =>
                      e instanceof ApiError &&
                      setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {}),
                  })
                }
              >
                {connect.isPending ? <Loader2 className="animate-spin" /> : <Plug />}{' '}
                {onDrive ? t('drive.reconnect') : t('drive.connect')}
              </Button>
            </li>
          </ol>
        )}
      </div>
      <DriveFaq app={appName} />
    </div>
  );
}
