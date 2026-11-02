import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, TaskAction } from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { formatDateTime, formatShortDateTime } from '@/lib/when';
import { ActionDialog } from './ActionDialog';
import { DIALOG_ACTIONS, useTask, useTaskAction, type TaskRow } from './api';
import { TaskStatusChips } from './TaskStatus';

/** One task: details, the full timeline, files and every action this person may take. */
export function TaskDrawer({
  id,
  onClose,
  people,
  tz,
}: {
  id: string;
  onClose: () => void;
  people: OrgPerson[];
  tz: string;
}) {
  const { t } = useTranslation();
  const q = useTask(id);
  const act = useTaskAction();
  const [dialog, setDialog] = useState<TaskAction | null>(null);
  const names = new Map(people.map((p) => [p.id, p.name]));
  const task = q.data;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        title={task ? `#${task.number}` : '…'}
        description={task?.description.slice(0, 120)}
      >
        {!task ? (
          <div className="p-5">
            <PageSkeleton />
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
              <TaskStatusChips t={task} names={names} tz={tz} />
              <p className="whitespace-pre-wrap text-sm">{task.description}</p>
              <div>
                {row(t('task.doer'), names.get(task.doerId))}
                {row(t('task.col.assignedBy'), names.get(task.creatorId))}
                {row(t('task.verifier'), task.verifierId ? names.get(task.verifierId) : '—')}
                {row(t('task.col.planned'), formatDateTime(task.plannedAt, tz))}
                {task.revisionCount > 0 &&
                  row(t('task.firstPlanned'), formatDateTime(task.originalPlannedAt, tz))}
                {task.doneAt && row(t('task.doneOn'), formatDateTime(task.doneAt, tz))}
                {task.requireProof && row(t('task.proofNeeded'), '✓')}
              </div>
              {task.doneNote && (
                <div className="rounded-control bg-status-ok-bg p-3 text-sm text-status-ok-fg">
                  {task.doneNote}
                </div>
              )}
              {task.files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {task.files.map((f) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                      {f.mime.startsWith('image/') ? (
                        <img
                          src={f.url}
                          alt={f.originalName}
                          className="size-20 rounded-control border object-cover"
                        />
                      ) : (
                        <span className="flex h-20 w-32 items-center gap-1.5 rounded-control border bg-muted px-2 text-xs">
                          <FileText className="size-4 shrink-0" />
                          <span className="truncate">{f.originalName}</span>
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-2 text-sm font-semibold">{t('task.timeline')}</div>
                <ol className="space-y-3 border-l pl-4">
                  {task.events.map((e) => (
                    <li key={e.id} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-border ring-4 ring-card" />
                      <div className="text-xs text-muted-foreground">
                        {formatShortDateTime(e.createdAt, tz)} ·{' '}
                        {e.actorId ? names.get(e.actorId) : t('task.system')}
                      </div>
                      <div>
                        {e.type === 'status'
                          ? t('task.ev.status', { to: t(`task.status.${e.toStatus}`) })
                          : e.type === 'date_moved'
                            ? t('task.ev.moved', {
                                from: formatShortDateTime(e.fromDate!, tz),
                                to: formatShortDateTime(e.toDate!, tz),
                              })
                            : t(`task.ev.${e.type}`)}
                        {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            {task.actions.length > 0 && (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {task.actions.map((a) => (
                  <Button
                    key={a}
                    size="sm"
                    variant={
                      a === 'accept' || a === 'verify' || a === 'markDone'
                        ? 'primary'
                        : a === 'cancel'
                          ? 'ghost'
                          : 'secondary'
                    }
                    onClick={() =>
                      DIALOG_ACTIONS.includes(a)
                        ? setDialog(a)
                        : act.mutate({ id: task.id, input: { action: a } as never })
                    }
                  >
                    {t(`task.act.${a}`)}
                  </Button>
                ))}
              </div>
            )}
            {dialog && (
              <ActionDialog
                task={{ ...task, files: task.files.length } as TaskRow}
                action={dialog}
                people={people}
                tz={tz}
                verifierName={task.verifierId ? names.get(task.verifierId) : undefined}
                onClose={() => setDialog(null)}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
