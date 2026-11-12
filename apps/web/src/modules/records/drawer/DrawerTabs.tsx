import { FileText, Loader2, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/modules/records/ui';
import { Textarea } from '@/components/ui/form';
import type { Uploaded } from '@/lib/upload';
import { formatShortDateTime } from '@/lib/when';
import { recordsApi, useRecordsMutation, type RecordDetail, type RecordEventRow } from '../api';

function Entry({ e, tz, title }: { e: RecordEventRow; tz: string; title: string }) {
  return (
    <li className="relative text-sm">
      <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
      <div className="text-xs text-muted-foreground">
        <span className="tabular">{formatShortDateTime(e.at, tz)}</span> · {e.by ?? 'MONO'}
      </div>
      <div className="font-medium">{title}</div>
      {e.note && <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{e.note}</p>}
    </li>
  );
}

/** Everything people wrote on the record (notes, and the reasons given with a move), and a box to add a note. */
export function NotesTab({ detail, tz }: { detail: RecordDetail; tz: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const add = useRecordsMutation(() => recordsApi.note(detail.record.id, text.trim()));
  const written = detail.events.filter((e) => e.note);
  return (
    <div className="space-y-4">
      {written.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('records.drawer.noNotes')}</p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {written.map((e) => (
            <Entry
              key={e.id}
              e={e}
              tz={tz}
              title={e.type === 'status' ? (e.data?.label ?? t('records.ev.status')) : t('records.ev.note')}
            />
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <Textarea
          className="min-h-20 font-sans"
          rows={2}
          maxLength={2000}
          value={text}
          aria-label={t('records.drawer.notePh')}
          placeholder={t('records.drawer.notePh')}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!text.trim() || add.isPending}
            onClick={() => add.mutate(undefined, { onSuccess: () => setText('') })}
          >
            {add.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('records.drawer.addNote')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Every change, oldest first: made, changed (which fields), each move, notes, files. */
export function HistoryTab({ detail, tz }: { detail: RecordDetail; tz: string }) {
  const { t } = useTranslation();
  const title = (e: RecordEventRow): string => {
    switch (e.type) {
      case 'created':
        return e.data?.imported ? t('records.ev.imported') : t('records.ev.created');
      case 'changed':
        return t('records.ev.changed', { fields: (e.data?.fields ?? []).join(', ') });
      case 'status':
        return t('records.ev.moved', {
          move: e.data?.label ?? '',
          from: e.data?.from ?? '',
          to: e.data?.to ?? '',
        });
      case 'note':
        return t('records.ev.note');
      case 'file':
        return t('records.ev.file', { files: (e.data?.files ?? []).join(', ') });
      case 'file_removed':
        return t('records.ev.fileRemoved', { files: (e.data?.files ?? []).join(', ') });
      default:
        return t('records.ev.deleted');
    }
  };
  return (
    <ol className="space-y-3 border-l pl-4">
      {detail.events.map((e) => (
        <Entry key={e.id} e={e} tz={tz} title={title(e)} />
      ))}
    </ol>
  );
}

/** Files on the record: open, add (for people who may change it), take off. */
export function FilesTab({ detail }: { detail: RecordDetail }) {
  const { t } = useTranslation();
  const [fresh, setFresh] = useState<Uploaded[]>([]);
  const id = detail.record.id;
  const add = useRecordsMutation(
    (ids: string[]) => recordsApi.addFiles(id, ids),
    () => t('records.drawer.fileAdded'),
  );
  const remove = useRecordsMutation(
    (fileId: string) => recordsApi.removeFile(id, fileId),
    () => t('records.drawer.fileRemoved'),
  );
  return (
    <div className="space-y-4">
      {detail.files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('records.drawer.noFiles')}</p>
      ) : (
        <ul className="divide-y rounded-control border">
          {detail.files.map((f) => (
            <li key={f.id} className="flex min-h-12 items-center gap-2 px-3">
              {f.mime.startsWith('image/') ? (
                <img src={f.url} alt="" className="size-9 rounded border object-cover" />
              ) : (
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm underline-offset-2 hover:underline"
              >
                {f.name}
              </a>
              {detail.can.files && !f.inField && (
                <Button
                  size="icon"
                  variant="ghost"
                  disabled={remove.isPending}
                  aria-label={t('records.drawer.removeFile', { name: f.name })}
                  onClick={() => remove.mutate(f.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.can.files && (
        <FileDrop
          files={fresh}
          pasteTarget={false}
          onChange={(list) => {
            // Each file is attached as soon as it is uploaded.
            const added = list.filter((f) => !fresh.some((x) => x.id === f.id));
            setFresh(list);
            if (added.length)
              add.mutate(
                added.map((f) => f.id),
                { onSuccess: () => setFresh([]) },
              );
          }}
        />
      )}
    </div>
  );
}
