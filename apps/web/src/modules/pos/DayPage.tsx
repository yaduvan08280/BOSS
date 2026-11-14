import { Lock } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cashTotal, formatLocalDate } from '@mono/shared';
import { ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useOutlets } from '@/modules/hosp/api';
import { useOutletChoice } from '@/modules/hosp/outletChoice';
import { rupees } from '@/modules/stock/api';
import { post, useChecks, useDay, usePosMutation, type Check } from './api';

/** Bills and day close (phase 15): today's bills, the Z report, the cash counted by note, closing the day. */
export function DayPage() {
  const { t } = useTranslation();
  const outlets = useOutlets();
  const [current, setOutletId] = useOutletChoice(outlets.data);

  const day = useDay(current);
  const checks = useChecks(current);
  const [cash, setCash] = useState<Record<string, string>>({});
  const [cancel, setCancel] = useState<Check | null>(null);
  const counts = Object.fromEntries(
    Object.entries(cash)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => [k, Number(v)]),
  );
  const close = usePosMutation(
    () => post<{ difference: number }>(`/api/pos/outlets/${current}/day/close`, { cash: counts }),
    (r) => t('pos.day.closedToast', { diff: rupees(r.difference) }),
  );
  const reprint = usePosMutation((id: string) => post(`/api/pos/checks/${id}/reprint`), t('pos.reprinted'));
  if (outlets.isPending) return <PageSkeleton />;
  if (outlets.isError) return <ErrorState onRetry={() => void outlets.refetch()} error={outlets.error} />;
  const z = day.data;
  return (
    <div>
      <PageHeader title={t('pos.day.title')} subtitle={t('pos.day.subtitle')} />
      <div className="mb-4 w-full sm:w-64">
        <Select
          aria-label={t('hosp.outlet.one')}
          value={current}
          onChange={(e) => setOutletId(e.target.value)}
        >
          {(outlets.data ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </div>
      {day.isPending ? (
        <PageSkeleton />
      ) : day.isError || !z ? (
        <ErrorState onRetry={() => void day.refetch()} error={day.error} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{formatLocalDate(z.businessDay)}</span>
            {z.closed ? (
              <StatusChip tone="ok">{t('pos.day.isClosed')}</StatusChip>
            ) : (
              <StatusChip tone="info">{t('pos.day.isOpen')}</StatusChip>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile
              hero
              label={t('pos.day.sales')}
              value={rupees(z.sales)}
              note={t('pos.day.billsCovers', { bills: z.bills, covers: z.covers })}
            />
            <KpiTile label={t('pos.day.tax')} value={rupees(z.tax)} />
            <KpiTile label={t('pos.day.service')} value={rupees(z.serviceCharge)} />
            <KpiTile
              label={t('pos.day.discounts')}
              value={rupees(z.discounts)}
              note={t('pos.day.voids', { count: z.voids.count, value: rupees(z.voids.value) })}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t('pos.day.byMode')}</h2>
              {z.byMode.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('pos.day.noMoney')}</p>
              )}
              <ul className="space-y-2">
                {z.byMode.map((m) => (
                  <li key={m.modeId}>
                    <Card className="flex items-center justify-between p-3 text-sm">
                      <span className="font-medium">{m.mode}</span>
                      <span className="tabular">
                        {m.amount === null ? t('pos.day.hidden') : rupees(m.amount)}
                      </span>
                    </Card>
                  </li>
                ))}
              </ul>
              {z.tips.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t('pos.day.tips', {
                    tips: z.tips.map((x) => `${x.steward} ${rupees(x.amount)}`).join(' · '),
                  })}
                </p>
              )}
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t('pos.day.count')}</h2>
              {z.closed ? (
                <p className="text-sm">
                  {t('pos.day.wasCounted', {
                    counted: rupees(z.closed.counted),
                    diff: rupees(z.closed.report.difference),
                  })}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    {z.denominations.map((n) => (
                      <Field key={n} label={`₹${n}`}>
                        <Input
                          aria-label={t('pos.day.notesOf', { note: n })}
                          inputMode="numeric"
                          value={cash[n] ?? ''}
                          onChange={(e) => setCash({ ...cash, [n]: e.target.value })}
                        />
                      </Field>
                    ))}
                  </div>
                  <p className="tabular text-sm">
                    {t('pos.day.counted', { amount: rupees(cashTotal(counts)) })}
                  </p>
                  {z.open > 0 && (
                    <p className="text-sm text-status-warn-fg">{t('pos.day.stillOpen', { count: z.open })}</p>
                  )}
                  <Button
                    variant="primary"
                    disabled={!z.canClose || z.open > 0 || close.isPending}
                    onClick={() => close.mutate(undefined)}
                  >
                    <Lock /> {t('pos.day.close')}
                  </Button>
                </>
              )}
            </section>
          </div>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('pos.day.bills')}</h2>
            <ul className="space-y-2">
              {(checks.data ?? []).map((c) => (
                <li key={c.id}>
                  <Card className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
                    <span className="min-w-0 flex-1 basis-40 font-mono">{c.number}</span>
                    <StatusChip tone={c.status === 'PAID' ? 'ok' : c.status === 'OPEN' ? 'warn' : 'bad'}>
                      {t(`pos.check.${c.status}`)}
                    </StatusChip>
                    <span className="tabular font-semibold">{rupees(c.total)}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={reprint.isPending}
                      onClick={() => reprint.mutate(c.id)}
                    >
                      {t('pos.reprint')}
                    </Button>
                    {c.status !== 'CANCELLED' && !z.closed && (
                      <Button size="sm" variant="ghost" onClick={() => setCancel(c)}>
                        {t('pos.cancelBill')}
                      </Button>
                    )}
                  </Card>
                </li>
              ))}
            </ul>
            {checks.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('pos.day.noBills')}</p>
            )}
          </section>
        </div>
      )}
      {cancel && <CancelDialog check={cancel} onClose={() => setCancel(null)} />}
    </div>
  );
}

function CancelDialog({ check, onClose }: { check: Check; onClose: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const go = usePosMutation(
    () => post<{ pending: boolean }>(`/api/pos/checks/${check.id}/cancel`, { reason }),
    (r) => (r.pending ? t('pos.cancelAsked') : t('pos.billCancelled')),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('pos.cancelBillNo', { number: check.number })}
      description={t('pos.cancelHint')}
      footer={
        <Button
          variant="destructive"
          disabled={reason.trim().length < 3 || go.isPending}
          onClick={() => go.mutate(undefined, { onSuccess: onClose })}
        >
          {t('pos.cancelBill')}
        </Button>
      }
    >
      <Field label={t('pos.cancelWhy')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </Dialog>
  );
}
