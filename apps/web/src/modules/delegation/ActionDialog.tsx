import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { OrgPerson, TaskAction, TaskActionInput } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { DateTimeInput } from '@/components/ui/date-input';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import type { Uploaded } from '@/lib/upload';
import { isoToLocalInput, localInputToIso } from '@/lib/when';
import { useTaskAction, type TaskRow } from './api';

export function ActionDialog({
  task,
  action,
  onClose,
  people,
  tz,
  verifierName,
}: {
  task: TaskRow;
  action: TaskAction;
  onClose: () => void;
  people: OrgPerson[];
  tz: string;
  verifierName?: string;
}) {
  const { t } = useTranslation();
  const act = useTaskAction();
  const [text, setText] = useState('');
  // Passing on: the next part needs its own time; keep the current one only if it hasn't passed.
  const [when, setWhen] = useState(
    action === 'passOn' && new Date(task.plannedAt) < new Date() ? '' : isoToLocalInput(task.plannedAt, tz),
  );
  const [doer, setDoer] = useState('');
  const [files, setFiles] = useState<Uploaded[]>([]);

  const input = (): TaskActionInput | null => {
    switch (action) {
      case 'decline':
        return text.trim().length >= 3 ? { action, reason: text } : null;
      case 'moveDate':
        return text.trim().length >= 3
          ? { action, plannedAt: localInputToIso(when, tz), reason: text }
          : null;
      case 'addFollowUp':
        return text.trim() ? { action, note: text } : null;
      case 'markDone':
        return text.trim().length >= 3 ? { action, note: text, attachmentIds: files.map((f) => f.id) } : null;
      case 'reject':
        return text.trim().length >= 3 ? { action, comment: text } : null;
      case 'reopen':
        return text.trim().length >= 3 ? { action, comment: text } : null;
      case 'reassign':
        return doer ? { action, doerId: doer, plannedAt: localInputToIso(when, tz) } : null;
      case 'passOn':
        return doer && when && text.trim().length >= 3
          ? {
              action,
              doerId: doer,
              note: text,
              plannedAt: localInputToIso(when, tz),
              attachmentIds: files.map((f) => f.id),
            }
          : null;
      case 'cancel':
        return { action, reason: text || undefined };
      default:
        return null;
    }
  };
  const body = input();
  const nextName = people.find((p) => p.id === doer)?.name ?? '';
  const doneLabel =
    action === 'markDone' && task.verifierId
      ? t('task.dlg.doneSend', { name: verifierName ?? '' })
      : action === 'passOn' && doer
        ? t('task.dlg.passTo', { name: nextName })
        : t(`task.act.${action}`);
  const done = () => {
    if (action === 'passOn') toast.success(t('task.passedTo', { name: nextName }));
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`task.dlg.${action}.title`)}
      description={`#${task.number} · ${task.description.slice(0, 80)}`}
      footer={
        <Button
          variant={action === 'cancel' ? 'destructive' : 'primary'}
          disabled={!body || act.isPending}
          onClick={() => body && act.mutate({ id: task.id, input: body }, { onSuccess: done })}
        >
          {act.isPending && <Loader2 className="animate-spin" />} {doneLabel}
        </Button>
      }
    >
      <div className="space-y-4">
        {action === 'passOn' && (
          <p className="rounded-control bg-muted p-3 text-xs text-muted-foreground">
            {t('task.dlg.passOn.hint')}
          </p>
        )}
        {(action === 'reassign' || action === 'passOn') && (
          <Field label={action === 'passOn' ? `${t('task.dlg.passOn.who')} *` : t('task.doer')}>
            <Select value={doer} onChange={(e) => setDoer(e.target.value)}>
              <option value="">{t('org.choose')}</option>
              {people
                .filter((p) => p.status === 'ACTIVE' && (action !== 'passOn' || p.id !== task.doerId))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {(action === 'moveDate' || action === 'reassign' || action === 'passOn') && (
          <Field label={action === 'passOn' ? `${t('task.dlg.passOn.when')} *` : t('task.dlg.newDate')}>
            <DateTimeInput value={when} onChange={(v) => setWhen(v)} />
          </Field>
        )}
        {action !== 'reassign' && (
          <Field
            label={action === 'passOn' ? `${t('task.dlg.passOn.label')} *` : t(`task.dlg.${action}.label`)}
          >
            <Textarea
              className="font-sans"
              rows={3}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
        )}
        {action === 'passOn' && (
          <Field label={t('task.dlg.passOn.files')}>
            <FileDrop files={files} onChange={setFiles} />
          </Field>
        )}
        {action === 'markDone' && (
          <Field label={task.requireProof ? `${t('task.dlg.proof')} *` : t('task.dlg.proof')}>
            <FileDrop files={files} onChange={setFiles} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
