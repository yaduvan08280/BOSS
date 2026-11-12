import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { FieldsForm } from '@/modules/fms/FieldsForm';
import type { Values } from '@/modules/fms/payload';
import { recordsApi, useRecordsMutation, type RecordDetail, type RecordTypeView } from '../api';
import { LinesEditor } from './LinesEditor';
import { lineFilled, toFormValues, toRecordBody, type LineRows } from './values';

type Problems = {
  fields?: Record<string, string>;
  lines?: Record<string, Record<number, Record<string, string>>>;
};

/** Make a record, or change one: its fields (the shared form) and its child lines. */
export function RecordFormDialog({
  type,
  detail,
  tz,
  people,
  onClose,
  onSaved,
}: {
  type: RecordTypeView;
  /** The record being changed; left out for a new one. */
  detail?: RecordDetail;
  tz: string;
  people: OrgPerson[];
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const def = type.definition;
  const owner = { kind: 'recordType', id: type.id } as const;
  const [values, setValues] = useState<Values>(() =>
    detail ? toFormValues(def.fields, detail.record.data, detail.files, tz) : {},
  );
  const [lines, setLines] = useState<LineRows>(() =>
    Object.fromEntries(
      def.tables.map((x) => [
        x.key,
        (detail?.record.lines[x.key] ?? []).map((r) => toFormValues(x.fields, r, detail?.files ?? [], tz)),
      ]),
    ),
  );
  const [problems, setProblems] = useState<Problems>({});
  const save = useRecordsMutation(
    (body: ReturnType<typeof toRecordBody>) =>
      detail ? recordsApi.update(detail.record.id, body) : recordsApi.create(type.id, body),
    (r) => t(detail ? 'records.form.changed' : 'records.form.made', { code: r.code }),
  );
  const submit = () => {
    // Empty lines are dropped first, so the line numbers in an answer match what is on the screen.
    const kept = Object.fromEntries(
      def.tables.map((x) => [x.key, (lines[x.key] ?? []).filter((r) => lineFilled(x.fields, r))]),
    );
    setLines(kept);
    save.mutate(toRecordBody(def, values, kept, tz), {
      onSuccess: (r) => {
        onSaved?.(r.id);
        onClose();
      },
      onError: (e) => setProblems(e instanceof ApiError ? ((e.details as Problems | undefined) ?? {}) : {}),
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      wide
      title={
        detail
          ? t('records.form.editTitle', { code: detail.record.code })
          : t('records.list.new', { name: type.name })
      }
      description={detail ? detail.record.title : (type.description ?? undefined)}
      footer={
        <Button variant="primary" disabled={save.isPending} onClick={submit}>
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <FieldsForm
          fields={def.fields}
          values={values}
          onChange={setValues}
          errors={problems.fields}
          people={people}
          owner={owner}
        />
        {def.tables.map((table) => (
          <LinesEditor
            key={table.key}
            table={table}
            rows={lines[table.key] ?? []}
            onChange={(rows) => setLines({ ...lines, [table.key]: rows })}
            errors={problems.lines?.[table.key]}
            people={people}
            owner={owner}
            known={values}
          />
        ))}
      </div>
    </Dialog>
  );
}
