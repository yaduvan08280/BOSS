import { useQuery } from '@tanstack/react-query';
import { Landmark } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useBranches } from '@/modules/system/api';
import { money, toMinor, useMoneyMutation, useToday } from './api';

type Sheet = {
  closed: boolean;
  modes: {
    modeId: string;
    name: string;
    kind: string;
    expected: number;
    counted: number | null;
    difference: number | null;
  }[];
};

/** A branch's day close: for each way money is taken, what the day's papers expect against what was counted. */
export function DayClosePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const branches = useBranches();
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(useToday());
  const [counted, setCounted] = useState<Record<string, string>>({});
  const at = branchId || branches.data?.[0]?.id || '';
  const q = useQuery({
    queryKey: ['money', 'day-close', at, date],
    queryFn: () => api<Sheet>(`/api/money/day-close?branchId=${at}&date=${date}`),
    enabled: Boolean(at),
  });
  const close = useMoneyMutation(
    () =>
      api('/api/money/day-close', {
        method: 'POST',
        body: {
          branchId: at,
          date,
          counts: (q.data?.modes ?? [])
            .filter((m) => counted[m.modeId] !== undefined && counted[m.modeId] !== '')
            .map((m) => ({ modeId: m.modeId, counted: toMinor(counted[m.modeId]!) })),
        },
      }),
    t('money.close.done'),
  );
  const canClose = hasPermission(me.user.permissions, 'money.edit');
  return (
    <div>
      <PageHeader title={t('money.close.title')} subtitle={t('money.close.subtitle')} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select
          aria-label={t('hrBranch.branch')}
          value={at}
          onChange={(e) => setBranchId(e.target.value)}
          className="w-56"
        >
          {(branches.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <div className="w-40">
          <DateInput value={date} onChange={setDate} aria-label={t('money.date')} />
        </div>
      </div>
      {!at ? (
        <EmptyState icon={Landmark} title={t('org.branches.emptyTitle')} body={t('org.branches.emptyBody')} />
      ) : q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} error={q.error} />
      ) : q.data.modes.length === 0 ? (
        <EmptyState icon={Landmark} title={t('money.close.noModes')} body={t('money.close.noModesBody')} />
      ) : (
        <div className="max-w-2xl space-y-2">
          {q.data.modes.map((m) => (
            <Card key={m.modeId} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-40">
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('money.close.expected', { amount: money(m.expected) })}
                </div>
              </div>
              {q.data.closed ? (
                <div className="text-right text-sm">
                  <div className="tabular">{m.counted === null ? '—' : money(m.counted)}</div>
                  {m.difference !== null && m.difference !== 0 && (
                    <div className="tabular text-xs text-status-bad-fg">
                      {t(m.difference < 0 ? 'money.close.short' : 'money.close.over', {
                        amount: money(Math.abs(m.difference)),
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <Input
                  aria-label={t('money.close.countedFor', { name: m.name })}
                  placeholder={t('money.close.counted')}
                  inputMode="decimal"
                  className="w-36 tabular"
                  value={counted[m.modeId] ?? ''}
                  onChange={(e) => setCounted({ ...counted, [m.modeId]: e.target.value })}
                />
              )}
            </Card>
          ))}
          {q.data.closed ? (
            <p className="text-sm text-muted-foreground">{t('money.close.isClosed')}</p>
          ) : (
            canClose && (
              <Button variant="primary" disabled={close.isPending} onClick={() => close.mutate(undefined)}>
                {t('money.close.go')}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
