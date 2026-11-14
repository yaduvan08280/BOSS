import { Archive, ArchiveRestore, List, Pencil, Plus, Shapes, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { financialYear, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/modules/records/ui';
import { Card } from '@/components/ui/card';
import { Confirm } from '@/components/ui/dialog';
import { AiDraftDialog } from './AiDraftDialog';
import { recordsApi, useRecordsMutation, useRecordTypes, type RecordTypeView } from './api';
import { RECORD_ICON } from './icons';
import { RECORD_MENU_SECTIONS } from './menu';

/** Record types (plan §2.6): the company's own things — a site visit, a prescription, a trip — as cards. */
export function RecordTypesPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const q = useRecordTypes();
  const [removing, setRemoving] = useState<RecordTypeView | null>(null);
  const [asking, setAsking] = useState(false);
  const archive = useRecordsMutation(
    (x: RecordTypeView) =>
      x.status === 'ACTIVE' ? recordsApi.archiveType(x.id) : recordsApi.restoreType(x.id),
    () => t('records.types.statusSaved'),
  );
  const remove = useRecordsMutation(
    (id: string) => recordsApi.deleteType(id),
    () => t('records.types.deleted'),
  );
  const fy = financialYear(new Date(), me.company.timezone).short;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const { types, canAdmin } = q.data;
  const add = canAdmin && (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setAsking(true)}>
        <Sparkles /> {t('recordsReach.ai.button')}
      </Button>
      <Button asChild>
        <Link to="/records/types/new">
          <Plus /> {t('records.types.new')}
        </Link>
      </Button>
    </div>
  );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('records.types.intro')}</p>
        {add}
      </div>
      {!types.length ? (
        <EmptyState
          icon={Shapes}
          title={t('records.types.none')}
          body={t('records.types.noneBody')}
          action={add || undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {types.map((x) => {
            const Icon = RECORD_ICON[x.menu.icon];
            const section = x.menu.section;
            return (
              <Card key={x.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-control bg-accent-soft text-accent-soft-foreground">
                    <Icon className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{x.pluralName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {x.prefix}/{fy}/0001
                    </div>
                  </div>
                  <StatusChip tone={x.status === 'ACTIVE' ? 'ok' : 'neutral'}>
                    {t(x.status === 'ACTIVE' ? 'records.types.active' : 'records.types.archived')}
                  </StatusChip>
                </div>
                {x.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{x.description}</p>
                )}
                <dl className="grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                  {(
                    [
                      [x.records ?? 0, t('records.types.nRecords')],
                      [x.definition.fields.length, t('records.types.nFields')],
                      [x.definition.statuses.length, t('records.types.nStatuses')],
                    ] as const
                  ).map(([n, label]) => (
                    <div key={label} className="rounded-control bg-muted/60 py-2">
                      <dd className="tabular text-base font-semibold text-foreground">{n}</dd>
                      <dt>{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  {section === null
                    ? t('records.types.menuHidden')
                    : t('records.types.menuIn', {
                        section: RECORD_MENU_SECTIONS.includes(section) ? t(`section.${section}`) : section,
                      })}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/records/${x.id}`}>
                      <List /> {t('records.types.open')}
                    </Link>
                  </Button>
                  {x.access.admin && (
                    <>
                      <Button asChild size="sm" variant="secondary">
                        <Link to={`/records/types/${x.id}`}>
                          <Pencil /> {t('records.types.setUp')}
                        </Link>
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="ml-auto"
                        disabled={archive.isPending}
                        aria-label={t(
                          x.status === 'ACTIVE' ? 'records.types.archive' : 'records.types.restore',
                        )}
                        title={t(x.status === 'ACTIVE' ? 'records.types.archive' : 'records.types.restore')}
                        onClick={() => archive.mutate(x)}
                      >
                        {x.status === 'ACTIVE' ? <Archive /> : <ArchiveRestore />}
                      </Button>
                      {!x.records && (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                          onClick={() => setRemoving(x)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Confirm
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('records.types.deleteTitle', { name: removing?.name ?? '' })}
        body={t('records.types.deleteBody')}
        confirm={t('common.delete')}
        danger
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
      {asking && <AiDraftDialog onClose={() => setAsking(false)} />}
    </div>
  );
}
