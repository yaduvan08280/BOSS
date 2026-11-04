import { Loader2, Pencil, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { EmployeeTerms } from '@mono/shared';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/ui/date-input';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { matchScore } from '@/lib/pick';
import { useHrMutation } from './api';
import { BASES, payApi, rupees, useTerms, type TermsRow } from './payApi';
import { inr } from './PayMonth';
import { Chips, NumberChoice, Question } from './ui';

const hhmm = (min: number | null | undefined) =>
  min === null || min === undefined
    ? ''
    : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Everyone's work pattern (fixed shift, hours a day, hours a week) and pay (a month, a day or an hour). */
export function PayPeople() {
  const { t } = useTranslation();
  const q = useTerms();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TermsRow | null>(null);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const rows = q.data.filter(
    (r) =>
      !search.trim() ||
      matchScore(search, [r.user.name, r.user.code, r.user.department, r.user.designation].join(' ')) > 0,
  );
  return (
    <div className="space-y-3">
      <Input
        aria-label={t('hr.p.search')}
        placeholder={t('hr.p.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="sm:w-72"
      />
      {!q.data.length ? (
        <EmptyState icon={Users} title={t('hr.a.noTeam')} />
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">{t('common.noMatch')}</p>
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {rows.map((r) => (
            <li
              key={r.user.id}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{r.user.name}</div>
                <div className="text-xs text-muted-foreground">
                  {[r.user.code, r.user.department, r.user.designation].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{patternText(t, r)}</span>
                {r.terms.ratePaise ? (
                  <span className="font-medium tabular-nums">
                    {t(`hr.p.rateOf.${r.terms.payBasis}`, { amount: inr(r.terms.ratePaise) })}
                  </span>
                ) : (
                  <StatusChip tone="warn">{t('hr.p.warn.noRate')}</StatusChip>
                )}
                <Button size="sm" variant="ghost" aria-label={t('common.edit')} onClick={() => setEditing(r)}>
                  <Pencil /> {t('common.edit')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <TermsDialog row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function patternText(t: TFunction, r: TermsRow) {
  const p = r.terms;
  return p.pattern === 'daily'
    ? t('hr.p.hoursDay', { n: p.dailyHours })
    : p.pattern === 'weekly'
      ? t('hr.p.hoursWeek', { n: p.weeklyHours })
      : r.user.shift
        ? t('hr.p.shiftNamed', { name: r.user.shift })
        : t('hr.p.pattern.shift');
}

function TermsDialog({ row, onClose }: { row: TermsRow; onClose: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<EmployeeTerms>({
    ...row.terms,
    dailyHours: row.terms.dailyHours ?? 8,
    weeklyHours: row.terms.weeklyHours ?? 48,
  });
  const [rate, setRate] = useState(row.terms.ratePaise ? String(rupees(row.terms.ratePaise)) : '');
  const ratePaise = Math.round(Number(rate.replace(/[,\s₹]/g, '')) * 100);
  const okRate = rate.trim() !== '' && Number.isFinite(ratePaise) && ratePaise >= 0;
  const save = useHrMutation(
    () => payApi.saveTerms(row.user.id, { ...v, ratePaise }),
    () => t('hr.p.termsSaved', { name: row.user.name }),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={row.user.name}
      description={t('hr.p.termsHint')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!okRate || save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: onClose })}
          >
            {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
          </Button>
        </>
      }
    >
      <Question label={t('hr.p.q.pattern')} hint={t('hr.p.q.patternHint')}>
        <Chips
          label={t('hr.p.q.pattern')}
          value={v.pattern}
          onChange={(pattern) => setV({ ...v, pattern })}
          options={(['shift', 'daily', 'weekly'] as const).map((k) => ({
            value: k,
            label: t(`hr.p.pattern.${k}`),
          }))}
        />
      </Question>
      {v.pattern === 'daily' && (
        <Question label={t('hr.p.q.dailyHours')} hint={t('hr.p.q.dailyHint')}>
          <NumberChoice
            label={t('hr.p.q.dailyHours')}
            value={v.dailyHours ?? 8}
            presets={[4, 6, 8, 9, 10, 12]}
            onChange={(dailyHours) => setV({ ...v, dailyHours })}
            unit="h"
            step={0.5}
            min={1}
            max={16}
          />
        </Question>
      )}
      {v.pattern === 'weekly' && (
        <Question label={t('hr.p.q.weeklyHours')} hint={t('hr.p.q.weeklyHint')}>
          <NumberChoice
            label={t('hr.p.q.weeklyHours')}
            value={v.weeklyHours ?? 48}
            presets={[20, 30, 40, 45, 48]}
            onChange={(weeklyHours) => setV({ ...v, weeklyHours })}
            unit="h"
            min={1}
            max={96}
          />
        </Question>
      )}
      {v.pattern !== 'shift' && (
        <Question label={t('hr.p.q.latest')} hint={t('hr.p.q.latestHint')}>
          <div className="flex items-center gap-2">
            <TimeInput
              aria-label={t('hr.p.q.latest')}
              value={hhmm(v.latestStartMin)}
              onChange={(s) =>
                setV({ ...v, latestStartMin: Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) })
              }
            />
            {v.latestStartMin !== null && v.latestStartMin !== undefined && (
              <Button size="sm" variant="ghost" onClick={() => setV({ ...v, latestStartMin: null })}>
                {t('hr.p.q.noAlert')}
              </Button>
            )}
          </div>
        </Question>
      )}
      <Question label={t('hr.p.q.basis')}>
        <Chips
          label={t('hr.p.q.basis')}
          value={v.payBasis}
          onChange={(payBasis) => setV({ ...v, payBasis })}
          options={BASES.map((k) => ({ value: k, label: t(`hr.p.basis.${k}`) }))}
        />
      </Question>
      <Field label={t(`hr.p.q.rate.${v.payBasis}`)} hint={t('hr.p.q.rateHint')} className="py-4">
        <Input
          inputMode="decimal"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          aria-invalid={rate !== '' && !okRate}
          className="w-44 tabular-nums"
        />
      </Field>
    </Dialog>
  );
}
