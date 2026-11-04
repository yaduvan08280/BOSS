import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { personLabel } from '@/lib/people';
import { useDesignations, useUsers } from '@/modules/system/api';
import { useHrMutation, useLeaveTypes, type LeaveType } from './api';
import { payApi, useQuotas, type Quota } from './payApi';

type Row = { scope: Quota['scope']; refId: string; days: string };

/** Leave a year by designation or person (e.g. drivers 10 CL, one person 12), else the leave type's number. */
export function LeaveQuotas() {
  const { t } = useTranslation();
  const types = useLeaveTypes();
  const quotas = useQuotas();
  if (types.isPending || quotas.isPending) return <PageSkeleton />;
  if (types.isError || quotas.isError)
    return <ErrorState onRetry={() => void (types.refetch(), quotas.refetch())} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('hr.p.q2.hint')}</p>
      {types.data
        .filter((x) => x.active && x.code !== 'CO')
        .map((type) => (
          <TypeQuotas
            key={type.id}
            type={type}
            saved={quotas.data.filter((q) => q.leaveTypeId === type.id)}
          />
        ))}
    </div>
  );
}

function TypeQuotas({ type, saved }: { type: LeaveType; saved: Quota[] }) {
  const { t } = useTranslation();
  const titles = useDesignations();
  const users = useUsers();
  const [rows, setRows] = useState<Row[]>(() =>
    saved.map((q) => ({ scope: q.scope, refId: q.refId, days: String(q.yearlyQuota) })),
  );
  const put = (i: number, r: Row) => setRows(rows.map((x, j) => (j === i ? r : x)));
  const valid = rows.every((r) => r.refId && /^\d+(\.5|\.0)?$/.test(r.days.trim()) && Number(r.days) <= 365);
  const save = useHrMutation(
    () =>
      payApi.saveQuotas(
        type.id,
        rows.map((r) => ({ scope: r.scope, refId: r.refId, yearlyQuota: Number(r.days) })),
      ),
    () => t('hr.p.q2.saved', { type: type.name }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {type.name} <span className="font-mono text-sm text-muted-foreground">{type.code}</span>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('hr.p.q2.default', { count: Number(type.yearlyQuota) })}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[150px_1fr_110px_auto]">
            <Select
              value={r.scope}
              aria-label={t('hr.w.scope')}
              onChange={(e) => put(i, { ...r, scope: e.target.value as Row['scope'], refId: '' })}
              className="col-span-2 sm:col-span-1"
            >
              <option value="designation">{t('hr.p.r.designation')}</option>
              <option value="person">{t('hr.w.person')}</option>
            </Select>
            <Select
              value={r.refId}
              aria-label={t('hr.w.who')}
              onChange={(e) => put(i, { ...r, refId: e.target.value })}
              className="col-span-2 sm:col-span-1"
            >
              <option value="">{t('org.choose')}</option>
              {r.scope === 'designation'
                ? (titles.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                : (users.data ?? [])
                    .filter((u) => u.status === 'ACTIVE')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {personLabel(u)}
                      </option>
                    ))}
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <Input
                inputMode="decimal"
                aria-label={t('hr.p.q2.days')}
                value={r.days}
                onChange={(e) => put(i, { ...r, days: e.target.value })}
                className="w-20 tabular-nums"
              />
              {t('hr.w.days')}
            </label>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('common.remove')}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setRows([...rows, { scope: 'designation', refId: '', days: String(Number(type.yearlyQuota)) }])
            }
          >
            <Plus /> {t('hr.p.q2.add')}
          </Button>
          <Button size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(undefined)}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
