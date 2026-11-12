import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { listable, type RecordDefinition } from '@mono/shared';
import { Button } from '@/modules/records/ui';
import { cn } from '@/lib/utils';
import type { ListParams, RecordList } from '../api';
import { RecordCell } from './cells';
import { columnLabel } from './columns';

const sortable = (def: RecordDefinition, c: string) =>
  ['code', 'title', 'status', 'createdAt'].includes(c) || def.fields.some((f) => f.key === c && listable(f));

/** The list: a table on wide screens, a card per record under 768 px, and the pager. */
export function RecordTable({
  def,
  data,
  params,
  tz,
  busy,
  onSort,
  onPage,
  onOpen,
}: {
  def: RecordDefinition;
  data: RecordList;
  params: ListParams;
  tz: string;
  busy: boolean;
  onSort: (column: string) => void;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const cols = data.columns;
  const rest = cols.filter((c) => !['code', 'title', 'status'].includes(c));
  const first = (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.total, data.page * data.pageSize);
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className={cn('space-y-3', busy && 'opacity-60')} aria-busy={busy}>
      {/* Wide screens: a table whose headings sort. */}
      <div className="hidden overflow-x-auto rounded-card border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              {cols.map((c) => {
                const on = params.sort === c;
                const numeric = def.fields.some(
                  (f) => f.key === c && ['number', 'amount', 'formula'].includes(f.type),
                );
                return (
                  <th
                    key={c}
                    className={cn('px-3 py-2 font-medium', numeric && 'text-right')}
                    aria-sort={on ? (params.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {sortable(def, c) ? (
                      <button
                        className="inline-flex min-h-8 items-center gap-1 hover:text-foreground"
                        onClick={() => onSort(c)}
                      >
                        {columnLabel(def, c, t)}
                        {on &&
                          (params.dir === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          ))}
                      </button>
                    ) : (
                      columnLabel(def, c, t)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                className="cursor-pointer border-t outline-none hover:bg-muted/40 focus-visible:bg-muted/60"
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
              >
                {cols.map((c) => (
                  <td
                    key={c}
                    className={cn(
                      'max-w-72 truncate px-3 py-2.5',
                      def.fields.some(
                        (f) => f.key === c && ['number', 'amount', 'formula'].includes(f.type),
                      ) && 'text-right',
                    )}
                  >
                    <RecordCell def={def} column={c} row={r} tz={tz} t={t} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: a card per record — number, title and status on top, the other columns as label · value. */}
      <ul className="space-y-2 md:hidden">
        {data.rows.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onOpen(r.id)}
              className="w-full rounded-card border bg-card p-3.5 text-left active:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">{r.code}</div>
                  <div className="mt-0.5 line-clamp-2 text-sm font-semibold">{r.title}</div>
                </div>
                <RecordCell def={def} column="status" row={r} tz={tz} t={t} />
              </div>
              {rest.length > 0 && (
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {rest.map((c) => (
                    <div key={c} className="min-w-0">
                      <dt className="truncate text-muted-foreground">{columnLabel(def, c, t)}</dt>
                      <dd className="truncate text-sm">
                        <RecordCell def={def} column={c} row={r} tz={tz} t={t} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="tabular">{t('records.list.range', { first, last, total: data.total })}</span>
        {pages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="secondary"
              disabled={data.page <= 1}
              aria-label={t('records.list.prev')}
              onClick={() => onPage(data.page - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="tabular px-2">{t('records.list.page', { page: data.page, pages })}</span>
            <Button
              size="icon"
              variant="secondary"
              disabled={data.page >= pages}
              aria-label={t('records.list.next')}
              onClick={() => onPage(data.page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
