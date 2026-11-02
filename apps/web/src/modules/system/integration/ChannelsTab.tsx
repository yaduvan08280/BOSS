import { BellRing, CheckCircle2, CircleAlert, KeyRound, Loader2, Mail, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDateTime } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { post, put, useOrgMutation } from '../api';
import { useChannels, type ChannelState } from './api';

function LastTest({ meta }: { meta: Record<string, unknown> }) {
  if (typeof meta.lastTestAt !== 'string') return null;
  return (
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
  );
}

function TestButton({ channel, disabled }: { channel: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const test = useOrgMutation(() => post<{ message: string }>(`/api/notify/channels/${channel}/test`, {}), {
    silentError: true,
  });
  return (
    <Button
      disabled={disabled || test.isPending}
      onClick={() =>
        test.mutate(undefined, {
          onSuccess: (r) => toast.success(r.message),
          onError: (e) => toast.error((e as Error).message),
        })
      }
    >
      {test.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('notify.sendTest')}
    </Button>
  );
}

function ChannelCard({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
            {icon}
          </span>
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function EmailCard({ state, envDefault }: { state: ChannelState; envDefault: boolean }) {
  const { t } = useTranslation();
  const m = state.meta as Record<string, string | number | boolean | undefined>;
  const [f, setF] = useState({
    host: String(m.host ?? ''),
    port: String(m.port ?? '587'),
    secure: Boolean(m.secure),
    user: String(m.user ?? ''),
    pass: '',
    from: String(m.from ?? ''),
  });
  const save = useOrgMutation(
    () => put('/api/notify/channels/email', { ...f, port: Number(f.port), pass: f.pass || undefined }),
    { success: t('org.saved') },
  );
  return (
    <ChannelCard
      icon={<Mail className="size-5" />}
      title={t('notify.ch.email')}
      hint={envDefault && !state.saved ? t('notify.ch.envDefault') : t('notify.ch.emailHint')}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('notify.ch.host')} className="col-span-2 sm:col-span-1">
          <Input
            value={f.host}
            onChange={(e) => setF({ ...f, host: e.target.value })}
            placeholder="smtp.gmail.com"
          />
        </Field>
        <Field label={t('notify.ch.port')} className="col-span-2 sm:col-span-1">
          <Input value={f.port} inputMode="numeric" onChange={(e) => setF({ ...f, port: e.target.value })} />
        </Field>
        <Field label={t('notify.ch.user')}>
          <Input value={f.user} autoComplete="off" onChange={(e) => setF({ ...f, user: e.target.value })} />
        </Field>
        <Field
          label={t('notify.ch.pass')}
          hint={state.secretsSaved.pass ? t('notify.secretSaved') : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={f.pass}
            placeholder={state.secretsSaved.pass ? '••••••••' : ''}
            onChange={(e) => setF({ ...f, pass: e.target.value })}
          />
        </Field>
        <Field label={t('notify.ch.from')} className="col-span-2">
          <Input
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
            placeholder="MONO <mono@ggminerals.com>"
          />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <Checkbox checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} />{' '}
          {t('notify.ch.secure')}
        </label>
      </div>
      <LastTest meta={state.meta} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!f.host || !f.from || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {t('common.save')}
        </Button>
        <TestButton channel="email" disabled={!state.saved && !envDefault} />
      </div>
    </ChannelCard>
  );
}

function TelegramCard({ state, envDefault }: { state: ChannelState; envDefault: boolean }) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const save = useOrgMutation(() => put('/api/notify/channels/telegram', { token }), {
    success: t('notify.ch.botConnected'),
  });
  const bot = state.meta.botUsername as string | undefined;
  return (
    <ChannelCard
      icon={<Send className="size-5" />}
      title={t('notify.ch.telegram')}
      hint={t('notify.ch.telegramHint')}
    >
      {bot && (
        <p className="text-sm">
          {t('notify.ch.botIs')}{' '}
          <a
            className="font-semibold underline"
            href={`https://t.me/${bot}`}
            target="_blank"
            rel="noreferrer"
          >
            @{bot}
          </a>
        </p>
      )}
      {!bot && envDefault && <p className="text-xs text-muted-foreground">{t('notify.ch.envDefault')}</p>}
      <Field
        label={t('notify.ch.token')}
        hint={state.secretsSaved.token ? t('notify.secretSaved') : t('notify.ch.tokenHint')}
      >
        <Input
          type="password"
          autoComplete="off"
          value={token}
          placeholder={state.secretsSaved.token ? '••••••••••••' : '123456789:AA…'}
          onChange={(e) => setToken(e.target.value.trim())}
        />
      </Field>
      <LastTest meta={state.meta} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!token || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setToken('') })}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('notify.ch.connect')}
        </Button>
        <TestButton channel="telegram" disabled={!state.secretsSaved.token && !envDefault} />
      </div>
    </ChannelCard>
  );
}

function PushCard({ state, envDefault }: { state: ChannelState; envDefault: boolean }) {
  const { t } = useTranslation();
  const keys = useOrgMutation(() => post('/api/notify/push/keys', {}), { success: t('notify.ch.keysMade') });
  const pub = state.meta.publicKey as string | undefined;
  return (
    <ChannelCard
      icon={<BellRing className="size-5" />}
      title={t('notify.ch.push')}
      hint={t('notify.ch.pushHint')}
    >
      {pub ? (
        <code className="block truncate rounded-control bg-muted px-3 py-2 font-mono text-xs">{pub}</code>
      ) : (
        <p className="text-sm text-muted-foreground">
          {envDefault ? t('notify.ch.envDefault') : t('notify.ch.noKeys')}
        </p>
      )}
      <LastTest meta={state.meta} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant={pub ? 'secondary' : 'primary'}
          disabled={keys.isPending}
          onClick={() => keys.mutate(undefined)}
        >
          <KeyRound /> {pub ? t('notify.ch.newKeys') : t('notify.ch.makeKeys')}
        </Button>
        <TestButton channel="push" disabled={!pub && !envDefault} />
      </div>
    </ChannelCard>
  );
}

export function ChannelsTab() {
  const q = useChannels();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const env = q.data.envDefaults;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <TelegramCard
        key={`tg${JSON.stringify(q.data.telegram.meta)}`}
        state={q.data.telegram}
        envDefault={Boolean(env.telegram)}
      />
      <EmailCard
        key={`em${JSON.stringify(q.data.email.meta)}`}
        state={q.data.email}
        envDefault={Boolean(env.email)}
      />
      <PushCard state={q.data.push} envDefault={Boolean(env.push)} />
    </div>
  );
}
