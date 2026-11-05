import { ArrowLeft, FileUp, Link2, Loader2, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { formatLocalDate, splitTable, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Confirm, Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { matchScore } from '@/lib/pick';
import { FieldsForm } from '@/modules/fms/FieldsForm';
import { useUsers } from '@/modules/system/api';
import { mastersApi, useMastersMutation, useRows, type MasterRows } from './api';

type Row = MasterRows['rows'][number];

/** One master's rows (CLAUDE.md §8): search, add, change, delete, import from Excel / CSV / a paste / a Google Sheet. */
export function MasterRowsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const q = useRows(id);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const remove = useMastersMutation(
    (rowId: string) => mastersApi.deleteRow(id, rowId),
    () => t('masters.removed'),
  );
  void me;
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const { master, rows, canEdit } = q.data;
  const shown = master.fields
    .filter((f) => !['photo', 'file', 'signature', 'items', 'longtext', 'location'].includes(f.type))
    .slice(0, 5);
  const filtered = rows.filter(
    (r) =>
      !search.trim() ||
      matchScore(search, [r.label, r.key, ...Object.values(r.data).map(String)].join(' ')) > 0,
  );
  const cell = (v: unknown, type: string) =>
    v === undefined || v === null || v === ''
      ? '—'
      : type === 'date' && typeof v === 'string'
        ? formatLocalDate(v)
        : type === 'yesno'
          ? v
            ? t('common.yes')
            : t('common.no')
          : Array.isArray(v)
            ? v.join(', ')
            : String(v);
  return (
    <div className="space-y-5">
      <PageHeader title={master.name} subtitle={master.description ?? t('masters.rowsSubtitle')} />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/masters">
            <ArrowLeft /> {t('nav.myMasters')}
          </Link>
        </Button>
        <Input
          aria-label={t('masters.search')}
          placeholder={t('masters.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 sm:max-w-72"
        />
        <span className="text-sm text-muted-foreground">{t('masters.count', { count: q.data.total })}</span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              <FileUp /> {t('masters.import')}
            </Button>
            <Button onClick={() => setEditing('new')}>
              <Plus /> {t('masters.add')}
            </Button>
          </div>
        )}
      </div>
      {!rows.length ? (
        <EmptyState icon={Table2} title={t('masters.empty')} body={t('masters.emptyBody')} />
      ) : !filtered.length ? (
        <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                {shown.map((f) => (
                  <th key={f.key} className="px-3 py-2 font-medium">
                    {f.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t">
                  {shown.map((f) => (
                    <td
                      key={f.key}
                      className={f.key === master.keyField ? 'px-3 py-2 font-mono text-xs' : 'px-3 py-2'}
                    >
                      {cell(r.data[f.key], f.type)}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    {canEdit && (
                      <>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('common.edit')}
                          onClick={() => setEditing(r)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('common.delete')}
                          onClick={() => setRemoving(r)}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RowDialog
          data={q.data}
          row={editing === 'new' ? null : editing}
          tz={me.company.timezone}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportDialog data={q.data} onClose={() => setImporting(false)} />}
      <Confirm
        open={Boolean(removing)}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('masters.removeTitle', { name: removing?.label ?? '' })}
        body={t('masters.removeBody')}
        confirm={t('common.delete')}
        danger
        onConfirm={() => removing && remove.mutate(removing.id, { onSettled: () => setRemoving(null) })}
      />
    </div>
  );
}

function RowDialog({
  data,
  row,
  onClose,
}: {
  data: MasterRows;
  row: Row | null;
  tz: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const users = useUsers();
  const [values, setValues] = useState<Record<string, unknown>>(row?.data ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMastersMutation(
    () => mastersApi.saveRow(data.master.id, values, row?.id),
    (r) => t('masters.saved', { name: r.label }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={row ? row.label : t('masters.add')}
      footer={
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(undefined, {
              onSuccess: onClose,
              onError: (e) =>
                e instanceof ApiError &&
                setErrors((e.details as { fields?: Record<string, string> })?.fields ?? {}),
            })
          }
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <FieldsForm
        fields={data.master.fields}
        values={values as never}
        onChange={(v) => setValues(v as Record<string, unknown>)}
        errors={errors}
        people={users.data ?? []}
      />
    </Dialog>
  );
}

function ImportDialog({ data, onClose }: { data: MasterRows; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [url, setUrl] = useState('');
  const [problems, setProblems] = useState<{ line: number; error: string }[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const onError = (e: Error) =>
    setProblems(
      e instanceof ApiError
        ? ((e.details as { lines?: { line: number; error: string }[] })?.lines ?? [])
        : [],
    );
  const fromTable = useMastersMutation(
    () => mastersApi.importRows(data.master.id, table),
    (r) => t('masters.imported', { count: r.created }),
  );
  const fromSheet = useMastersMutation(
    () => mastersApi.importSheet(data.master.id, url.trim()),
    (r) => t('masters.imported', { count: r.created }),
  );
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = await readSheet(f);
      setTable(
        sheet.map((r) =>
          r.map((c) =>
            c instanceof Date
              ? `${String(c.getDate()).padStart(2, '0')}/${String(c.getMonth() + 1).padStart(2, '0')}/${c.getFullYear()}`
              : String(c ?? ''),
          ),
        ),
      );
    } else setTable(splitTable(await f.text()));
  };
  const busy = fromTable.isPending || fromSheet.isPending;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={t('masters.import')}
      description={t('masters.importHint', { fields: data.master.fields.map((f) => f.label).join(', ') })}
      footer={
        <Button
          disabled={!table.length || busy}
          onClick={() => fromTable.mutate(undefined, { onSuccess: onClose, onError })}
        >
          {fromTable.isPending && <Loader2 className="animate-spin" />}{' '}
          {t('masters.importRows', { count: Math.max(0, table.length - 1) })}
        </Button>
      }
    >
      <div className="space-y-4">
        <Button variant="secondary" onClick={() => file.current?.click()}>
          <FileUp /> {t('task.openFile')}
        </Button>
        <input
          ref={file}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Textarea
          rows={5}
          value={text}
          aria-label={t('masters.paste')}
          placeholder={data.master.fields
            .slice(0, 4)
            .map((f) => f.label)
            .join('\t')}
          onChange={(e) => (setText(e.target.value), setTable(splitTable(e.target.value)))}
        />
        <Field label={t('masters.sheet')} hint={t('masters.sheetHint')}>
          <div className="flex gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
            <Button
              variant="secondary"
              disabled={!url.trim() || busy}
              onClick={() => fromSheet.mutate(undefined, { onSuccess: onClose, onError })}
            >
              {fromSheet.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}{' '}
              {t('masters.readSheet')}
            </Button>
          </div>
        </Field>
        {problems.length > 0 && (
          <ul className="max-h-48 overflow-auto rounded-control border text-sm">
            {problems.map((p, i) => (
              <li key={i} className="border-t px-3 py-1.5 first:border-t-0">
                <span className="text-muted-foreground">{t('masters.line', { n: p.line })}</span> ·{' '}
                <span className="text-status-bad-fg">{p.error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
