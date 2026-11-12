import { Columns3, Download, FileUp, ListFilter, Plus, Search, Settings2, Table2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { Me } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/modules/records/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useUsers } from '@/modules/system/api';
import { downloadExport, useRecordList, useRecordType, type ListParams, type RecordTypeView } from './api';
import { RecordFormDialog } from './drawer/RecordFormDialog';
import { columnLabel } from './list/columns';
import { ColumnsDialog } from './list/ColumnsDialog';
import { FiltersDialog } from './list/FiltersDialog';
import { ImportDialog } from './list/ImportDialog';
import { RecordTable } from './list/RecordTable';
import { ViewsMenu } from './list/ViewsMenu';
import { RecordDrawer } from './RecordDrawer';

/** A record type's own list screen (U4, U5): `/records/:typeId`. */
export function RecordListPage({ me }: { me: Me }) {
  const { typeId = '' } = useParams();
  const q = useRecordType(typeId);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError)
    return q.error instanceof ApiError && q.error.status === 403 ? (
      <NoAccess message={q.error.message} />
    ) : (
      <ErrorState onRetry={() => void q.refetch()} />
    );
  // A fresh list per type, so one type's filters never leak into another's.
  return <TypeList key={q.data.id} type={q.data} me={me} />;
}

function NoAccess({ message }: { message: string }) {
  const { t } = useTranslation();
  return <EmptyState icon={Table2} title={message} body={t('records.list.noAccess')} />;
}

type Dialogs = 'new' | 'filters' | 'columns' | 'import' | null;

function TypeList({ type, me }: { type: RecordTypeView; me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const def = type.definition;
  const people = useUsers().data ?? [];
  const [search, setSearch] = useSearchParams();
  const open = search.get('record');
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set('record', id);
    else next.delete('record');
    setSearch(next, { replace: true });
  };
  const [params, setParams] = useState<ListParams>({});
  const [typed, setTyped] = useState('');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [viewName, setViewName] = useState<string | null>(null);
  // The search runs on the server a moment after typing stops.
  useEffect(() => {
    const timer = setTimeout(
      () => setParams((p) => (p.q === typed ? p : { ...p, q: typed || undefined, page: 1 })),
      300,
    );
    return () => clearTimeout(timer);
  }, [typed]);
  const patch = (p: Partial<ListParams>) => {
    setParams((old) => ({ ...old, page: 1, ...p }));
    setViewName(null);
  };
  const list = useRecordList(type.id, params);
  const data = list.data;
  const canAdd = type.access.create && type.status === 'ACTIVE';
  const statusOn = params.status ?? [];
  const all = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0);
  const extra = (params.filters?.length ?? 0) + (params.from || params.to ? 1 : 0);
  const { page: _page, pageSize: _size, ...config } = params;
  const exportAs = (format: 'csv' | 'xlsx', everything: boolean) =>
    downloadExport(type.id, params, format, everything).catch((e: Error) => toast.error(e.message));
  const toggleStatus = (key: string) =>
    patch({ status: statusOn.includes(key) ? statusOn.filter((s) => s !== key) : [...statusOn, key] });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">
            {type.pluralName}
          </h1>
          {type.description && <p className="mt-0.5 text-sm text-muted-foreground">{type.description}</p>}
        </div>
        {type.access.admin && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/records/types/${type.id}`}>
              <Settings2 /> {t('records.types.setUp')}
            </Link>
          </Button>
        )}
        {canAdd && (
          <Button variant="primary" onClick={() => setDialog('new')}>
            <Plus /> {t('records.list.new', { name: type.name })}
          </Button>
        )}
      </div>
      {type.status === 'ARCHIVED' && (
        <p className="rounded-control bg-status-neutral-bg px-3 py-2 text-sm text-status-neutral-fg">
          {t('records.list.archived')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-64 md:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            value={typed}
            aria-label={t('records.list.search')}
            placeholder={t('records.list.search')}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <Button onClick={() => setDialog('filters')}>
          <ListFilter /> {t('records.filter.title')}
          {extra > 0 && <Badge className="bg-primary text-primary-foreground">{extra}</Badge>}
        </Button>
        <Button onClick={() => setDialog('columns')} aria-label={t('records.list.columns')}>
          <Columns3 /> <span className="max-sm:sr-only">{t('records.list.columns')}</span>
        </Button>
        <ViewsMenu
          typeId={type.id}
          current={{ ...config, columns: params.columns ?? data?.columns }}
          canShare={type.access.edit}
          canAdmin={type.access.admin}
          onPick={(v) => {
            setParams({ ...v.config, page: 1 });
            setTyped(v.config.q ?? '');
            setViewName(v.name);
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label={t('records.list.export')}>
              <Download /> <span className="max-sm:sr-only">{t('records.list.export')}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-11" onSelect={() => void exportAs('xlsx', false)}>
              {t('records.list.exportXlsx')}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => void exportAs('csv', false)}>
              {t('records.list.exportCsv')}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => void exportAs('xlsx', true)}>
              {t('records.list.exportAll')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {canAdd && (
          <Button onClick={() => setDialog('import')} aria-label={t('records.list.import')}>
            <FileUp /> <span className="max-sm:sr-only">{t('records.list.import')}</span>
          </Button>
        )}
      </div>

      {/* Status chips with counts: tap to show only those. */}
      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1.5">
          <Chip
            on={!statusOn.length}
            onClick={() => patch({ status: undefined })}
            count={data ? all : undefined}
          >
            {t('records.list.all')}
          </Chip>
          {def.statuses.map((s) => (
            <Chip
              key={s.key}
              on={statusOn.includes(s.key)}
              onClick={() => toggleStatus(s.key)}
              count={data?.counts[s.key] ?? 0}
            >
              {s.label}
            </Chip>
          ))}
        </div>
      </div>
      {(viewName || extra > 0 || params.sort) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {viewName && <Tag>{t('records.views.showing', { name: viewName })}</Tag>}
          {(params.from || params.to) && (
            <Tag onRemove={() => patch({ from: undefined, to: undefined })}>{t('records.filter.madeOn')}</Tag>
          )}
          {(params.filters ?? []).map((f, i) => (
            <Tag key={i} onRemove={() => patch({ filters: params.filters!.filter((_, j) => j !== i) })}>
              {columnLabel(def, f.field, t)}
              {f.value ? `: ${f.value}` : ''}
            </Tag>
          ))}
          {params.sort && (
            <Tag onRemove={() => patch({ sort: undefined, dir: undefined })}>
              {t('records.filter.sortedBy', { column: columnLabel(def, params.sort, t) })}
            </Tag>
          )}
        </div>
      )}

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState onRetry={() => void list.refetch()} />
      ) : !data!.rows.length ? (
        all === 0 && !params.q && !extra ? (
          <EmptyState
            icon={Table2}
            title={t('records.list.empty', { name: type.pluralName })}
            body={canAdd ? t('records.list.emptyBody') : undefined}
            action={
              canAdd && (
                <Button variant="primary" onClick={() => setDialog('new')}>
                  <Plus /> {t('records.list.new', { name: type.name })}
                </Button>
              )
            }
          />
        ) : (
          <EmptyState icon={Search} title={t('records.list.noMatch')} body={t('records.list.noMatchBody')} />
        )
      ) : (
        <RecordTable
          def={def}
          data={data!}
          params={params}
          tz={tz}
          busy={list.isFetching && list.isPlaceholderData}
          onSort={(c) => patch({ sort: c, dir: params.sort === c && params.dir === 'asc' ? 'desc' : 'asc' })}
          onPage={(page) => setParams((p) => ({ ...p, page }))}
          onOpen={setOpen}
        />
      )}

      {dialog === 'new' && (
        <RecordFormDialog
          type={type}
          tz={tz}
          people={people}
          onClose={() => setDialog(null)}
          onSaved={setOpen}
        />
      )}
      {dialog === 'filters' && (
        <FiltersDialog def={def} params={params} onApply={patch} onClose={() => setDialog(null)} />
      )}
      {dialog === 'columns' && data && (
        <ColumnsDialog
          def={def}
          columns={data.columns}
          onSave={(columns) => patch({ columns })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'import' && <ImportDialog type={type} onClose={() => setDialog(null)} />}
      {open && <RecordDrawer id={open} tz={tz} people={people} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Chip({
  on,
  count,
  onClick,
  children,
}: {
  on: boolean;
  count?: number;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-pill border px-3.5 text-sm sm:h-9',
        on ? 'border-ink bg-ink font-medium text-ink-foreground' : 'bg-card hover:bg-muted',
      )}
    >
      {children}
      {count !== undefined && <span className="tabular text-xs opacity-75">{count}</span>}
    </button>
  );
}

/** A filter in force. A removable one is one big button (44 px on phones): tap it to drop the filter. */
function Tag({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  const { t } = useTranslation();
  const cls =
    'inline-flex min-h-11 items-center gap-1.5 rounded-pill bg-muted px-3 text-muted-foreground sm:min-h-8';
  if (!onRemove) return <span className={cls}>{children}</span>;
  return (
    <button className={cn(cls, 'hover:bg-border')} title={t('records.filter.remove')} onClick={onRemove}>
      {children}
      <X className="size-3.5" aria-hidden />
      <span className="sr-only">{t('records.filter.remove')}</span>
    </button>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy className="space-y-2">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-card bg-muted md:h-11" />
      ))}
    </div>
  );
}
