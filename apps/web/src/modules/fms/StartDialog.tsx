import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiError, api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import { useStartForm } from './api';
import { FieldsForm } from './FieldsForm';
import { toPayload, type Values } from './payload';

/** "+ New order": the flow's start form; the first step goes out the moment it is saved. */
export function StartDialog({
  flowId,
  tz,
  people,
  onClose,
  onStarted,
}: {
  flowId: string;
  tz: string;
  people: OrgPerson[];
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const { t } = useTranslation();
  const form = useStartForm(flowId);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const start = useWorkMutation(
    () =>
      api<{ id: string; number: number }>(`/api/fms/flows/${flowId}/records`, {
        method: 'POST',
        body: { data: toPayload(form.data!.fields, values, tz) },
      }),
    [['fms']],
    (r) => t('fms.started', { run: form.data?.runName ?? '', n: r.number }),
  );
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={form.data ? t('fms.newRun', { run: form.data.runName }) : '…'}
      description={form.data?.name}
      footer={
        <Button
          variant="primary"
          disabled={!form.data || start.isPending}
          onClick={() =>
            start.mutate(undefined, {
              onSuccess: (r) => onStarted(r.id),
              onError: (e) =>
                setErrors(
                  ((e instanceof ApiError ? e.details : null) as { fields?: Record<string, string> } | null)
                    ?.fields ?? {},
                ),
            })
          }
        >
          {start.isPending && <Loader2 className="animate-spin" />} {t('fms.start')}
        </Button>
      }
    >
      {!form.data ? (
        <PageSkeleton />
      ) : (
        <FieldsForm
          fields={form.data.fields}
          values={values}
          onChange={setValues}
          errors={errors}
          people={people}
          owner={{ kind: 'flow', id: flowId }}
        />
      )}
    </Dialog>
  );
}
