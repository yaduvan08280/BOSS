import { BellRing, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, NOTIFY_MODULES } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Switch } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { del, patch, post, useOrgMutation, useUsers } from '../api';
import { useRules, type Rule } from './api';
import { eventLabel, moduleOf, recipientLabel } from './labels';
import { RuleDialog } from './RuleDialog';

export function RulesTab() {
  const { t } = useTranslation();
  const q = useRules();
  const users = useUsers();
  const [module, setModule] = useState('all');
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [testing, setTesting] = useState(false);
  const [testUser, setTestUser] = useState('');
  const toggle = useOrgMutation(({ id, active }: { id: string; active: boolean }) =>
    patch(`/api/notify/rules/${id}`, { active }),
  );
  const remove = useOrgMutation((id: string) => del(`/api/notify/rules/${id}`), {
    success: t('org.deleted'),
  });
  const load = useOrgMutation(() => post<{ added: number }>('/api/notify/rules/load-defaults', {}), {
    success: (r) => t('notify.rule.loaded', { count: r.added }),
  });
  const test = useOrgMutation((userId: string) => post('/api/notify/test', { userId }), {
    success: t('notify.rule.testSent'),
  });
  const names = useMemo(() => new Map((users.data ?? []).map((u) => [u.id, u.name])), [users.data]);

  const all = q.data ?? [];
  const rows = all.filter((r) => module === 'all' || moduleOf(r.event) === module);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const active = all.filter((r) => r.active);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5">
        <KpiTile hero label={t('notify.rule.tile.active')} value={active.length} />
        <KpiTile
          label={t('notify.rule.tile.team')}
          value={active.filter((r) => r.audience === 'team' && r.channels.includes('telegram')).length}
        />
        <KpiTile
          label={t('notify.rule.tile.clients')}
          value={active.filter((r) => r.audience === 'client').length}
        />
        <KpiTile
          label={t('notify.rule.tile.vendors')}
          value={active.filter((r) => r.audience === 'vendor').length}
        />
        <KpiTile label={t('notify.rule.tile.ai')} value={active.filter((r) => r.aiFollowUp).length} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-4 flex flex-1 gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {['all', ...NOTIFY_MODULES].map((m) => (
            <button
              key={m}
              onClick={() => setModule(m)}
              className={cn(
                'h-8 shrink-0 rounded-pill border px-3 text-xs font-medium',
                module === m ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
              )}
            >
              {m === 'all' ? t('home.all') : t(`notify.module.${m}`)}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setTesting(true)}>
          <Send /> {t('notify.rule.sendTest')}
        </Button>
        <Button size="sm" onClick={() => load.mutate(undefined)}>
          {t('notify.rule.loadDefaults')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          <Plus /> {t('notify.rule.add')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={t('notify.rule.none')}
          action={<Button onClick={() => load.mutate(undefined)}>{t('notify.rule.loadDefaults')}</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {['when', 'for', 'sendTo', 'channels', 'wait', 'noReply', 'status', 'added', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">
                    {h && t(`notify.rule.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className={cn('hover:bg-muted/40', !r.active && 'opacity-55')}>
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{eventLabel(t, r.event)}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.event}</div>
                  </td>
                  <td className="px-3 text-xs">{t(`notify.aud.${r.audience}`)}</td>
                  <td className="px-3 text-xs">
                    {r.recipients.map((x) => recipientLabel(t, x, names)).join(', ')}
                  </td>
                  <td className="px-3">
                    <div className="flex flex-wrap gap-1">
                      {r.channels.map((c) => (
                        <span key={c} className="rounded-pill bg-muted px-2 py-0.5 text-[11px] font-medium">
                          {t(`notify.channel.${c}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="tabular px-3 text-xs">
                    {r.waitMinutes ? t('notify.rule.min', { count: r.waitMinutes }) : '—'}
                  </td>
                  <td className="px-3 text-xs">
                    {r.escalateTo
                      ? t('notify.rule.escalateText', {
                          to: recipientLabel(t, r.escalateTo, names),
                          count: r.escalateAfterMinutes ?? 0,
                        })
                      : '—'}
                  </td>
                  <td className="px-3">
                    <Switch
                      checked={r.active}
                      onCheckedChange={(on) => toggle.mutate({ id: r.id, active: on })}
                      aria-label={t('notify.rule.col.status')}
                    />
                  </td>
                  <td className="px-3 text-xs text-muted-foreground">
                    {r.isDefault ? t('notify.rule.default') : formatDate(r.createdAt)}
                  </td>
                  <td className="px-3">
                    <div className="flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('org.edit')}
                        onClick={() => setEditing(r)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('org.delete')}
                        onClick={() => remove.mutate(r.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <RuleDialog rule={editing} onClose={() => setEditing(null)} />}
      <Dialog
        open={testing}
        onOpenChange={setTesting}
        title={t('notify.rule.sendTest')}
        description={t('notify.rule.testHint')}
        footer={
          <Button
            variant="primary"
            disabled={!testUser || test.isPending}
            onClick={() => test.mutate(testUser, { onSuccess: () => setTesting(false) })}
          >
            <Send /> {t('notify.sendTest')}
          </Button>
        }
      >
        <Field label={t('notify.rule.testTo')}>
          <Select value={testUser} onChange={(e) => setTestUser(e.target.value)}>
            <option value="">{t('org.choose')}</option>
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.telegramLinked ? ' · Telegram ✓' : ''}
                </option>
              ))}
          </Select>
        </Field>
      </Dialog>
    </div>
  );
}
