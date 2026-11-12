import { FileUp, Plus, Tags, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTO_TAGS, formatLocalDate, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { inr, useCustomers, useProgress, type CustomerRow } from './api';
import { CustomerDialog, CustomerSheet } from './CustomerDialogs';
import { ImportCustomers, TagsDialog } from './CustomerExtras';
import { TagChips } from './tags';

/** Sales CRM → Customer Master (§11.2): GP ranks, automatic and own tags, the 80/20 check. */
export function CustomersPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useCustomers();
  const progress = useProgress();
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
  const [chip, setChip] = useState('all');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const perms = me.user.permissions;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const own = progress.data?.config.tags ?? [];
  const rows = q.data.customers
    .filter((c) => chip === 'all' || c.autoTags.includes(chip as never) || c.tags.includes(chip))
    .filter(
      (c) =>
        !search.trim() || matchScore(search, [c.name, c.city, c.mobile, c.segment, c.code].join(' ')) > 0,
    )
    .sort((a, b) => (a.gpRank ?? 1e9) - (b.gpRank ?? 1e9) || a.name.localeCompare(b.name));
  const count = (k: string) =>
    q.data.customers.filter((c) => c.autoTags.includes(k as never) || c.tags.includes(k)).length;
  const tl = q.data.tiles;
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.customers')} subtitle={t('navDesc.customers')} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label={t('crm.c.customers')} value={tl.customers} hero />
        <KpiTile label={t('crm.c.top20Share')} value={`${tl.top20GpSharePct}%`} note={t('crm.c.top20Note')} />
        <KpiTile label={t('crm.c.withOwner')} value={inr(tl.withOwner, true)} />
        <KpiTile label={t('crm.tag.sleeping')} value={tl.sleeping} />
        <KpiTile label={t('crm.tag.lost')} value={tl.lost} tone={tl.lost ? 'bad' : undefined} />
        <KpiTile label={t('crm.tag.vampire')} value={tl.vampires} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label={t('crm.c.search')}
          placeholder={t('crm.c.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-72"
        />
        {hasPermission(perms, 'crm.admin') && (
          <Button variant="secondary" onClick={() => setTagsOpen(true)}>
            <Tags /> {t('crm.c.fieldsTags')}
          </Button>
        )}
        {hasPermission(perms, 'crm.create') && (
          <>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp /> {t('crm.c.import')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> {t('crm.c.add')}
            </Button>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('crm.c.byTag')}>
        {['all', ...AUTO_TAGS, ...own.map((x) => x.key)].map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={chip === k}
            onClick={() => setChip(k)}
            className={cn(
              'h-8 rounded-pill border px-3 text-sm',
              chip === k ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
            )}
          >
            {k === 'all'
              ? t('crm.c.all', { count: q.data.customers.length })
              : `${own.find((x) => x.key === k)?.name ?? t(`crm.tag.${k}`)} ${count(k)}`}
          </button>
        ))}
      </div>
      {!q.data.customers.length ? (
        <EmptyState icon={Users} title={t('crm.c.none')} body={t('crm.c.noneBody')} />
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setOpen(c.id)}
                className="grid w-full gap-2 px-4 py-3 text-left text-sm hover:bg-muted/40 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_8rem_9rem_7rem]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[c.code, c.city, c.mobile, c.segment && t(`crm.segment.${c.segment}`)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <TagChips auto={c.autoTags} own={c.tags} defs={own} />
                <div className="tabular-nums">
                  <div className="font-medium">{inr(c.sales12, true)}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('crm.c.orders', { count: c.orders12 })}
                  </div>
                </div>
                <div className="tabular-nums">
                  <div className="font-medium">
                    {inr(c.gp12, true)}{' '}
                    {c.marginPct !== null && (
                      <span className="text-xs text-muted-foreground">· {c.marginPct}%</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.gpRank ? t('crm.c.rank', { n: c.gpRank }) : '—'}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <div>{c.lastOrder ? formatLocalDate(c.lastOrder) : t('crm.c.noOrders')}</div>
                  <div>{c.handledBy ?? ''}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <CustomerSheet
          id={open}
          me={me}
          defs={own}
          onEdit={(c) => (setOpen(null), setEditing(c))}
          onClose={() => setOpen(null)}
        />
      )}
      {editing && (
        <CustomerDialog customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      <ImportCustomers open={importing} onClose={() => setImporting(false)} />
      {tagsOpen && progress.data && (
        <TagsDialog config={progress.data.config} onClose={() => setTagsOpen(false)} />
      )}
    </div>
  );
}
