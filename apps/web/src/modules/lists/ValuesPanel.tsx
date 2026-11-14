import { ArrowLeft, Eye, EyeOff, ListPlus, Merge, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@mono/shared';
import { EmptyState, ErrorState } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { cn } from '@/lib/utils';
import { listsApi, titleOf, useListsMutation, useListValues, type ListInfo, type ListValue } from './api';
import { MergeDialog, ValueDialog } from './ValueDialogs';

type Doing = { kind: 'add' } | { kind: 'rename'; value: ListValue } | { kind: 'merge'; value: ListValue };

/** One list's values (hidden ones too), most used first: search, add, rename, merge, hide / show again. */
export function ValuesPanel({ list, tz, onBack }: { list: ListInfo; tz: string; onBack: () => void }) {
  const { t } = useTranslation();
  const q = useListValues(list.key);
  const [search, setSearch] = useState('');
  const [doing, setDoing] = useState<Doing | null>(null);
  const hide = useListsMutation(
    (v: ListValue) => listsApi.change(v.id, { hidden: !v.hidden }),
    (r) => t(r.hidden ? 'lists.p.hid' : 'lists.p.shown', { value: r.value }),
  );
  const values = q.data?.values ?? [];
  const shown = values.filter((v) => !search.trim() || matchScore(search, v.value) > 0);
  const add = (
    <Button variant="primary" onClick={() => setDoing({ kind: 'add' })}>
      <Plus /> {t('lists.p.add')}
    </Button>
  );
  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" className="h-11 lg:hidden" onClick={onBack}>
        <ArrowLeft /> {t('lists.p.all')}
      </Button>
      <div className="rounded-card border bg-card p-4">
        <h2 className="break-words text-lg font-semibold">{titleOf(list)}</h2>
        <div className="mt-1 text-sm text-muted-foreground">
          {list.usedIn.length ? (
            <>
              <span>{t('lists.p.usedIn')}: </span>
              {list.usedIn.map((u, i) => (
                <span key={`${u.kind}${u.id}${u.field}`}>
                  {i > 0 && '; '}
                  {t(
                    `lists.p.${u.kind === 'flow' ? 'process' : u.kind === 'master' ? 'master' : 'records'}`,
                  )}{' '}
                  {u.name} · {u.field}
                </span>
              ))}
            </>
          ) : (
            t('lists.p.notUsed')
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={t('lists.p.searchValues')}
          placeholder={t('lists.p.searchValues')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-72"
        />
        <div className="ml-auto">{add}</div>
      </div>
      {q.isPending ? (
        <Skeleton aria-busy className="h-48 rounded-card" />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : !values.length ? (
        <EmptyState
          icon={ListPlus}
          title={t('lists.p.noValues')}
          body={t('lists.p.noValuesBody')}
          action={add}
        />
      ) : !shown.length ? (
        <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {shown.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('break-words font-medium', v.hidden && 'text-muted-foreground')}>
                    {v.value}
                  </span>
                  {v.hidden && <StatusChip tone="neutral">{t('lists.p.hidden')}</StatusChip>}
                </div>
                <div className="tabular text-xs text-muted-foreground">
                  {v.uses
                    ? [
                        t('lists.p.uses', { count: v.uses }),
                        ...(v.lastUsedAt
                          ? [t('lists.p.lastUsed', { date: formatDate(v.lastUsedAt, tz) })]
                          : []),
                      ].join(' · ')
                    : t('lists.p.neverUsed')}
                </div>
              </div>
              <div className="ml-auto flex shrink-0 gap-1">
                <RowButton label={t('lists.p.rename')} onClick={() => setDoing({ kind: 'rename', value: v })}>
                  <Pencil />
                </RowButton>
                <RowButton
                  label={t('lists.p.merge')}
                  disabled={values.length < 2}
                  onClick={() => setDoing({ kind: 'merge', value: v })}
                >
                  <Merge />
                </RowButton>
                <RowButton
                  label={t(v.hidden ? 'lists.p.show' : 'lists.p.hide')}
                  disabled={hide.isPending}
                  onClick={() => hide.mutate(v)}
                >
                  {v.hidden ? <Eye /> : <EyeOff />}
                </RowButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {doing?.kind === 'add' && <ValueDialog list={list} onClose={() => setDoing(null)} />}
      {doing?.kind === 'rename' && (
        <ValueDialog list={list} value={doing.value} onClose={() => setDoing(null)} />
      )}
      {doing?.kind === 'merge' && (
        <MergeDialog
          value={doing.value}
          others={values.filter((v) => v.id !== doing.value.id)}
          onClose={() => setDoing(null)}
        />
      )}
    </div>
  );
}

/** An icon button a thumb can hit (44 px on a phone), named for screen readers and on hover. */
function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-11 sm:size-9"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
