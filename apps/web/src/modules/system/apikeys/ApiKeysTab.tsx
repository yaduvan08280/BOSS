import { BookOpen, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Confirm, Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { useMe } from '@/modules/auth/session';
import { platformApi, useApiKeys, usePlatformInfo, usePlatformMutation, type ApiKeyRow } from './api';
import { CopyButton, SecretOnce } from './SecretOnce';
import { WebhooksPanel } from './WebhooksPanel';

/** System Master → API Keys (CLAUDE.md §4.2, §12): the server address, keys (shown once), and outgoing webhooks. */
export function ApiKeysTab() {
  const { t } = useTranslation();
  const info = usePlatformInfo();
  const keys = useApiKeys();
  const me = useMe();
  const tz = me.data?.company.timezone;
  const [making, setMaking] = useState(false);
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const [search, setSearch] = useState('');
  const revoke = usePlatformMutation(
    (id: string) => platformApi.revokeKey(id),
    () => t('keys.revoked'),
  );
  if (info.isPending || keys.isPending) return <PageSkeleton />;
  if (info.isError || keys.isError)
    return <ErrorState onRetry={() => void keys.refetch()} error={keys.error} />;
  const list = keys.data.filter(
    (k) => !search.trim() || matchScore(search, `${k.name} ${k.masked} ${k.createdBy ?? ''}`) > 0,
  );
  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-card border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{t('keys.server')}</h2>
            <p className="text-sm text-muted-foreground">{t('keys.serverHint')}</p>
          </div>
          <Button asChild variant="secondary" size="sm">
            <a href={info.data.docsUrl} target="_blank" rel="noreferrer">
              <BookOpen /> {t('keys.docs')}
            </a>
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-control border bg-muted/50 px-3 py-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{info.data.apiUrl}</code>
          <CopyButton value={info.data.apiUrl} />
        </div>
        <pre className="overflow-x-auto rounded-control bg-ink p-3 font-mono text-xs text-ink-foreground">
          {`curl -H "Authorization: Bearer mono_…" ${info.data.apiUrl}/customers`}
        </pre>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">{t('keys.title')}</h2>
          <Input
            aria-label={t('keys.search')}
            placeholder={t('keys.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-0 flex-1 sm:max-w-60"
          />
          <Button onClick={() => setMaking(true)}>
            <Plus /> {t('keys.generate')}
          </Button>
        </div>
        {!keys.data.length ? (
          <EmptyState icon={KeyRound} title={t('keys.empty')} body={t('keys.emptyBody')} />
        ) : !list.length ? (
          <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
        ) : (
          <ul className="divide-y rounded-card border bg-card">
            {list.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {k.name}
                    {k.revokedAt ? (
                      <StatusChip tone="neutral">{t('keys.revokedChip')}</StatusChip>
                    ) : (
                      <StatusChip tone="ok">{t('keys.active')}</StatusChip>
                    )}
                  </div>
                  <code className="font-mono text-xs text-muted-foreground">{k.masked}</code>
                </div>
                <div className="text-xs text-muted-foreground">
                  <div>
                    {t('keys.made', { who: k.createdBy ?? '—', when: formatDateTime(k.createdAt, tz) })}
                  </div>
                  <div>
                    {k.lastUsedAt
                      ? t('keys.lastUsed', { when: formatDateTime(k.lastUsedAt, tz) })
                      : t('keys.neverUsed')}
                  </div>
                </div>
                {!k.revokedAt && (
                  <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>
                    <Trash2 /> {t('keys.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <WebhooksPanel events={info.data.events} tz={tz} />

      {making && (
        <NewKeyDialog onClose={() => setMaking(false)} onMade={(k) => (setMaking(false), setShown(k))} />
      )}
      {shown && (
        <SecretOnce
          title={t('keys.yourKey', { name: shown.name })}
          value={shown.key}
          onClose={() => setShown(null)}
        />
      )}
      <Confirm
        open={Boolean(revoking)}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={t('keys.revokeTitle', { name: revoking?.name ?? '' })}
        body={t('keys.revokeBody')}
        confirm={t('keys.revoke')}
        danger
        onConfirm={() => revoking && revoke.mutate(revoking.id, { onSettled: () => setRevoking(null) })}
      />
    </div>
  );
}

function NewKeyDialog({
  onClose,
  onMade,
}: {
  onClose: () => void;
  onMade: (k: { name: string; key: string }) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const make = usePlatformMutation(() => platformApi.createKey(name.trim()));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('keys.generate')}
      footer={
        <Button
          disabled={name.trim().length < 2 || make.isPending}
          onClick={() => make.mutate(undefined, { onSuccess: (r) => onMade({ name: r.name, key: r.key }) })}
        >
          {make.isPending && <Loader2 className="animate-spin" />} {t('keys.generate')}
        </Button>
      }
    >
      <Field label={t('keys.name')} hint={t('keys.nameHint')}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tally connector"
          autoFocus
        />
      </Field>
    </Dialog>
  );
}
