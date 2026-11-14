import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { DataList, Section } from './parts';

type Row = {
  id: string;
  text: string;
  checklist: string;
  status: 'ASKED' | 'ANSWERED' | 'OK' | 'NOT_OK' | 'MISSED';
  askedAt: string;
  photoUrl: string | null;
  doer: string;
  note: string | null;
};
type Data = {
  rules: { perDay: number; minutes: number };
  people: { userId: string; name: string; asked: number; ok: number; notOk: number; missed: number }[];
  latest: Row[];
};
const TONE: Record<Row['status'], string> = {
  ASKED: 'bg-status-info-bg text-status-info-fg',
  ANSWERED: 'bg-status-warn-bg text-status-warn-fg',
  OK: 'bg-status-ok-bg text-status-ok-fg',
  NOT_OK: 'bg-status-bad-bg text-status-bad-fg',
  MISSED: 'bg-status-over-bg text-status-over-fg',
};
const when = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Surprise checks: a ticked checklist item is asked for again, with a photo taken now. */
export function SpotTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner', 'spot'], queryFn: () => api<Data>('/api/owner/spot-checks') });
  const [draft, setDraft] = useState<Data['rules'] | null>(null);
  const again = () => void qc.invalidateQueries({ queryKey: ['owner', 'spot'] });
  const save = useMutation({
    mutationFn: (rules: Data['rules']) =>
      api('/api/owner/spot-checks', { method: 'PUT', body: JSON.stringify(rules) }),
    onSuccess: () => {
      toast.success(t('org.saved'));
      setDraft(null);
      again();
    },
  });
  const ask = useMutation({
    mutationFn: () => api<{ asked: boolean }>('/api/owner/spot-checks/ask', { method: 'POST' }),
    onSuccess: (r) => {
      if (r.asked) toast.success(t('owner.s.asked'));
      else toast.message(t('owner.s.nothing'));
      again();
    },
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const rules = draft ?? d.rules;
  return (
    <div className="space-y-6">
      <Section title={t('owner.s.rule')} hint={t('owner.s.ruleHint')}>
        <div className="flex flex-wrap items-end gap-3 rounded-card border bg-card p-4">
          <Field label={t('owner.s.perDay')} className="w-40">
            <Select
              value={String(rules.perDay)}
              onChange={(e) => setDraft({ ...rules, perDay: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? t('owner.s.off') : n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('owner.s.minutes')} className="w-40">
            <Select
              value={String(rules.minutes)}
              onChange={(e) => setDraft({ ...rules, minutes: Number(e.target.value) })}
            >
              {[10, 20, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" disabled={!draft || save.isPending} onClick={() => save.mutate(rules)}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" disabled={ask.isPending} onClick={() => ask.mutate()}>
            {t('owner.s.askNow')}
          </Button>
        </div>
      </Section>
      <Section title={t('owner.s.people')} hint={t('owner.s.peopleHint')}>
        <DataList
          rows={d.people}
          rowKey={(r) => r.userId}
          empty={t('owner.s.none')}
          columns={[
            { key: 'name', label: t('owner.col.person'), cell: (r) => r.name },
            { key: 'asked', label: t('owner.s.askedCol'), num: true, cell: (r) => r.asked },
            { key: 'ok', label: t('owner.s.status.OK'), num: true, cell: (r) => r.ok },
            { key: 'notOk', label: t('owner.s.status.NOT_OK'), num: true, cell: (r) => r.notOk },
            { key: 'missed', label: t('owner.s.status.MISSED'), num: true, cell: (r) => r.missed },
          ]}
        />
      </Section>
      {d.latest.length > 0 && (
        <Section title={t('owner.s.latest')}>
          <ul className="space-y-2">
            {d.latest.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-card border bg-card p-3 text-sm">
                {r.photoUrl && (
                  <a href={r.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={r.photoUrl} alt="" className="size-12 rounded-control border object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className="break-words font-medium">{r.text}</div>
                  <div className="text-xs break-words text-muted-foreground">
                    {r.doer} · {r.checklist} · {when(r.askedAt)}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                </div>
                <span className={`shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}>
                  {t(`owner.s.status.${r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
