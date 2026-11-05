import { FlaskConical, Loader2, Pencil, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { EmptyState } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Confirm, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { matchScore } from '@/lib/pick';
import { toast } from 'sonner';
import {
  platformApi,
  useDeliveries,
  usePlatformMutation,
  useWebhooks,
  type PlatformInfo,
  type WebhookRow,
} from './api';
import { SecretOnce } from './SecretOnce';

/** Outgoing webhooks: chosen events are posted (signed) to your address; every delivery is logged. */
export function WebhooksPanel({ events, tz }: { events: PlatformInfo['events']; tz?: string | undefined }) {
  const { t } = useTranslation();
  const hooks = useWebhooks();
  const [editing, setEditing] = useState<WebhookRow | 'new' | null>(null);
  const [removing, setRemoving] = useState<WebhookRow | null>(null);
  const [log, setLog] = useState<WebhookRow | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const remove = usePlatformMutation(
    (id: string) => platformApi.deleteWebhook(id),
    () => t('hooks.removed'),
  );
  const test = usePlatformMutation((id: string) => platformApi.testWebhook(id));
  const rotate = usePlatformMutation((id: string) => platformApi.rotateSecret(id));
  const runTest = (id: string) =>
    test.mutate(id, {
      onSuccess: (r) =>
        r.ok
          ? toast.success(t('hooks.testOk', { status: r.status }))
          : toast.error(t('hooks.testFailed', { why: r.error ?? `HTTP ${r.status}` })),
    });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="font-semibold">{t('hooks.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('hooks.subtitle')}</p>
        </div>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus /> {t('hooks.add')}
        </Button>
      </div>
      {hooks.isPending ? null : !hooks.data?.length ? (
        <EmptyState icon={Webhook} title={t('hooks.empty')} body={t('hooks.emptyBody')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {hooks.data.map((h) => (
            <li key={h.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-sm">{h.url}</code>
                <StatusChip tone={h.active ? 'ok' : 'neutral'}>
                  {h.active ? t('hooks.on') : t('hooks.off')}
                </StatusChip>
              </div>
              {h.description && <p className="text-sm text-muted-foreground">{h.description}</p>}
              <div className="flex flex-wrap gap-1">
                {h.events.map((e) => (
                  <span key={e} className="rounded-pill bg-muted px-2 py-0.5 font-mono text-[11px]">
                    {e}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className="mr-auto text-xs text-muted-foreground underline"
                  onClick={() => setLog(h)}
                >
                  {t('hooks.counts', { sent: h.sent, failed: h.failed, pending: h.pending })}
                </button>
                <Button size="sm" variant="ghost" disabled={test.isPending} onClick={() => runTest(h.id)}>
                  {test.isPending && test.variables === h.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FlaskConical />
                  )}{' '}
                  {t('hooks.test')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => rotate.mutate(h.id, { onSuccess: (r) => setSecret(r.secret) })}
                >
                  <RefreshCw /> {t('hooks.newSecret')}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('common.edit')}
                  onClick={() => setEditing(h)}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('common.delete')}
                  onClick={() => setRemoving(h)}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <WebhookDialog
          hook={editing === 'new' ? null : editing}
          events={events}
          onClose={() => setEditing(null)}
          onSecret={setSecret}
        />
      )}
      {log && <DeliveriesDialog hook={log} tz={tz} onClose={() => setLog(null)} />}
      {secret && <SecretOnce title={t('hooks.secretTitle')} value={secret} onClose={() => setSecret(null)} />}
      <Confirm
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('hooks.removeTitle')}
        body={removing?.url ?? ''}
        confirm={t('common.delete')}
        danger
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
    </section>
  );
}

function WebhookDialog({
  hook,
  events,
  onClose,
  onSecret,
}: {
  hook: WebhookRow | null;
  events: PlatformInfo['events'];
  onClose: () => void;
  onSecret: (s: string) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(hook?.url ?? 'https://');
  const [description, setDescription] = useState(hook?.description ?? '');
  const [active, setActive] = useState(hook?.active ?? true);
  const [picked, setPicked] = useState<Set<string>>(new Set(hook?.events ?? []));
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string>();
  const save = usePlatformMutation(
    () =>
      platformApi.saveWebhook(
        { url: url.trim(), events: [...picked], description: description.trim() || null, active },
        hook?.id,
      ),
    () => t('hooks.saved'),
  );
  const modules = [...new Set(events.map((e) => e.module))];
  const shown = events.filter((e) => !filter.trim() || matchScore(filter, `${e.event} ${e.module}`) > 0);
  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={hook ? t('hooks.edit') : t('hooks.add')}
      footer={
        <Button
          disabled={!picked.size || save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: (r) => {
                onClose();
                if (r.secret) onSecret(r.secret);
              },
              onError: (e) => setError(e instanceof ApiError ? e.message : undefined),
            })
          }
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('hooks.url')} hint={t('hooks.urlHint')} error={error}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" />
        </Field>
        <Field label={t('hooks.description')}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={active} onCheckedChange={setActive} /> {t('hooks.active')}
        </label>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t('hooks.events', { count: picked.size })}</div>
          <div className="flex flex-wrap gap-1.5">
            {['*', ...modules.map((m) => `${m}.*`)].map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={picked.has(k)}
                onClick={() => toggle(k)}
                className={
                  picked.has(k)
                    ? 'h-8 rounded-pill border border-ink bg-ink px-3 font-mono text-xs text-ink-foreground'
                    : 'h-8 rounded-pill border bg-card px-3 font-mono text-xs text-muted-foreground'
                }
              >
                {k === '*' ? t('hooks.everything') : k}
              </button>
            ))}
          </div>
          <Input
            placeholder={t('hooks.filter')}
            aria-label={t('hooks.filter')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="max-h-56 overflow-auto rounded-control border">
            {shown.map((e) => (
              <li key={e.event} className="border-t first:border-t-0">
                <label className="flex min-h-10 items-center gap-2 px-3 font-mono text-xs">
                  <Checkbox checked={picked.has(e.event)} onChange={() => toggle(e.event)} />
                  {e.event}
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

function DeliveriesDialog({
  hook,
  tz,
  onClose,
}: {
  hook: WebhookRow;
  tz?: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useDeliveries(hook.id);
  const tone = { SENT: 'ok', FAILED: 'bad', PENDING: 'warn' } as const;
  return (
    <Dialog open wide onOpenChange={(o) => !o && onClose()} title={t('hooks.log')} description={hook.url}>
      {q.isPending ? (
        <Loader2 className="mx-auto animate-spin" />
      ) : !q.data?.length ? (
        <p className="text-sm text-muted-foreground">{t('hooks.noDeliveries')}</p>
      ) : (
        <ul className="max-h-96 divide-y overflow-auto rounded-control border text-sm">
          {q.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <code className="min-w-0 flex-1 font-mono text-xs">{d.event}</code>
              <StatusChip tone={tone[d.status]}>{t(`hooks.st.${d.status}`)}</StatusChip>
              <span className="w-full text-xs text-muted-foreground">
                {formatDateTime(d.sentAt ?? d.createdAt, tz)} · {t('hooks.tries', { count: d.tries })}
                {d.responseCode ? ` · HTTP ${d.responseCode}` : ''}
                {d.error ? ` · ${d.error}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
