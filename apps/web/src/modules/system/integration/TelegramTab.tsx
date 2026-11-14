import { CheckCircle2, KeyRound, Send, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatShortDateTime } from '@mono/shared';
import { Avatar } from '@/components/brand';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { LinkMyTelegram } from '@/modules/account/LinkMyTelegram';
import { post, put, useOrgMutation } from '../api';
import { useTelegramPage } from './api';
import { ShownCodes } from './ShownCodes';

const TONE = { linked: 'ok', pending: 'warn', expired: 'bad', none: 'neutral' } as const;
const TARGET = 0.8;

export function TelegramTab() {
  const { t } = useTranslation();
  const q = useTelegramPage();
  const [shown, setShown] = useState<{ name: string; code: string }[]>([]);
  const send = useOrgMutation(
    (userIds?: string[]) =>
      post<{ sent: number; shown: { name: string; code: string }[] }>('/api/notify/telegram/send-codes', {
        userIds,
      }),
    {
      success: (r) => t('notify.tg.codesSent', { count: r.sent }),
    },
  );
  const [group, setGroup] = useState<string | null>(null);
  const saveGroup = useOrgMutation(
    (groupChatId: string | null) => put('/api/notify/telegram/group', { groupChatId }),
    { success: t('notify.tg.groupSaved') },
  );

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const { stats, people, bot, connected } = q.data;
  const pct = stats.total ? Math.round((stats.linked / stats.total) * 100) : 0;
  const notLinked = people.filter((p) => p.state !== 'linked');

  if (!connected) {
    return (
      <EmptyState
        icon={Send}
        title={t('notify.tg.noBotTitle')}
        body={t('notify.tg.noBotBody')}
        action={
          <Button asChild variant="primary">
            <Link to="/system/integration/channels">{t('notify.tab.channels')}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiTile
          hero
          label={t('notify.tg.linked')}
          value={pct}
          unit="%"
          note={t('notify.tg.linkedNote', { linked: stats.linked, total: stats.total, need: TARGET * 100 })}
        />
        <KpiTile label={t('notify.tg.pending')} value={stats.pending} note={t('notify.tg.pendingNote')} />
        <KpiTile label={t('notify.tg.expired')} value={stats.expired} note={t('notify.tg.expiredNote')} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{t('notify.tg.people')}</CardTitle>
            <Button
              variant="primary"
              size="sm"
              disabled={!notLinked.length || send.isPending}
              onClick={() => send.mutate(undefined, { onSuccess: (r) => setShown(r.shown) })}
            >
              <Send /> {t('notify.tg.sendAll', { count: notLinked.length })}
            </Button>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <ul className="divide-y">
              {people.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:px-5">
                  <Avatar name={p.name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.mobile ?? p.email ?? t('notify.tg.noContact')}
                    </div>
                  </div>
                  {p.linkCode && (
                    <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{p.linkCode}</code>
                  )}
                  {p.sentAt && p.state !== 'linked' && (
                    <span className="text-xs text-muted-foreground">{formatShortDateTime(p.sentAt)}</span>
                  )}
                  <StatusChip tone={TONE[p.state]}>{t(`notify.tg.state.${p.state}`)}</StatusChip>
                  {p.state !== 'linked' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t('notify.tg.sendOne')}
                      onClick={() => send.mutate([p.id], { onSuccess: (r) => setShown(r.shown) })}
                    >
                      <KeyRound />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <LinkMyTelegram />
          <Card>
            <CardHeader>
              <CardTitle>{t('notify.tg.howTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm">
                {[
                  t('notify.tg.how1'),
                  t('notify.tg.how2', { bot: bot ? `@${bot}` : '' }),
                  t('notify.tg.how3'),
                ].map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-bold text-accent-soft-foreground">
                      {i + 1}
                    </span>
                    {s}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-4" /> {t('notify.tg.group')}
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('notify.tg.groupHint', { bot: bot ? `@${bot}` : 'the bot' })}
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Field label={t('notify.tg.groupId')}>
                <Input
                  value={group ?? q.data.groupChatId ?? ''}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="-1001234567890"
                  className="font-mono"
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  disabled={!(group ?? q.data.groupChatId)}
                  onClick={() => saveGroup.mutate((group ?? q.data.groupChatId)!.trim())}
                >
                  {t('notify.tg.connectGroup')}
                </Button>
                {q.data.groupChatId && (
                  <Button onClick={() => (setGroup(''), saveGroup.mutate(null))}>{t('org.remove')}</Button>
                )}
              </div>
              {q.data.groupChatId && (
                <p className="flex items-center gap-1.5 text-xs text-status-ok-fg">
                  <CheckCircle2 className="size-3.5" /> {t('notify.tg.groupOn')}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ShownCodes codes={shown} onClose={() => setShown([])} />
    </div>
  );
}
