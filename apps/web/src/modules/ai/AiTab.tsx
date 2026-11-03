import { CheckCircle2, CircleAlert, Loader2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_PROVIDERS,
  DEFAULT_MODEL,
  formatDateTime,
  formatShortDateTime,
  KNOWN_MODELS,
  STT_PROVIDERS,
  type AiConfigInput,
  type AiProvider,
} from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Select, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';
import { aiApi, useAiConfig, useAiMutation, useAiUsage, usd, type AiConfigView } from './api';

/** System Master → Integration → AI (CLAUDE.md §13): provider, model, key (never shown again), test, usage. */
export function AiTab() {
  const q = useAiConfig();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
      <AiForm key={JSON.stringify(q.data)} saved={q.data} />
      <Usage />
    </div>
  );
}

function AiForm({ saved }: { saved: AiConfigView | null }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    provider: (saved?.provider ?? 'anthropic') as AiProvider,
    model: saved?.model ?? DEFAULT_MODEL.anthropic ?? '',
    apiKey: '',
    baseUrl: saved?.baseUrl ?? '',
    priceIn: saved?.priceIn?.toString() ?? '',
    priceOut: saved?.priceOut?.toString() ?? '',
    sttProvider: saved?.sttProvider ?? 'browser',
    sttModel: saved?.sttModel ?? '',
    sttKey: '',
    dailySummary: saved?.dailySummary ?? true,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const known = KNOWN_MODELS[f.provider];
  const keySaved = Boolean(saved?.hasKey && saved.provider === f.provider);
  const save = useAiMutation(
    () => {
      const body: AiConfigInput = {
        provider: f.provider,
        model: f.model.trim(),
        apiKey: f.apiKey || undefined,
        baseUrl: f.baseUrl || null,
        priceIn: f.priceIn ? Number(f.priceIn) : null,
        priceOut: f.priceOut ? Number(f.priceOut) : null,
        sttProvider: f.sttProvider as AiConfigInput['sttProvider'],
        sttModel: f.sttModel || null,
        sttKey: f.sttKey || undefined,
        dailySummary: f.dailySummary,
      };
      return aiApi.saveConfig(body);
    },
    () => t('org.saved'),
  );
  const test = useAiMutation(() => aiApi.test());
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  const needsKey = f.provider !== 'ollama' && !keySaved && !f.apiKey;
  const result =
    test.data ?? (saved?.lastTestAt ? { ok: saved.lastTestOk, error: saved.lastTestError } : null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('ai.set.provider')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {AI_PROVIDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() =>
                  set({ provider: p, model: DEFAULT_MODEL[p] ?? (p === saved?.provider ? saved.model : '') })
                }
                className={cn(
                  'rounded-card border p-3 text-left text-sm',
                  f.provider === p ? 'border-ink bg-ink text-ink-foreground' : 'bg-card hover:bg-muted',
                )}
              >
                <div className="font-semibold">{t(`ai.provider.${p}`)}</div>
                <div className={cn('text-xs', f.provider === p ? 'opacity-70' : 'text-muted-foreground')}>
                  {t(`ai.providerHint.${p}`)}
                </div>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('ai.set.model')} hint={known.length ? undefined : t('ai.set.modelHint')}>
              {known.length ? (
                <Select value={f.model} onChange={(e) => set({ model: e.target.value })}>
                  {known.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · ${m.in} / ${m.out} {t('ai.set.perMillion')}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={f.model}
                  onChange={(e) => set({ model: e.target.value })}
                  placeholder={f.provider === 'ollama' ? 'qwen2.5:7b' : ''}
                />
              )}
            </Field>
            {f.provider !== 'anthropic' && (
              <Field label={t('ai.set.baseUrl')} hint={t(`ai.set.baseUrlHint.${f.provider}`)}>
                <Input
                  value={f.baseUrl}
                  inputMode="url"
                  onChange={(e) => set({ baseUrl: e.target.value })}
                  placeholder={f.provider === 'ollama' ? 'http://localhost:11434' : ''}
                />
              </Field>
            )}
            {f.provider !== 'ollama' && (
              <Field
                label={t('ai.set.apiKey')}
                hint={keySaved ? t('ai.set.keySaved', { end: saved?.keyEnd ?? '' }) : t('notify.secretOnce')}
                className="sm:col-span-2"
              >
                <Input
                  type="password"
                  autoComplete="off"
                  value={f.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  placeholder={keySaved ? '••••••••••••' : ''}
                />
              </Field>
            )}
            {!known.some((m) => m.id === f.model) && f.provider !== 'ollama' && (
              <>
                <Field label={t('ai.set.priceIn')} hint={t('ai.set.priceHint')}>
                  <Input
                    inputMode="decimal"
                    value={f.priceIn}
                    onChange={(e) => set({ priceIn: e.target.value })}
                  />
                </Field>
                <Field label={t('ai.set.priceOut')}>
                  <Input
                    inputMode="decimal"
                    value={f.priceOut}
                    onChange={(e) => set({ priceOut: e.target.value })}
                  />
                </Field>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('ai.set.speech')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('ai.set.sttProvider')} hint={t('ai.set.sttHint')} className="sm:col-span-2">
            <Select
              value={f.sttProvider}
              onChange={(e) => set({ sttProvider: e.target.value as typeof f.sttProvider })}
            >
              {STT_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {t(`ai.stt.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          {f.sttProvider !== 'browser' && (
            <>
              <Field label={t('ai.set.sttModel')}>
                <Input
                  value={f.sttModel}
                  onChange={(e) => set({ sttModel: e.target.value })}
                  placeholder={f.sttProvider === 'openai' ? 'whisper-1' : 'gemini-2.5-flash'}
                />
              </Field>
              {f.sttProvider !== f.provider && (
                <Field
                  label={t('ai.set.sttKey')}
                  hint={saved?.hasSttKey ? t('notify.secretSaved') : t('notify.secretOnce')}
                >
                  <Input
                    type="password"
                    autoComplete="off"
                    value={f.sttKey}
                    onChange={(e) => set({ sttKey: e.target.value })}
                    placeholder={saved?.hasSttKey ? '••••••••••••' : ''}
                  />
                </Field>
              )}
            </>
          )}
          <label className="flex items-start justify-between gap-3 rounded-control border p-3 sm:col-span-2">
            <span>
              <span className="block text-sm font-medium">{t('ai.set.dailySummary')}</span>
              <span className="block text-xs text-muted-foreground">{t('ai.set.dailySummaryHint')}</span>
            </span>
            <Switch
              checked={f.dailySummary}
              onCheckedChange={(v) => set({ dailySummary: v })}
              aria-label={t('ai.set.dailySummary')}
            />
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button
              variant="primary"
              disabled={save.isPending || !f.model.trim() || needsKey}
              onClick={() => save.mutate(undefined)}
            >
              {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
            </Button>
            <Button
              variant="secondary"
              disabled={!saved || test.isPending}
              onClick={() => test.mutate(undefined)}
            >
              {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />} {t('ai.set.test')}
            </Button>
          </div>
          {result && (
            <p
              role="status"
              className={cn(
                'flex items-start gap-2 text-sm sm:col-span-2',
                result.ok ? 'text-status-ok-fg' : 'text-status-bad-fg',
              )}
            >
              {result.ok ? (
                <CheckCircle2 className="mt-0.5 size-4" />
              ) : (
                <CircleAlert className="mt-0.5 size-4" />
              )}
              {result.ok ? t('ai.set.testOk') : result.error}
              {saved?.lastTestAt && !test.data && (
                <span className="text-muted-foreground"> · {formatDateTime(saved.lastTestAt, tz)}</span>
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Usage() {
  const { t } = useTranslation();
  const q = useAiUsage();
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>{t('ai.usage.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isPending ? (
          <PageSkeleton />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                [t('ai.usage.calls'), q.data.total.calls.toLocaleString('en-IN')],
                [
                  t('ai.usage.tokens'),
                  (q.data.total.inputTokens + q.data.total.outputTokens).toLocaleString('en-IN'),
                ],
                [t('ai.usage.cost'), usd(q.data.total.costMicros)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-control bg-muted p-2">
                  <div className="text-base font-semibold tabular-nums">{value}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('ai.usage.estimate')}</p>
            {q.data.month.length > 0 && (
              <ul className="divide-y">
                {q.data.month.map((m) => (
                  <li key={m.feature} className="flex justify-between gap-2 py-1.5">
                    <span>{t(`ai.feature.${m.feature}`, { defaultValue: m.feature })}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {m.calls} · {usd(m.costMicros)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {q.data.recent.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold">{t('ai.usage.recent')}</div>
                <ul className="space-y-1 text-xs">
                  {q.data.recent.slice(0, 8).map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <span className={cn(!r.ok && 'text-status-bad-fg')}>
                        {formatShortDateTime(r.createdAt, tz)} ·{' '}
                        {t(`ai.feature.${r.feature}`, { defaultValue: r.feature })}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {(r.ms / 1000).toFixed(1)}s · {usd(r.costMicros)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
