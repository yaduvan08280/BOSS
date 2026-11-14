import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMorning, type CompanyMorning } from './api';
import { dmy, percent, rupees } from './format';
import { Section } from './parts';

function CompanyCard({ c, onUnlink }: { c: CompanyMorning; onUnlink?: () => void }) {
  const { t } = useTranslation();
  const line = (label: string, value: string | number, bad?: boolean) => (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'tabular font-medium',
          bad && 'rounded-pill bg-status-bad-bg px-1.5 text-status-bad-fg',
        )}
      >
        {bad && '▲ '}
        {value}
      </span>
    </div>
  );
  return (
    <div className={cn('rounded-card border bg-card p-4', c.mine && 'border-ink')}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{c.name}</div>
          <div className="text-xs text-muted-foreground">{t('owner.m.day', { day: dmy(c.day) })}</div>
        </div>
        {onUnlink && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onUnlink}
            aria-label={t('owner.m.unlink', { name: c.name })}
          >
            <X />
          </Button>
        )}
      </div>
      <div className="mb-2 text-2xl font-semibold tabular">{rupees(c.sales)}</div>
      {line(t('owner.m.bills'), c.bills)}
      {line(t('owner.m.cash'), c.cashDiff ? rupees(c.cashDiff) : '—', c.cashDiff < 0)}
      {line(t('owner.m.attendance'), percent(c.attendancePct), (c.attendancePct ?? 100) < 85)}
      {line(t('owner.m.overdue'), c.overdue + c.lateSteps, c.overdue + c.lateSteps > 0)}
      {line(t('owner.m.missed'), c.missed, c.missed > 0)}
      {line(t('owner.m.escalated'), c.escalated, c.escalated > 0)}
      {line(t('owner.m.red'), c.red, c.red > 0)}
    </div>
  );
}

/** Yesterday in every company the owner has linked, side by side, with one worst-first list across them. */
export function MorningTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useMorning();
  const [linking, setLinking] = useState(false);
  const [form, setForm] = useState({ identifier: '', password: '' });
  const done = () => void qc.invalidateQueries({ queryKey: ['owner', 'morning'] });
  const link = useMutation({
    mutationFn: () => api<{ name: string }>('/api/owner/companies', { method: 'POST', body: form }),
    onSuccess: (r) => {
      toast.success(t('owner.m.linked', { name: r.name }));
      setLinking(false);
      setForm({ identifier: '', password: '' });
      done();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('common.somethingWrong')),
  });
  const unlink = useMutation({
    mutationFn: (id: string) => api(`/api/owner/companies/${id}`, { method: 'DELETE' }),
    onSuccess: done,
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="space-y-6">
      <Section
        title={t('owner.m.title')}
        hint={t('owner.m.hint')}
        action={
          <Button size="sm" onClick={() => setLinking(true)}>
            <Link2 /> {t('owner.m.link')}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.companies.map((c) => (
            <CompanyCard
              key={c.companyId}
              c={c}
              onUnlink={c.mine ? undefined : () => unlink.mutate(c.companyId)}
            />
          ))}
        </div>
      </Section>
      <Section title={t('owner.m.worst')} hint={t('owner.m.worstHint')}>
        {q.data.worst.length ? (
          <ol className="divide-y rounded-card border bg-card">
            {q.data.worst.map((w, i) => (
              <li key={`${w.company}-${w.key}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">{t(`owner.flag.${w.key}`, { count: w.n })}</span>
                <span className="shrink-0 truncate text-xs text-muted-foreground">{w.company}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">{t('owner.m.calm')}</p>
        )}
      </Section>
      <Dialog
        open={linking}
        onOpenChange={setLinking}
        title={t('owner.m.linkTitle')}
        description={t('owner.m.linkHint')}
        footer={
          <>
            <Button onClick={() => setLinking(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={link.isPending || !form.identifier || !form.password}
              onClick={() => link.mutate()}
            >
              {t('owner.m.link')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 pb-3">
          <Field label={t('owner.m.loginId')}>
            <Input
              value={form.identifier}
              onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Field label={t('owner.m.password')}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
