import { Wine } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { dmy, send, useBanquetMutation, useBranchRules, useExcise, useHospBranch } from './api';

const q = (x: { bottles: number; ml: number }) => `${x.bottles} + ${x.ml} ml`;

/** The bar's excise register (phase 18): each liquor brand's day in bottles and ml, the licence, and dry days. */
export function BarPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const b = useHospBranch();
  const rules = useBranchRules(b.branchId);
  const [day, setDay] = useState('');
  const on = day || rules.data?.today || '';
  const reg = useExcise(b.branchId, on);
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
          on && (
            <a
              className="inline-flex h-9 items-center rounded-control border bg-card px-3 text-sm font-medium"
              href={`/api/bar/excise.csv?branchId=${b.branchId}&from=${on}`}
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
            value={b.branchId}
            onChange={(e) => b.setBranchId(e.target.value)}
          >
            {b.list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <DateInput value={on} onChange={setDay} aria-label={t('res.day')} />
        </div>
      </div>
      {bar && (
        <p className="mb-3 text-sm text-muted-foreground" data-testid="bar-licence">
          {t('bar.licence', { no: bar.licenceNo || '—', categories: bar.liquorCategories.join(', ') || '—' })}
        </p>
      )}
      {reg.isPending ? (
        <PageSkeleton />
      ) : reg.isError ? (
        <ErrorState onRetry={() => void reg.refetch()} error={reg.error} />
      ) : reg.data.rows.length === 0 ? (
        <EmptyState icon={Wine} title={t('bar.none')} body={t('bar.noneBody')} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {reg.data.rows.map((r) => (
            <li key={`${r.location}-${r.itemId}`}>
              <Card className="space-y-1 p-3 text-sm" data-testid={`bar-${r.brand}`}>
                <div className="flex justify-between">
                  <span className="font-semibold">{r.brand}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.sizeMl} ml · {r.location}
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
      )}
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
    </div>
  );
}
