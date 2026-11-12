import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Confirm, Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { InfoRow, TabStrip } from '@/components/work';
import { formatShortDateTime } from '@/lib/when';
import { recordsApi, useRecord, useRecordsMutation, type RecordDetail } from './api';
import { FilesTab, HistoryTab, NotesTab } from './drawer/DrawerTabs';
import { RecordFormDialog } from './drawer/RecordFormDialog';
import { fieldText, RecordStatusChip } from './list/cells';

const TABS = ['notes', 'history', 'files'] as const;
type Move = RecordDetail['moves'][number];

/** One record (U4): its number, title and status, fields and child lines, the moves this person may make, and Notes · History · Files. */
export function RecordDrawer({
  id,
  tz,
  people,
  onClose,
}: {
  id: string;
  tz: string;
  people: OrgPerson[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useRecord(id);
  const [tab, setTab] = useState<(typeof TABS)[number]>('notes');
  const [move, setMove] = useState<Move | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const remove = useRecordsMutation(
    () => recordsApi.remove(id),
    () => t('records.drawer.deleted'),
  );
  const d = q.data;
  const def = d?.type.definition;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-xl"
        title={
          d ? (
            <span className="block">
              <span className="block font-mono text-xs font-normal text-muted-foreground">
                {d.record.code}
              </span>
              <span className="block">{d.record.title}</span>
            </span>
          ) : (
            '…'
          )
        }
        description={
          d
            ? t('records.drawer.madeBy', {
                name: d.record.createdBy ?? '—',
                at: formatShortDateTime(d.record.createdAt, tz),
              })
            : undefined
        }
      >
        {q.isError ? (
          <div className="p-5">
            <ErrorState onRetry={() => void q.refetch()} />
          </div>
        ) : !d || !def ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <RecordStatusChip def={def} status={d.record.status} />
                <span className="ml-auto flex gap-1">
                  {d.can.edit && (
                    <Button size="sm" onClick={() => setEditing(true)}>
                      <Pencil /> {t('common.edit')}
                    </Button>
                  )}
                  {d.can.delete && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </span>
              </div>
              <div>
                {def.fields
                  .filter((f) => !['photo', 'file', 'signature', 'items'].includes(f.type))
                  .map((f) => (
                    <InfoRow key={f.key} label={f.label}>
                      <span className="whitespace-pre-wrap break-words">
                        {fieldText(f, d.record.data[f.key], tz, t)}
                      </span>
                    </InfoRow>
                  ))}
              </div>
              {def.tables.map((table) => {
                const rows = d.record.lines[table.key] ?? [];
                return (
                  <section key={table.key} className="space-y-2">
                    <h3 className="text-sm font-semibold">
                      {table.label} <span className="font-normal text-muted-foreground">· {rows.length}</span>
                    </h3>
                    {rows.length === 0 && (
                      <p className="text-sm text-muted-foreground">{t('records.form.noLines')}</p>
                    )}
                    {rows.map((row, i) => (
                      <dl
                        key={i}
                        className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-control border bg-muted/30 p-3 text-sm"
                      >
                        {table.fields
                          .filter((f) => !['photo', 'file', 'signature', 'items'].includes(f.type))
                          .map((f) => (
                            <div key={f.key} className="min-w-0">
                              <dt className="truncate text-xs text-muted-foreground">{f.label}</dt>
                              <dd className="break-words">{fieldText(f, row[f.key], tz, t)}</dd>
                            </div>
                          ))}
                      </dl>
                    ))}
                  </section>
                );
              })}
              <TabStrip
                tabs={TABS}
                active={tab}
                onChange={setTab}
                label={(k) => t(`records.drawer.tab.${k}`)}
                counts={{
                  notes: d.events.filter((e) => e.note).length,
                  files: d.files.length,
                }}
              />
              {tab === 'notes' && <NotesTab detail={d} tz={tz} />}
              {tab === 'history' && <HistoryTab detail={d} tz={tz} />}
              {tab === 'files' && <FilesTab detail={d} />}
            </div>
            {d.moves.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {d.moves.map((m, i) => (
                  <Button
                    key={m.action}
                    variant={i === 0 ? 'primary' : 'secondary'}
                    onClick={() => setMove(m)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
        {d && move && <MoveDialog detail={d} move={move} onClose={() => setMove(null)} />}
        {d && editing && (
          <RecordFormDialog
            type={d.type}
            detail={d}
            tz={tz}
            people={people}
            onClose={() => setEditing(false)}
          />
        )}
        <Confirm
          open={deleting}
          onOpenChange={setDeleting}
          title={t('records.drawer.deleteTitle', { code: d?.record.code ?? '' })}
          body={t('records.drawer.deleteBody')}
          confirm={t('common.delete')}
          danger
          onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })}
        />
      </SheetContent>
    </Sheet>
  );
}

/** Make a move: says where the record goes, and takes the note (needed when the move asks why). */
function MoveDialog({ detail, move, onClose }: { detail: RecordDetail; move: Move; onClose: () => void }) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const def = detail.type.definition;
  const act = useRecordsMutation(
    () => recordsApi.move(detail.record.id, move.action, note.trim()),
    () =>
      t('records.drawer.moved', { status: def.statuses.find((s) => s.key === move.to)?.label ?? move.to }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={move.label}
      description={`${detail.record.code} · ${detail.record.title}`}
      footer={
        <Button
          variant="primary"
          disabled={act.isPending || (move.noteRequired && !note.trim())}
          onClick={() => act.mutate(undefined, { onSuccess: onClose })}
        >
          {act.isPending && <Loader2 className="animate-spin" />} {move.label}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <RecordStatusChip def={def} status={detail.record.status} />
          <span aria-hidden>→</span>
          <RecordStatusChip def={def} status={move.to} />
        </div>
        <Field label={move.noteRequired ? `${t('records.drawer.why')} *` : t('records.drawer.noteOptional')}>
          <Textarea
            className="min-h-20 font-sans"
            rows={3}
            autoFocus
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
