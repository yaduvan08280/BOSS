import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FlowStep, OrgPerson } from '@mono/shared';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Textarea } from '@/components/ui/form';
import { ApiError, api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import type { Uploaded } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { FieldsForm } from './FieldsForm';
import { toPayload, type Values } from './payload';

/** Do my step: its form, checklist, proof and (for decisions/approvals) the answer. */
export function StepDialog({
  stepId,
  step,
  title,
  tz,
  people,
  onClose,
}: {
  stepId: string;
  step: FlowStep;
  title: string;
  tz: string;
  people: OrgPerson[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Values>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = useWorkMutation(
    (decision?: string) =>
      api(`/api/fms/steps/${stepId}/complete`, {
        method: 'POST',
        body: {
          data: toPayload(step.fields, values, tz),
          checklistDone: ticked,
          decision,
          note: note || undefined,
          attachmentIds: files.map((f) => f.id),
        },
      }),
    [['fms']],
    () => t('fms.stepDone'),
  );
  const submit = (decision?: string) =>
    done.mutate(decision, {
      onSuccess: onClose,
      onError: (e) =>
        setErrors(
          ((e instanceof ApiError ? e.details : null) as { fields?: Record<string, string> } | null)
            ?.fields ?? {},
        ),
    });
  const answers =
    step.type === 'DECISION'
      ? [
          { d: 'yes', label: t('fms.yes') },
          { d: 'no', label: t('fms.no') },
        ]
      : step.type === 'APPROVAL'
        ? [
            { d: 'approved', label: t('fms.approve') },
            { d: 'rejected', label: t('fms.reject') },
          ]
        : null;

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={step.name}
      description={title}
      footer={
        answers ? (
          answers.map((a) => (
            <Button
              key={a.d}
              variant={a.d === 'rejected' || a.d === 'no' ? 'secondary' : 'primary'}
              disabled={done.isPending}
              onClick={() => submit(a.d)}
            >
              {done.isPending && <Loader2 className="animate-spin" />} {a.label}
            </Button>
          ))
        ) : (
          <Button variant="primary" disabled={done.isPending} onClick={() => submit()}>
            {done.isPending && <Loader2 className="animate-spin" />} {t('fms.markDone')}
          </Button>
        )
      }
    >
      <div className="space-y-5">
        {step.fields.length > 0 && (
          <FieldsForm
            fields={step.fields}
            values={values}
            onChange={setValues}
            errors={errors}
            people={people}
          />
        )}
        {step.checklist.length > 0 && (
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-medium">{t('fms.checklist')}</legend>
            {step.checklist.map((c) => (
              <label
                key={c}
                className={cn(
                  'flex items-center gap-2 rounded-control border p-2.5 text-sm',
                  ticked.includes(c) && 'bg-status-ok-bg/40',
                )}
              >
                <Checkbox
                  checked={ticked.includes(c)}
                  onChange={(e) =>
                    setTicked(e.target.checked ? [...ticked, c] : ticked.filter((x) => x !== c))
                  }
                />
                {c}
              </label>
            ))}
          </fieldset>
        )}
        {(step.proofRequired || step.type === 'TASK' || step.type === 'OUTSIDE') && (
          <Field label={step.proofRequired ? `${t('fms.proof')} *` : t('fms.proof')}>
            <FileDrop files={files} onChange={setFiles} />
          </Field>
        )}
        <Field label={step.type === 'APPROVAL' ? t('fms.noteReject') : t('fms.note')}>
          <Textarea className="font-sans" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
