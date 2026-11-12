import { ListChecks, Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { titleOf, useLists, type ListInfo } from './api';
import { ValuesPanel } from './ValuesPanel';

/**
 * Masters → Lists (plan §2.1): every list a "remember what people type" field feeds, with its values. An admin
 * adds, renames, merges and hides values; that only changes what forms offer — records keep what they said.
 */
export function ListsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const canEdit = hasPermission(me.user.permissions, 'core.edit');
  const header = <PageHeader title={t('nav.valueLists')} subtitle={t('navDesc.valueLists')} />;
  if (!canEdit)
    return (
      <div className="space-y-5">
        {header}
        <EmptyState icon={Lock} title={t('lists.p.adminsTitle')} body={t('lists.p.adminsBody')} />
      </div>
    );
  return (
    <div className="space-y-5">
      {header}
      <Lists tz={me.company.timezone} />
    </div>
  );
}

function Lists({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useLists();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data.length)
    return <EmptyState icon={ListChecks} title={t('lists.p.empty')} body={t('lists.p.emptyBody')} />;

  const selected = q.data.find((l) => l.key === params.get('list'));
  const open = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set('list', key);
    else next.delete('list');
    setParams(next, { replace: !key });
  };
  const shown = q.data.filter(
    (l) =>
      !search.trim() ||
      matchScore(search, [titleOf(l), ...l.usedIn.flatMap((u) => [u.name, u.field])].join(' ')) > 0,
  );
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
      {/* On a phone the lists and one list's values take turns; side by side from a laptop up. */}
      <section className={cn('space-y-3', selected && 'hidden lg:block')}>
        <Input
          aria-label={t('lists.p.search')}
          placeholder={t('lists.p.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!shown.length ? (
          <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((l) => (
              <li key={l.key}>
                <ListCard list={l} current={l.key === selected?.key} onOpen={() => open(l.key)} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={cn('min-w-0', !selected && 'hidden lg:block')}>
        {selected ? (
          <ValuesPanel key={selected.key} list={selected} tz={tz} onBack={() => open(null)} />
        ) : (
          <Card className="px-5 py-12 text-center text-sm text-muted-foreground">{t('lists.p.pickOne')}</Card>
        )}
      </section>
    </div>
  );
}

const pill =
  'inline-flex h-5 items-center rounded-pill bg-muted px-2 text-[11px] font-medium text-muted-foreground';

function ListCard({ list: l, current, onOpen }: { list: ListInfo; current: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-current={current || undefined}
      onClick={onOpen}
      className={cn(
        'block min-h-11 w-full rounded-card border bg-card p-3.5 text-left transition-colors hover:bg-muted/50',
        current && 'border-ink ring-1 ring-ink',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-semibold">{titleOf(l)}</span>
        {l.shared && <span className={pill}>{t('lists.p.shared')}</span>}
        {l.closed && <span className={pill}>{t('lists.p.closed')}</span>}
      </div>
      <div className="tabular mt-1 text-sm text-muted-foreground">
        {[
          t('lists.p.values', { count: l.values }),
          t('lists.p.uses', { count: l.uses }),
          ...(l.hidden ? [t('lists.p.hiddenCount', { count: l.hidden })] : []),
        ].join(' · ')}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {l.usedIn.length
          ? l.usedIn
              .slice(0, 3)
              .map((u) => `${u.name} · ${u.field}`)
              .concat(l.usedIn.length > 3 ? [`+${l.usedIn.length - 3}`] : [])
              .map((line) => (
                <div key={line} className="break-words">
                  {line}
                </div>
              ))
          : t('lists.p.notUsed')}
      </div>
    </button>
  );
}
