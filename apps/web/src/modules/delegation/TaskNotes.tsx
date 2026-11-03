import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { formatShortDateTime } from '@/lib/when';
import { useTaskAction, type TaskDetail } from './api';
import { saidOf } from './notes';

type Ev = TaskDetail['events'][number];

/** Notes on a task with the name and time of whoever wrote them, plus a box to add one. */
export function TaskNotes({ task, names, tz }: { task: TaskDetail; names: Map<string, string>; tz: string }) {
  const { t } = useTranslation();
  const act = useTaskAction();
  const [text, setText] = useState('');
  const said = saidOf(task);
  const send = () =>
    text.trim() &&
    act.mutate({ id: task.id, input: { action: 'addNote', note: text } }, { onSuccess: () => setText('') });
  // A reason or done note is logged just before the status change it came with: name it after that change.
  const tag = (e: Ev) => {
    if (e.type === 'passed_on') return t('task.ev.passedTo', { name: names.get(e.toUserId ?? '') ?? '?' });
    if (e.type === 'follow_up') return t('task.ev.follow_up');
    const next = task.events[task.events.indexOf(e) + 1];
    if (e.type !== 'comment' || next?.type !== 'status' || next.actorId !== e.actorId) return null;
    if (next.fromStatus === 'PENDING_VERIFY')
      return next.toStatus === 'DONE' ? t('task.act.verify') : t('task.act.reject');
    if (next.fromStatus === 'DONE' && next.toStatus === 'OPEN') return t('task.act.reopen');
    return next.toStatus === 'PENDING_VERIFY' ? t('task.status.DONE') : t(`task.status.${next.toStatus}`);
  };

  return (
    <div className="space-y-3">
      {said.length === 0 && <p className="text-sm text-muted-foreground">{t('task.notes.empty')}</p>}
      <ul className="space-y-3">
        {said.map((e) => {
          const who = e.actorId ? (names.get(e.actorId) ?? '?') : t('task.system');
          return (
            <li key={e.id} className="flex gap-2.5">
              <Avatar name={who} className="size-8 shrink-0" />
              <div className="min-w-0 flex-1 rounded-control bg-muted px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-semibold">{who}</span>
                  <span className="text-muted-foreground">{formatShortDateTime(e.createdAt, tz)}</span>
                  {tag(e) && (
                    <span className="rounded-pill bg-card px-1.5 py-px text-[11px] font-medium">
                      {tag(e)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{e.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {task.actions.includes('addNote') && (
        <div className="flex items-end gap-2">
          <Textarea
            className="font-sans"
            rows={2}
            value={text}
            placeholder={t('task.notes.placeholder')}
            aria-label={t('task.notes.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
          />
          <Button
            size="icon"
            aria-label={t('task.notes.add')}
            title={t('task.notes.add')}
            disabled={!text.trim() || act.isPending}
            onClick={send}
          >
            {act.isPending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Everything that happened to the task, oldest first. */
export function TaskHistory({
  task,
  names,
  tz,
}: {
  task: TaskDetail;
  names: Map<string, string>;
  tz: string;
}) {
  const { t } = useTranslation();
  const name = (id: string | null) => (id ? (names.get(id) ?? '?') : '?');
  const what = (e: Ev) => {
    if (e.type === 'status') return t('task.ev.status', { to: t(`task.status.${e.toStatus}`) });
    if (e.type === 'date_moved')
      return t('task.ev.moved', {
        from: formatShortDateTime(e.fromDate!, tz),
        to: formatShortDateTime(e.toDate!, tz),
      });
    if (e.type === 'passed_on')
      return t('task.ev.passed_on', { name: name(e.toUserId), due: formatShortDateTime(e.toDate!, tz) });
    if (e.type === 'reassigned')
      return t('task.ev.reassigned', { from: name(e.fromUserId), to: name(e.toUserId) });
    return t(`task.ev.${e.type}`);
  };
  return (
    <ol className="space-y-3 border-l pl-4">
      {task.events.map((e) => (
        <li key={e.id} className="relative text-sm">
          <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-border ring-4 ring-card" />
          <div className="text-xs text-muted-foreground">
            {formatShortDateTime(e.createdAt, tz)} · {e.actorId ? names.get(e.actorId) : t('task.system')}
          </div>
          <div>
            {what(e)}
            {e.note && <span className="text-muted-foreground"> — {e.note}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}
