import { FileSpreadsheet, Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { taskCreateSchema, type OrgPerson } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { DateTimeInput } from '@/components/ui/date-input';
import { DictateButton } from '@/components/dictate';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Field, Select, Textarea } from '@/components/ui/form';
import { api } from '@/lib/api';
import type { Uploaded } from '@/lib/upload';
import { defaultPlanned, localInputToIso } from '@/lib/when';
import { useTaskMutation, type TaskRow } from './api';
import { ImportDialog } from './ImportDialog';

export function AddTask({
  people,
  tz,
  meId,
  onCreated,
}: {
  people: OrgPerson[];
  tz: string;
  meId: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    doerId: '',
    plannedAt: defaultPlanned(tz),
    verifierId: '',
    description: '',
    requireProof: false,
  });
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const active = people.filter((p) => p.status === 'ACTIVE');
  const create = useTaskMutation(
    (body: unknown) => api<TaskRow>('/api/tasks', { method: 'POST', body }),
    (r) => t('task.created', { n: r.number, name: active.find((p) => p.id === r.doerId)?.name ?? '' }),
  );

  const submit = () => {
    const body = {
      ...form,
      verifierId: form.verifierId || null,
      plannedAt: localInputToIso(form.plannedAt, tz),
      attachmentIds: files.map((f) => f.id),
    };
    const parsed = taskCreateSchema.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? null);
    setError(null);
    create.mutate(parsed.data, {
      onSuccess: () => {
        setForm({ ...form, description: '', requireProof: false });
        setFiles([]);
        onCreated();
      },
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 pt-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('task.doer')} *`}>
            <Select value={form.doerId} onChange={(e) => setForm({ ...form, doerId: e.target.value })}>
              <option value="">{t('org.choose')}</option>
              <option value={meId}>{t('task.myself')}</option>
              {active
                .filter((p) => p.id !== meId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={`${t('task.col.planned')} *`}>
            <DateTimeInput value={form.plannedAt} onChange={(v) => setForm({ ...form, plannedAt: v })} />
          </Field>
          <Field label={t('task.verifierOptional')} className="sm:col-span-2">
            <Select
              value={form.verifierId}
              onChange={(e) => setForm({ ...form, verifierId: e.target.value })}
            >
              <option value="">{t('task.noVerifier')}</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {personLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`${t('task.description')} *`}>
          <Textarea
            className="font-sans"
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t('task.descriptionPh')}
          />
        </Field>
        <DictateButton
          onText={(txt) =>
            setForm((f) => ({ ...f, description: f.description ? `${f.description} ${txt}` : txt }))
          }
        />
        <Field label={t('task.attach')}>
          <FileDrop files={files} onChange={setFiles} />
        </Field>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={form.requireProof}
            onChange={(e) => setForm({ ...form, requireProof: e.target.checked })}
          />
          <span>{t('task.requireProof')}</span>
        </label>
        {error && <p className="text-sm text-status-bad-fg">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button variant="primary" size="lg" onClick={submit} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('task.submit')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('task.submitHint')}</span>
          <Button className="ml-auto" onClick={() => setImporting(true)}>
            <FileSpreadsheet /> {t('task.importMany')}
          </Button>
        </div>
      </CardContent>
      <ImportDialog open={importing} onClose={() => setImporting(false)} people={active} tz={tz} />
    </Card>
  );
}
