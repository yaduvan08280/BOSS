import { CloudUpload, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Select, Switch } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { del, patch, post, useOrgMutation } from '../api';
import { useTemplates, type Template } from './api';
import { eventLabel } from './labels';
import { TemplateDialog } from './TemplateDialog';

const TONE = { APPROVED: 'ok', DRAFT: 'neutral', PENDING: 'warn', REJECTED: 'bad' } as const;
const CHANNELS = ['all', 'whatsapp', 'email', 'telegram'] as const;

/** Columns that give way first when the table's card is narrow (a laptop, a zoomed-in screen). */
const LOW = 'hidden @5xl:table-cell';
/** … and these go as well on a phone; the template's dialog shows everything. */
const LOWER = 'hidden @2xl:table-cell';

export function TemplatesTab() {
  const { t } = useTranslation();
  const q = useTemplates();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('all');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const load = useOrgMutation(
    (c: string) => post<{ added: number }>('/api/notify/templates/load-defaults', { channel: c }),
    { success: (r) => t('notify.tpl.loaded', { count: r.added }) },
  );
  const check = useOrgMutation(() => post<{ message: string }>('/api/notify/templates/check-statuses', {}), {
    success: (r) => r.message,
  });
  const submit = useOrgMutation(
    (id: string) => post<{ message: string }>(`/api/notify/templates/${id}/submit`, {}),
    { success: (r) => r.message },
  );
  const toggle = useOrgMutation(({ id, active }: { id: string; active: boolean }) =>
    patch(`/api/notify/templates/${id}`, { active }),
  );
  const remove = useOrgMutation((id: string) => del(`/api/notify/templates/${id}`), {
    success: t('org.deleted'),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (x) =>
        (channel === 'all' || x.channel === channel) &&
        (!category || x.category === category) &&
        (!s || `${x.code} ${x.body} ${x.subject ?? ''}`.toLowerCase().includes(s)),
    );
  }, [q.data, channel, category, search]);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-base font-semibold">{t('notify.tpl.shown', { count: rows.length })}</h2>
        {(['whatsapp', 'email', 'telegram'] as const).map((c) => (
          <Button key={c} size="sm" onClick={() => load.mutate(c)}>
            {t(`notify.tpl.load.${c}`)}
          </Button>
        ))}
        <Button size="sm" onClick={() => check.mutate(undefined)} disabled={check.isPending}>
          <RefreshCw /> {t('notify.tpl.checkAll')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => setEditing('new')}>
          <Plus /> {t('notify.tpl.new')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-control border bg-card px-3 max-sm:w-full max-sm:flex-none sm:max-w-xs">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('notify.tpl.search')}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 w-44 sm:h-10"
          aria-label={t('notify.tpl.category')}
        >
          <option value="">{t('notify.tpl.allCategories')}</option>
          {['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((c) => (
            <option key={c} value={c}>
              {t(`notify.tpl.cat.${c}`)}
            </option>
          ))}
        </Select>
        <div className="flex rounded-control bg-muted p-1">
          {CHANNELS.map((c) => (
            <button
              key={c}
              onClick={() => setChannel(c)}
              className={cn(
                'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                channel === c ? 'bg-card shadow-sm' : 'text-muted-foreground',
              )}
            >
              {c === 'all' ? t('home.all') : t(`notify.channel.${c}`)}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Search} title={t('notify.tpl.none')} />
      ) : (
        <div className="scroll-hint @container overflow-x-auto rounded-card border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {[
                  'code',
                  'channel',
                  'category',
                  'language',
                  'status',
                  'quality',
                  'sentRead',
                  'active',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5 font-medium',
                      ['category', 'quality', 'sentRead'].includes(h) && LOW,
                      ['language', 'status'].includes(h) && LOWER,
                    )}
                  >
                    {h && t(`notify.tpl.col.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.slice(0, 300).map((x) => (
                <tr key={x.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{x.code}</div>
                    <div className="max-w-[11rem] truncate text-xs text-muted-foreground @5xl:max-w-xs">
                      {x.event ? eventLabel(t, x.event) : x.body}
                    </div>
                  </td>
                  <td className="px-3">{t(`notify.channel.${x.channel}`)}</td>
                  <td className={cn('px-3 text-xs', LOW)}>{t(`notify.tpl.cat.${x.category}`)}</td>
                  <td className={cn('px-3 text-xs uppercase', LOWER)}>{x.language}</td>
                  <td className={cn('px-3', LOWER)}>
                    <StatusChip tone={TONE[x.status as keyof typeof TONE] ?? 'neutral'}>
                      {t(`notify.tpl.status.${x.status}`)}
                    </StatusChip>
                  </td>
                  <td className={cn('px-3 text-xs', LOW)}>{x.quality ?? '—'}</td>
                  <td className={cn('tabular px-3 text-xs', LOW)}>
                    {x.sentCount} · {x.readCount}
                  </td>
                  <td className="px-3">
                    <Switch
                      checked={x.active}
                      onCheckedChange={(active) => toggle.mutate({ id: x.id, active })}
                      aria-label={t('notify.tpl.col.active')}
                    />
                  </td>
                  <td className="px-3">
                    <div className="flex">
                      {x.channel === 'whatsapp' && x.status !== 'APPROVED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('notify.tpl.submit')}
                          title={t('notify.tpl.submit')}
                          onClick={() => submit.mutate(x.id, { onError: () => undefined })}
                        >
                          <CloudUpload /> <span className="hidden @5xl:inline">{t('notify.tpl.submit')}</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('org.edit')}
                        onClick={() => setEditing(x)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('org.delete')}
                        onClick={() => remove.mutate(x.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 300 && (
            <p className="p-3 text-center text-xs text-muted-foreground">
              {t('notify.tpl.narrow', { count: rows.length })}
            </p>
          )}
        </div>
      )}
      {editing && <TemplateDialog template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
