import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { LeagueRow } from './api';
import { dmy, rupees } from './format';
import { Section } from './parts';

type Line = { key: string; now: string; before: string; change: number };
type Letter = {
  company: string;
  week: { from: string; to: string };
  better: Line[];
  worse: Line[];
  decision: { kind: string; text: string; since: string | null; link: string } | null;
};

/** Last week against the week before, on one page. */
export function LetterTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['owner', 'letter'], queryFn: () => api<Letter>('/api/owner/letter') });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const l = q.data;
  const list = (rows: Line[], good: boolean) =>
    rows.length ? (
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span>{t(`owner.w.line.${r.key}`)}</span>
            <span className="tabular shrink-0 text-right">
              <span className="text-muted-foreground">{r.before} → </span>
              <strong>{r.now}</strong>{' '}
              <span
                className={cn('text-xs font-semibold', good ? 'text-status-ok-fg' : 'text-status-bad-fg')}
              >
                {good ? '▲' : '▼'} {Math.abs(r.change)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm text-muted-foreground">{t('owner.w.nothing')}</p>
    );
  return (
    <article className="mx-auto max-w-2xl space-y-5 rounded-card border bg-card p-5 sm:p-7">
      <header>
        <div className="text-xs text-muted-foreground">
          {t('owner.w.week', { from: dmy(l.week.from), to: dmy(l.week.to) })}
        </div>
        <h2 className="text-xl font-semibold">{t('owner.w.title', { company: l.company })}</h2>
      </header>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-status-ok-fg">{t('owner.w.better')}</h3>
        {list(l.better, true)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-status-bad-fg">{t('owner.w.worse')}</h3>
        {list(l.worse, false)}
      </section>
      <section className="rounded-control bg-muted p-4">
        <h3 className="mb-1 text-sm font-semibold">{t('owner.w.decision')}</h3>
        {l.decision ? (
          <p className="text-sm">
            {t(`owner.w.kind.${l.decision.kind}`, { text: l.decision.text })}
            {l.decision.since && (
              <span className="text-muted-foreground">
                {' '}
                · {t('owner.w.since', { day: dmy(l.decision.since) })}
              </span>
            )}{' '}
            <Link to={l.decision.link} className="font-semibold underline">
              {t('owner.w.open')}
            </Link>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('owner.w.noDecision')}</p>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t('owner.w.foot')}</p>
    </article>
  );
}

type Base = {
  from: string;
  to: string;
  monthlySales: number;
  monthlyCost: number;
  costPct: number | null;
  monthlyPayroll: number;
  people: number;
  avgSalary: number;
  weekdays: { share: number; perDay: number }[];
};
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Move the sliders: a price change, more or fewer people, a weekday closed — against a typical month. */
export function WhatIfTab() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['owner', 'whatif'], queryFn: () => api<Base>('/api/owner/what-if') });
  const [price, setPrice] = useState(0);
  const [lost, setLost] = useState(0.5);
  const [staff, setStaff] = useState(0);
  const [closed, setClosed] = useState('');
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const b = q.data;
  // Guests lost: `lost` % of volume for each 1 % of price rise (and gained on a cut).
  const volume = Math.max(0, 1 - (price * lost) / 100);
  const closedShare = closed === '' ? 0 : (b.weekdays[Number(closed)]?.share ?? 0) / 100;
  const sales = b.monthlySales * (1 + price / 100) * volume * (1 - closedShare);
  const cost = b.monthlyCost * volume * (1 - closedShare);
  const payroll = b.monthlyPayroll + staff * b.avgSalary;
  const before = b.monthlySales - b.monthlyCost - b.monthlyPayroll;
  const after = sales - cost - payroll;
  const slider = (
    label: string,
    value: number,
    set: (n: number) => void,
    min: number,
    max: number,
    step: number,
    show: string,
  ) => (
    <Field label={`${label}: ${show}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        aria-label={label}
        className="h-11 w-full accent-[var(--primary)]"
      />
    </Field>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          hero
          label={t('owner.i.after')}
          value={rupees(after)}
          note={t('owner.i.vs', { amount: rupees(after - before) })}
          tone={after < before ? 'bad' : undefined}
        />
        <KpiTile
          label={t('owner.i.sales')}
          value={rupees(sales)}
          note={t('owner.i.was', { amount: rupees(b.monthlySales) })}
        />
        <KpiTile
          label={t('owner.i.cost')}
          value={rupees(cost)}
          note={b.costPct === null ? undefined : t('owner.i.costPct', { pct: b.costPct })}
        />
        <KpiTile
          label={t('owner.i.payroll')}
          value={rupees(payroll)}
          note={t('owner.i.peopleN', { count: b.people + staff })}
        />
      </div>
      <Section title={t('owner.i.title')} hint={t('owner.i.hint', { from: dmy(b.from), to: dmy(b.to) })}>
        <div className="grid grid-cols-1 gap-4 rounded-card border bg-card p-4 sm:grid-cols-2">
          {slider(t('owner.i.price'), price, setPrice, -20, 30, 1, `${price > 0 ? '+' : ''}${price}%`)}
          {slider(t('owner.i.lost'), lost, setLost, 0, 3, 0.1, `${lost}%`)}
          {slider(t('owner.i.staff'), staff, setStaff, -10, 20, 1, `${staff > 0 ? '+' : ''}${staff}`)}
          <Field label={t('owner.i.close')}>
            <Select
              value={closed}
              onChange={(e) => setClosed(e.target.value)}
              aria-label={t('owner.i.close')}
            >
              <option value="">{t('owner.i.noClose')}</option>
              {DAYS.map((d, i) => (
                <option key={d} value={String(i)}>
                  {t(`owner.i.day.${d}`)} — {b.weekdays[i]?.share ?? 0}%
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>
      <p className="text-xs text-muted-foreground">{t('owner.i.foot')}</p>
    </div>
  );
}

/** Copy the best: one branch's checklists made again for another. */
export function CopyBest({ branches }: { branches: LeagueRow[] }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(branches[0]?.branchId ?? '');
  const [to, setTo] = useState('');
  const copy = useMutation({
    mutationFn: () =>
      api<{ copied: number; reason: 'manager' | 'branch' | null }>('/api/owner/copy-checklists', {
        method: 'POST',
        body: { fromBranchId: from, toBranchId: to },
      }),
    onSuccess: (r) =>
      r.reason === 'manager'
        ? toast.error(t('owner.l.needManager'))
        : toast.success(t('owner.l.copied', { count: r.copied })),
  });
  if (branches.length < 2) return null;
  const pick = (value: string, set: (v: string) => void, label: string, skip?: string) => (
    <Field label={label}>
      <Select value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
        <option value="">—</option>
        {branches
          .filter((b) => b.branchId !== skip)
          .map((b) => (
            <option key={b.branchId} value={b.branchId}>
              {b.branch}
            </option>
          ))}
      </Select>
    </Field>
  );
  return (
    <Section title={t('owner.l.copyTitle')} hint={t('owner.l.copyHint')}>
      <div className="grid grid-cols-1 items-end gap-3 rounded-card border bg-card p-4 sm:grid-cols-[1fr_1fr_auto]">
        {pick(from, setFrom, t('owner.l.copyFrom'))}
        {pick(to, setTo, t('owner.l.copyTo'), from)}
        <Button variant="primary" disabled={!from || !to || copy.isPending} onClick={() => copy.mutate()}>
          {t('owner.l.copy')}
        </Button>
      </div>
    </Section>
  );
}
