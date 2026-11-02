import { CheckCircle2, CircleAlert, Loader2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { WHATSAPP_PROVIDERS } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@mono/shared';
import { cn } from '@/lib/utils';
import { post, put, useOrgMutation } from '../api';
import { useChannels, type ChannelState } from './api';

const LIVE = new Set(['wati', 'aisensy']);

export function WhatsAppTab() {
  const q = useChannels();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return <WhatsAppForm key={JSON.stringify(q.data.whatsapp.meta)} state={q.data.whatsapp} />;
}

function WhatsAppForm({ state }: { state: ChannelState }) {
  const { t } = useTranslation();
  const meta = state.meta as Record<string, string | boolean | undefined>;
  const [provider, setProvider] = useState(String(meta.provider ?? 'wati'));
  const [form, setForm] = useState({
    endpoint: String(meta.endpoint ?? ''),
    apiKey: '',
    displayName: String(meta.displayName ?? ''),
    number: String(meta.number ?? ''),
  });
  const save = useOrgMutation(
    () =>
      put('/api/notify/channels/whatsapp', {
        provider,
        ...form,
        endpoint: form.endpoint || undefined,
        apiKey: form.apiKey || undefined,
      }),
    { success: t('org.saved') },
  );
  const test = useOrgMutation(() => post<{ message: string }>('/api/notify/channels/whatsapp/test', {}), {
    silentError: true,
  });
  const keySaved = state.secretsSaved.apiKey && provider === meta.provider;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('notify.wa.step1')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WHATSAPP_PROVIDERS.map((p) => (
                <button
                  key={p}
                  disabled={!LIVE.has(p)}
                  onClick={() => setProvider(p)}
                  className={cn(
                    'rounded-card border p-3 text-left text-sm disabled:opacity-50',
                    provider === p ? 'border-ink bg-ink text-ink-foreground' : 'bg-card hover:bg-muted',
                  )}
                >
                  <div className="font-semibold">{t(`notify.wa.provider.${p}`)}</div>
                  <div className={cn('text-xs', provider === p ? 'opacity-70' : 'text-muted-foreground')}>
                    {LIVE.has(p) ? t('notify.wa.ready') : t('notify.wa.later')}
                  </div>
                </button>
              ))}
            </div>
            {meta.provider && provider !== meta.provider && (
              <p className="text-xs text-status-warn-fg">{t('notify.wa.switchWarning')}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('notify.wa.step2')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {provider === 'wati' && (
              <Field
                label={t('notify.wa.endpoint')}
                hint="https://live-server-12345.wati.io"
                className="sm:col-span-2"
              >
                <Input
                  value={form.endpoint}
                  onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                  inputMode="url"
                />
              </Field>
            )}
            <Field
              label={t('notify.wa.apiKey')}
              hint={keySaved ? t('notify.secretSaved') : t('notify.secretOnce')}
              className="sm:col-span-2"
            >
              <Input
                type="password"
                autoComplete="off"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={keySaved ? '••••••••••••' : ''}
              />
            </Field>
            <Field label={t('notify.wa.displayName')}>
              <Input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                placeholder="Levanto Quartz"
              />
            </Field>
            <Field label={t('notify.wa.number')}>
              <Input
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                inputMode="tel"
                placeholder="+91 98290 12345"
              />
            </Field>
            <div className="sm:col-span-2">
              <Button
                variant="primary"
                disabled={save.isPending || (!keySaved && !form.apiKey)}
                onClick={() => save.mutate(undefined)}
              >
                {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="self-start">
        <CardHeader>
          <CardTitle>{t('notify.wa.status')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[
            [t('notify.wa.providerLabel'), meta.provider ? t(`notify.wa.provider.${meta.provider}`) : '—'],
            [t('notify.wa.displayName'), meta.displayName || '—'],
            [t('notify.wa.number'), meta.number || '—'],
            [t('notify.wa.quality'), meta.quality || '—'],
            [t('notify.wa.tier'), meta.tier || '—'],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex justify-between gap-3 border-b pb-2 last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{String(v)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">{t('notify.wa.credentials')}</span>
            {state.secretsSaved.apiKey ? (
              <StatusChip tone="ok">{t('notify.saved')}</StatusChip>
            ) : (
              <StatusChip tone="neutral">{t('notify.notSaved')}</StatusChip>
            )}
          </div>
          {typeof meta.lastTestAt === 'string' && (
            <p
              className={cn(
                'flex items-start gap-2 rounded-control p-2.5 text-xs',
                meta.lastTestOk ? 'bg-status-ok-bg text-status-ok-fg' : 'bg-status-bad-bg text-status-bad-fg',
              )}
            >
              {meta.lastTestOk ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <CircleAlert className="size-4 shrink-0" />
              )}
              <span>
                {formatDateTime(meta.lastTestAt)} · {String(meta.lastTestMessage ?? '')}
              </span>
            </p>
          )}
          <Button
            className="w-full"
            disabled={!state.secretsSaved.apiKey || test.isPending}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: (r) => toast.success(r.message),
                onError: (e) => toast.error((e as Error).message),
              })
            }
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} {t('notify.wa.test')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
