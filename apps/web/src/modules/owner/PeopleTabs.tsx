import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import {
  useBusFactor,
  useDelay,
  useLeaks,
  usePromises,
  type BusFactor,
  type Delay,
  type Leaks,
  type Promises,
  type Span,
} from './api';
import { percent, rupees } from './format';
import { DataList, Flagged, Section, type Column } from './parts';

/** Where money may be leaking, by person. */
export function LeaksTab({ span }: { span: Span }) {
  const { t } = useTranslation();
  const q = useLeaks(span);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const cols: Column<Leaks['people'][number]>[] = [
    {
      key: 'name',
      label: t('owner.col.person'),
      head: true,
      cell: (r) => (
        <span>
          {r.name}
          <span className="block text-xs font-normal text-muted-foreground">{r.branch}</span>
        </span>
      ),
    },
    { key: 'total', label: t('owner.k.total'), num: true, cell: (r) => <strong>{rupees(r.total)}</strong> },
    {
      key: 'voids',
      label: t('owner.k.voids'),
      num: true,
      cell: (r) => (r.voids ? `${rupees(r.voids)} · ${r.voidCount}` : '—'),
    },
    {
      key: 'disc',
      label: t('owner.k.discounts'),
      num: true,
      cell: (r) => (r.discounts ? rupees(r.discounts) : '—'),
    },
    { key: 'nc', label: t('owner.k.noCharge'), num: true, cell: (r) => r.noCharge || '—' },
    {
      key: 'cancel',
      label: t('owner.k.cancelled'),
      num: true,
      cell: (r) => (r.cancelled ? rupees(r.cancelled) : '—'),
    },
    {
      key: 'cash',
      label: t('owner.k.cashShort'),
      num: true,
      cell: (r) => (r.cashShort ? rupees(r.cashShort) : '—'),
    },
    {
      key: 'waste',
      label: t('owner.k.wastage'),
      num: true,
      cell: (r) => (r.wastage ? rupees(r.wastage) : '—'),
    },
  ];
  const share = d.sales ? Math.round((d.totals.all / d.sales) * 1000) / 10 : null;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiTile
          hero
          label={t('owner.k.total')}
          value={rupees(d.totals.all)}
          note={share === null ? undefined : t('owner.k.ofSales', { pct: share })}
        />
        <KpiTile label={t('owner.k.voids')} value={rupees(d.totals.voids)} />
        <KpiTile label={t('owner.k.discounts')} value={rupees(d.totals.discounts)} />
        <KpiTile label={t('owner.k.cashShort')} value={rupees(d.totals.cashShort)} />
        <KpiTile label={t('owner.k.wastage')} value={rupees(d.totals.wastage)} />
      </div>
      <Section title={t('owner.k.title')} hint={t('owner.k.hint')}>
        <DataList columns={cols} rows={d.people} rowKey={(r) => r.userId} empty={t('owner.k.none')} />
      </Section>
      {d.voidReasons.length > 0 && (
        <Section title={t('owner.k.reasons')}>
          <ul className="divide-y rounded-card border bg-card text-sm">
            {d.voidReasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate">{r.reason}</span>
                <span className="tabular shrink-0 font-medium">{rupees(r.value)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Promises kept and broken, by person. */
export function PromisesTab({ span }: { span: Span }) {
  const { t } = useTranslation();
  const q = usePromises(span);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const cols: Column<Promises['people'][number]>[] = [
    {
      key: 'name',
      label: t('owner.col.person'),
      head: true,
      cell: (r) => (
        <span>
          {r.name}
          <span className="block text-xs font-normal text-muted-foreground">{r.branch}</span>
        </span>
      ),
    },
    {
      key: 'kept',
      label: t('owner.p.kept'),
      num: true,
      cell: (r) => <Flagged bad={(r.keptPct ?? 100) < 70}>{percent(r.keptPct)}</Flagged>,
    },
    { key: 'due', label: t('owner.p.due'), num: true, cell: (r) => `${r.kept} / ${r.due}` },
    {
      key: 'moved',
      label: t('owner.p.moved'),
      num: true,
      cell: (r) => (r.moved ? `${r.moved} · ${t('owner.p.days', { n: r.avgSlipDays })}` : '—'),
    },
    { key: 'declined', label: t('owner.p.declined'), num: true, cell: (r) => r.declined || '—' },
    {
      key: 'team',
      label: t('owner.p.team'),
      num: true,
      cell: (r) => (r.team.people ? `${percent(r.team.keptPct)} · ${r.team.people}` : '—'),
    },
  ];
  return (
    <Section title={t('owner.p.title', { pct: percent(q.data.keptPct) })} hint={t('owner.p.hint')}>
      <DataList columns={cols} rows={q.data.people} rowKey={(r) => r.userId} empty={t('owner.p.none')} />
    </Section>
  );
}

/** Late steps in rupees: each process has a value per day. */
export function DelayTab({ span }: { span: Span }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useDelay(span);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (x: { flowId: string; rupeesPerDay: number }) =>
      api('/api/owner/delay', { method: 'PUT', body: x }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['owner', 'delay'] }),
  });
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d = q.data;
  const procs: Column<Delay['processes'][number]>[] = [
    { key: 'name', label: t('owner.col.process'), head: true, cell: (r) => r.name },
    {
      key: 'value',
      label: t('owner.d.perDay'),
      num: true,
      cell: (r) => (
        <Input
          inputMode="numeric"
          aria-label={t('owner.d.perDayFor', { name: r.name })}
          className="ml-auto h-9 w-28 text-right sm:h-9"
          value={draft[r.flowId] ?? String(r.rupeesPerDay || '')}
          placeholder="0"
          onChange={(e) => setDraft({ ...draft, [r.flowId]: e.target.value })}
          onBlur={() =>
            draft[r.flowId] !== undefined &&
            save.mutate({ flowId: r.flowId, rupeesPerDay: Number(draft[r.flowId]) || 0 })
          }
        />
      ),
    },
    { key: 'late', label: t('owner.d.lateSteps'), num: true, cell: (r) => `${r.lateSteps} / ${r.steps}` },
    { key: 'days', label: t('owner.d.lateDays'), num: true, cell: (r) => r.lateDays },
    {
      key: 'cost',
      label: t('owner.d.cost'),
      num: true,
      cell: (r) => (r.cost ? <strong>{rupees(r.cost)}</strong> : '—'),
    },
  ];
  const people: Column<Delay['people'][number]>[] = [
    { key: 'name', label: t('owner.col.person'), head: true, cell: (r) => r.name },
    { key: 'late', label: t('owner.d.lateSteps'), num: true, cell: (r) => r.lateSteps },
    { key: 'days', label: t('owner.d.lateDays'), num: true, cell: (r) => r.lateDays },
    { key: 'cost', label: t('owner.d.cost'), num: true, cell: (r) => (r.cost ? rupees(r.cost) : '—') },
  ];
  const steps: Column<Delay['steps'][number]>[] = [
    {
      key: 'step',
      label: t('owner.d.step'),
      head: true,
      cell: (r) => (
        <span>
          {r.step}
          <span className="block text-xs font-normal text-muted-foreground">{r.process}</span>
        </span>
      ),
    },
    { key: 'late', label: t('owner.d.lateSteps'), num: true, cell: (r) => r.lateSteps },
    { key: 'days', label: t('owner.d.lateDays'), num: true, cell: (r) => r.lateDays },
    { key: 'cost', label: t('owner.d.cost'), num: true, cell: (r) => (r.cost ? rupees(r.cost) : '—') },
  ];
  return (
    <div className="space-y-6">
      <Section
        title={t('owner.d.title', { total: rupees(d.total) })}
        hint={d.unpriced ? t('owner.d.unpriced', { count: d.unpriced }) : t('owner.d.hint')}
      >
        <DataList columns={procs} rows={d.processes} rowKey={(r) => r.flowId} empty={t('owner.d.none')} />
      </Section>
      <Section title={t('owner.d.byPerson')}>
        <DataList columns={people} rows={d.people} rowKey={(r) => r.userId} empty={t('owner.d.noLate')} />
      </Section>
      <Section title={t('owner.d.byStep')}>
        <DataList columns={steps} rows={d.steps} rowKey={(r, i) => `${i}`} empty={t('owner.d.noLate')} />
      </Section>
    </div>
  );
}

/** Work only one person does. */
export function BusFactorTab() {
  const { t } = useTranslation();
  const q = useBusFactor();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const d: BusFactor = q.data;
  return (
    <Section title={t('owner.b.title', { count: d.total })} hint={t('owner.b.hint')}>
      {d.people.length ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {d.people.map((p) => (
            <li key={p.userId} className="rounded-card border bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.branch}</div>
                </div>
                <span className="tabular rounded-pill bg-status-warn-bg px-2 py-0.5 text-xs font-semibold text-status-warn-fg">
                  {t('owner.b.only', { count: p.count })}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {p.items.map((it, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {t(`owner.b.kind.${it.kind}`)}
                    </span>
                    <span className="min-w-0">{it.what}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">{t('owner.b.none')}</p>
      )}
    </Section>
  );
}
