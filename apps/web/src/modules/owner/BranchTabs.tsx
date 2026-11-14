import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useExceptions, useLeague, type Exceptions, type LeagueRow, type RangeKey, type Span } from './api';
import { percent, rupees } from './format';
import { CopyBest } from './ExtraTabs';
import { DataList, Flagged, Section, type Column } from './parts';

const KEYS: RangeKey[] = [
  'voidPct',
  'discountPct',
  'wastagePct',
  'cashDiff',
  'attendancePct',
  'lateWorkPct',
  'checklistMissedPct',
];
const show = (key: RangeKey, v: number) =>
  key === 'cashDiff' ? `₹${Math.round(v).toLocaleString('en-IN')}` : `${v}%`;

function RangesDialog({ data, onClose }: { data: Exceptions; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const base = branchId ? data.branches.find((b) => b.branchId === branchId)!.ranges : data.defaults;
  const [draft, setDraft] = useState<Partial<Record<RangeKey, string>>>({});
  const save = useMutation({
    mutationFn: () =>
      api('/api/owner/ranges', {
        method: 'PUT',
        body: {
          branchId: branchId || null,
          ranges: Object.fromEntries(KEYS.map((k) => [k, Number(draft[k] ?? base[k])])),
        },
      }),
    onSuccess: () => {
      toast.success(t('owner.x.saved'));
      void qc.invalidateQueries({ queryKey: ['owner'] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('owner.x.rangesTitle')}
      description={t('owner.x.rangesHint')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-2">
        <Field label={t('owner.x.for')} className="sm:col-span-2">
          <Select
            value={branchId}
            onChange={(e) => (setBranchId(e.target.value), setDraft({}))}
            aria-label={t('owner.x.for')}
          >
            <option value="">{t('owner.x.everyBranch')}</option>
            {data.branches.map((b) => (
              <option key={b.branchId} value={b.branchId}>
                {b.branch}
              </option>
            ))}
          </Select>
        </Field>
        {KEYS.map((k) => (
          <Field key={k} label={t(`owner.range.${k}`)}>
            <Input
              inputMode="decimal"
              value={draft[k] ?? String(base[k])}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

/** Exceptions only: what broke its normal range, worst first, with the manager's name. */
export function ExceptionsTab({ span }: { span: Span }) {
  const { t } = useTranslation();
  const q = useExceptions(span);
  const [editing, setEditing] = useState(false);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const cols: Column<Exceptions['exceptions'][number]>[] = [
    { key: 'branch', label: t('owner.col.branch'), head: true, cell: (r) => r.branch },
    { key: 'what', label: t('owner.col.what'), cell: (r) => t(`owner.range.${r.key}`) },
    {
      key: 'value',
      label: t('owner.col.now'),
      num: true,
      cell: (r) => <Flagged bad>{show(r.key, r.value)}</Flagged>,
    },
    {
      key: 'limit',
      label: t('owner.col.normal'),
      num: true,
      cell: (r) => `${r.key === 'attendancePct' ? '≥' : '≤'} ${show(r.key, r.limit)}`,
    },
    { key: 'who', label: t('owner.col.manager'), cell: (r) => r.manager ?? t('owner.noManager') },
  ];
  return (
    <Section
      title={t('owner.x.title', { count: q.data.exceptions.length })}
      hint={t('owner.x.hint')}
      action={
        <Button size="sm" onClick={() => setEditing(true)}>
          {t('owner.x.setRanges')}
        </Button>
      }
    >
      <DataList
        columns={cols}
        rows={q.data.exceptions}
        rowKey={(r) => `${r.branchId}-${r.key}`}
        empty={t('owner.x.none')}
      />
      {editing && <RangesDialog data={q.data} onClose={() => setEditing(false)} />}
    </Section>
  );
}

/** Every branch on the same numbers, best first. */
export function LeagueTab({ span }: { span: Span }) {
  const { t } = useTranslation();
  const q = useLeague(span);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const cols: Column<LeagueRow>[] = [
    {
      key: 'branch',
      label: t('owner.col.branch'),
      head: true,
      cell: (r) => (
        <span>
          {r.branch}
          <span className="block text-xs font-normal text-muted-foreground">
            {r.manager ?? t('owner.noManager')}
          </span>
        </span>
      ),
    },
    { key: 'score', label: t('owner.col.score'), num: true, cell: (r) => r.score ?? '—' },
    { key: 'sales', label: t('owner.col.sales'), num: true, cell: (r) => rupees(r.sales) },
    { key: 'att', label: t('owner.range.attendancePct'), num: true, cell: (r) => percent(r.attendancePct) },
    { key: 'late', label: t('owner.range.lateWorkPct'), num: true, cell: (r) => percent(r.lateWorkPct) },
    {
      key: 'missed',
      label: t('owner.range.checklistMissedPct'),
      num: true,
      cell: (r) => percent(r.checklistMissedPct),
    },
    { key: 'void', label: t('owner.range.voidPct'), num: true, cell: (r) => percent(r.voidPct) },
    { key: 'disc', label: t('owner.range.discountPct'), num: true, cell: (r) => percent(r.discountPct) },
    { key: 'waste', label: t('owner.range.wastagePct'), num: true, cell: (r) => percent(r.wastagePct) },
  ];
  return (
    <Section title={t('owner.l.title')} hint={t('owner.l.hint')}>
      <DataList columns={cols} rows={q.data.branches} rowKey={(r) => r.branchId} empty={t('owner.l.none')} />
      <CopyBest branches={q.data.branches} />
    </Section>
  );
}
