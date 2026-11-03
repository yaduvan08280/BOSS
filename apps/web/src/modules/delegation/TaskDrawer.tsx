import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson, TaskAction } from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { TabStrip } from '@/components/work';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/when';
import { ActionDialog } from './ActionDialog';
import { DIALOG_ACTIONS, useTask, useTaskAction, type TaskRow } from './api';
import { chainOf, saidOf } from './notes';
import { TaskHistory, TaskNotes } from './TaskNotes';
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
  const [tab, setTab] = useState<'notes' | 'history'>('notes');
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
                {task.passCount > 0 &&
                  row(
                    t('task.chain'),
                    chainOf(task)
                      .map((id) => names.get(id) ?? '?')
                      .join(' → '),
                  )}
                {row(t('task.col.assignedBy'), names.get(task.creatorId))}
                {row(t('task.verifier'), task.verifierId ? names.get(task.verifierId) : '—')}
                {row(t('task.col.planned'), formatDateTime(task.plannedAt, tz))}
                {task.revisionCount > 0 &&
                  row(t('task.firstPlanned'), formatDateTime(task.originalPlannedAt, tz))}
                {task.doneAt && row(t('task.doneOn'), formatDateTime(task.doneAt, tz))}
                {task.requireProof && row(t('task.proofNeeded'), '✓')}
              </div>
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
              <div className="space-y-3">
                <TabStrip
                  tabs={['notes', 'history'] as const}
                  active={tab}
                  onChange={setTab}
                  label={(k) => t(`task.drawerTab.${k}`)}
                  counts={{ notes: saidOf(task).length }}
                />
                {tab === 'notes' ? (
                  <TaskNotes task={task} names={names} tz={tz} />
                ) : (
                  <TaskHistory task={task} names={names} tz={tz} />
                )}
              </div>
            </div>
            {task.actions.some((a) => a !== 'addNote') && (
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {task.actions
                  .filter((a) => a !== 'addNote')
                  .map((a) => (
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
                task={{ ...task, files: task.files.length, notes: 0 } as TaskRow}
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
