import { Wine } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { DateRange, DayHeading, type Span } from '@/components/date-range';
import { api } from '@/lib/api';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { dmy, send, useBanquetMutation, useBranchRules, useHospBranch, type Excise } from './api';

const q = (x: { bottles: number; ml: number }) => `${x.bottles} + ${x.ml} ml`;

/** The bar's excise register (phase 18): each liquor brand's day in bottles and ml, the licence, and dry days. */
export function BarPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const b = useHospBranch();
  const rules = useBranchRules(b.branchId);
  const [all, setAll] = useState(false);
  const [picked, setSpan] = useState<Span | null>(null);
  const today = rules.data?.today ?? '';
  const span = picked ?? { from: today, to: today };
  const on = span.from;
  // One register per branch: the branch chosen, or every branch with an outlet.
  const branches = all ? b.list : b.list.filter((x) => x.id === b.branchId);
  const regs = useQueries({
    queries: branches.map((x) => ({
      queryKey: ['banquet', 'excise', x.id, span.from, span.to],
      queryFn: () => api<Excise>(`/api/bar/excise?branchId=${x.id}&from=${span.from}&to=${span.to}`),
      enabled: Boolean(today),
    })),
  });
  const rows = regs.flatMap((r, i) =>
    (r.data?.rows ?? []).map((row) => ({ ...row, branch: branches[i]!.name })),
  );
  const days = [...new Set(rows.map((r) => r.day))].sort().reverse();
  const failed = regs.find((r) => r.isError);
  const bar = rules.data?.rules.bar;
  const [f, setF] = useState({ licenceNo: '', category: '', dryDate: '', dryReason: '' });
  const canSetUp = hasPermission(me.user.permissions, 'hosp.admin');
  const save = useBanquetMutation(
    (body: object) => send(`/api/hosp/branch-rules?branchId=${b.branchId}`, { bar: body }, 'PUT'),
    t('bar.saved'),
  );
  if (b.loading) return <PageSkeleton />;
  if (!b.list.length)
    return <EmptyState icon={Wine} title={t('pos.noOutlet')} body={t('pos.noOutletBody')} />;
  return (
    <div>
      <PageHeader
        title={t('bar.title')}
        subtitle={t('bar.subtitle')}
        actions={
          on &&
          !all && (
            <a
              className="inline-flex h-9 items-center rounded-control border bg-card px-3 text-sm font-medium"
              href={`/api/bar/excise.csv?branchId=${b.branchId}&from=${span.from}&to=${span.to}`}
            >
              {t('bar.download')}
            </a>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <Select
            aria-label={t('bq.branch')}
            value={all ? '' : b.branchId}
            onChange={(e) => {
              setAll(!e.target.value);
              if (e.target.value) b.setBranchId(e.target.value);
            }}
          >
            {b.list.length > 1 && <option value="">{t('bar.allBranches')}</option>}
            {b.list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        {today && <DateRange value={span} onChange={setSpan} today={today} maxDays={31} />}
      </div>
      {bar && !all && (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="bar-licence">
          {t('bar.licence', { no: bar.licenceNo || '—', categories: bar.liquorCategories.join(', ') || '—' })}
        </p>
      )}
      {failed ? (
        <ErrorState onRetry={() => regs.forEach((r) => void r.refetch())} error={failed.error} />
      ) : regs.some((r) => r.isPending) ? (
        <PageSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState icon={Wine} title={t('bar.none')} body={t('bar.noneBody')} />
      ) : (
        <div className="space-y-4">
          {days.map((day) => (
            <section key={day} className="space-y-2">
              {(span.from !== span.to || all) && <DayHeading day={day} today={today} />}
              <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {rows
                  .filter((r) => r.day === day)
                  .map((r) => (
                    <li key={`${r.branch}-${r.location}-${r.itemId}`}>
                      <Card className="space-y-1 p-3 text-sm" data-testid={`bar-${r.brand}`}>
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold">{r.brand}</span>
                          <span className="text-right text-xs text-muted-foreground">
                            {r.sizeMl} ml · {all ? `${r.branch} · ` : ''}
                            {r.location}
                          </span>
                        </div>
                        {(['opening', 'received', 'sold', 'breakage', 'closing'] as const).map((k) => (
                          <div key={k} className="flex justify-between">
                            <span className="text-muted-foreground">{t(`bar.col.${k}`)}</span>
                            <span className="tabular">{q(r[k])}</span>
                          </div>
                        ))}
                      </Card>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {all && <p className="mt-6 text-sm text-muted-foreground">{t('bar.pickBranch')}</p>}
      {!all && (
        <section className="mt-6 space-y-2">
          <h2 className="text-sm font-semibold">{t('bar.dryDays')}</h2>
          {(bar?.dryDays ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">{t('bar.noDry')}</p>
          )}
          <ul className="text-sm">
            {(bar?.dryDays ?? []).map((d) => (
              <li key={d.date}>
                {dmy(d.date)} · {d.reason}
              </li>
            ))}
          </ul>
          {canSetUp && bar && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label={t('bar.dryDate')}>
                <DateInput
                  value={f.dryDate}
                  onChange={(v) => setF({ ...f, dryDate: v })}
                  aria-label={t('bar.dryDate')}
                />
              </Field>
              <Field label={t('bar.dryReason')} className="sm:col-span-2">
                <Input value={f.dryReason} onChange={(e) => setF({ ...f, dryReason: e.target.value })} />
              </Field>
              <Button
                size="sm"
                className="self-end"
                disabled={!f.dryDate || !f.dryReason.trim() || save.isPending}
                onClick={() =>
                  save.mutate(
                    {
                      dryDays: [
                        ...bar.dryDays.filter((d) => d.date !== f.dryDate),
                        { date: f.dryDate, reason: f.dryReason },
                      ],
                    },
                    { onSuccess: () => setF({ ...f, dryDate: '', dryReason: '' }) },
                  )
                }
              >
                {t('bar.addDry')}
              </Button>
              <Field label={t('bar.licenceNo')}>
                <Input
                  value={f.licenceNo}
                  placeholder={bar.licenceNo ?? ''}
                  onChange={(e) => setF({ ...f, licenceNo: e.target.value })}
                />
              </Field>
              <Field label={t('bar.category')} className="sm:col-span-2" hint={t('bar.categoryHint')}>
                <Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
              </Field>
              <Button
                size="sm"
                className="self-end"
                disabled={(!f.licenceNo.trim() && !f.category.trim()) || save.isPending}
                onClick={() =>
                  save.mutate(
                    {
                      ...(f.licenceNo.trim() ? { licenceNo: f.licenceNo.trim() } : {}),
                      ...(f.category.trim()
                        ? { liquorCategories: [...new Set([...bar.liquorCategories, f.category.trim()])] }
                        : {}),
                    },
                    { onSuccess: () => setF({ ...f, licenceNo: '', category: '' }) },
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
