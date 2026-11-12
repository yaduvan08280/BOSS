import { FileUp, Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { splitTable } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/form';
import { ApiError } from '@/lib/api';
import { recordsApi, useRecordsMutation, type RecordTypeView } from '../api';

type Problem = { line: number; error: string };

/** Import records from Excel (.xlsx), a CSV or a paste: all or nothing, every problem named with its line. */
export function ImportDialog({ type, onClose }: { type: RecordTypeView; onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [failed, setFailed] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const fields = type.definition.fields.filter(
    (f) => !['photo', 'file', 'signature', 'items', 'formula'].includes(f.type),
  );
  const run = useRecordsMutation(
    () => recordsApi.importTable(type.id, table),
    (r) => t('records.import.done', { count: r.created, from: r.from, to: r.to }),
  );
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setProblems([]);
    setFailed('');
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      const sheet = await readSheet(f);
      const dmy = (c: Date) =>
        `${String(c.getDate()).padStart(2, '0')}/${String(c.getMonth() + 1).padStart(2, '0')}/${c.getFullYear()}`;
      setTable(sheet.map((r) => r.map((c) => (c instanceof Date ? dmy(c) : String(c ?? '')))));
    } else setTable(splitTable(await f.text()));
    setText('');
  };
  const rows = Math.max(0, table.length - 1);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={t('records.import.title', { name: type.pluralName })}
      description={t('records.import.hint', { fields: fields.map((f) => f.label).join(', ') })}
      footer={
        <Button
          variant="primary"
          disabled={!rows || run.isPending}
          onClick={() =>
            run.mutate(undefined, {
              onSuccess: onClose,
              onError: (e) => {
                const lines =
                  e instanceof ApiError ? (e.details as { lines?: Problem[] } | undefined)?.lines : undefined;
                setProblems(lines ?? []);
                setFailed(e instanceof ApiError ? e.message : '');
              },
            })
          }
        >
          {run.isPending && <Loader2 className="animate-spin" />} {t('records.import.go', { count: rows })}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Button onClick={() => file.current?.click()}>
          <FileUp /> {t('records.import.file')}
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
          aria-label={t('records.import.paste')}
          placeholder={`${t('records.import.paste')}\n${fields
            .slice(0, 4)
            .map((f) => f.label)
            .join('\t')}`}
          onChange={(e) => (
            setText(e.target.value),
            setTable(splitTable(e.target.value)),
            setProblems([]),
            setFailed('')
          )}
        />
        {rows > 0 && !problems.length && !failed && (
          <p className="text-sm text-muted-foreground">{t('records.import.found', { count: rows })}</p>
        )}
        {failed && (
          <p role="alert" className="text-sm font-medium text-status-bad-fg">
            {t('records.import.nothingSaved', { message: failed })}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="max-h-56 overflow-auto rounded-control border text-sm">
            {problems.map((p, i) => (
              <li key={i} className="border-t px-3 py-1.5 first:border-t-0">
                <span className="tabular text-muted-foreground">
                  {t('records.import.line', { n: p.line })}
                </span>{' '}
                · <span className="text-status-bad-fg">{p.error}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
