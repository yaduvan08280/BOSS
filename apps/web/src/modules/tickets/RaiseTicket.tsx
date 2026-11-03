import { Loader2, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ticketCreateSchema, type OrgPerson } from '@mono/shared';
import { personLabel } from '@/lib/people';
import { DateTimeInput } from '@/components/ui/date-input';
import { DictateButton } from '@/components/dictate';
import { FileDrop } from '@/components/file-drop';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import type { Uploaded } from '@/lib/upload';
import { isoToLocalInput, localInputToIso } from '@/lib/when';
import type { TicketRow } from './api';

/** Raise a ticket: what's wrong, who fixes it, by when (defaults to the company's fix time). */
export function RaiseTicket({
  people,
  meId,
  tz,
  fixHours,
  onRaised,
}: {
  people: OrgPerson[];
  meId: string;
  tz: string;
  fixHours: number;
  onRaised: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => ({
    title: '',
    description: '',
    solverId: '',
    plannedFixAt: isoToLocalInput(new Date(Date.now() + fixHours * 3600_000), tz),
  }));
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [error, setError] = useState<string | null>(null);
  const raise = useWorkMutation(
    (body: unknown) => api<TicketRow>('/api/tickets', { method: 'POST', body }),
    [['tickets']],
    (r) => t('ticket.raised', { n: r.number }),
  );
  const submit = () => {
    const parsed = ticketCreateSchema.safeParse({
      ...form,
      plannedFixAt: localInputToIso(form.plannedFixAt, tz),
      attachmentIds: files.map((f) => f.id),
    });
    if (!parsed.success) return setError(form.solverId ? t('ticket.titleShort') : t('ticket.pickSolver'));
    setError(null);
    raise.mutate(parsed.data, {
      onSuccess: (r) => {
        setForm({ ...form, title: '', description: '' });
        setFiles([]);
        onRaised(r.id);
      },
    });
  };

  return (
    <Card className="max-w-3xl">
      <CardContent className="space-y-4 pt-5">
        <Field label={`${t('ticket.what')} *`}>
          <Input
            value={form.title}
            placeholder={t('ticket.whatPh')}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t('ticket.details')}>
          <Textarea
            className="font-sans"
            rows={4}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <DictateButton
          onText={(txt) =>
            setForm((f) => ({ ...f, description: f.description ? `${f.description} ${txt}` : txt }))
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`${t('ticket.solver')} *`}>
            <Select value={form.solverId} onChange={(e) => setForm({ ...form, solverId: e.target.value })}>
              <option value="">{t('org.choose')}</option>
              {people
                .filter((p) => p.status === 'ACTIVE' && p.id !== meId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {personLabel(p)}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label={t('ticket.fixBy')}>
            <DateTimeInput
              value={form.plannedFixAt}
              onChange={(v) => setForm({ ...form, plannedFixAt: v })}
            />
          </Field>
        </div>
        <Field label={t('task.attach')}>
          <FileDrop files={files} onChange={setFiles} />
        </Field>
        {error && <p className="text-sm text-status-bad-fg">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button variant="primary" size="lg" onClick={submit} disabled={raise.isPending}>
            {raise.isPending ? <Loader2 className="animate-spin" /> : <Send />} {t('ticket.submit')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('ticket.submitHint')}</span>
        </div>
      </CardContent>
    </Card>
  );
}
