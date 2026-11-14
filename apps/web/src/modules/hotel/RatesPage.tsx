import { BedDouble, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MEAL_PLANS, hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import type { RoomType } from '@/modules/hosp/api';
import { rupees } from '@/modules/stock/api';
import { send, useHotelMutation, usePlans, useProperty, type Plan } from './api';
import { PropertyBar } from './PropertyBar';

/** Rate plans (phase 17): what a night costs for each room type on each plan. */
export function RatesPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const p = useProperty();
  const plans = usePlans(p.branchId);
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const canSetUp = hasPermission(me.user.permissions, 'hosp.admin');
  if (p.loading) return <PageSkeleton />;
  if (!p.list.length)
    return <EmptyState icon={BedDouble} title={t('hotel.noRooms')} body={t('hotel.noRoomsBody')} />;
  return (
    <div>
      <PageHeader
        title={t('hotel.rates.title')}
        subtitle={t('hotel.rates.subtitle')}
        actions={
          canSetUp && (
            <Button size="sm" variant="primary" onClick={() => setEdit('new')}>
              <Plus /> {t('hotel.rates.add')}
            </Button>
          )
        }
      />
      <PropertyBar list={p.list} branchId={p.branchId} onChange={p.setBranchId} />
      {plans.isPending ? (
        <PageSkeleton />
      ) : plans.isError ? (
        <ErrorState onRetry={() => void plans.refetch()} error={plans.error} />
      ) : plans.data.length === 0 ? (
        <EmptyState icon={BedDouble} title={t('hotel.rates.none')} body={t('hotel.rates.noneBody')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((plan) => (
            <li key={plan.id}>
              <Card className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">
                    <span className="font-mono">{plan.code}</span> · {plan.name}
                  </span>
                  <StatusChip tone="info">{t(`hotel.meal.${plan.meal}`)}</StatusChip>
                </div>
                <ul className="space-y-1 text-sm">
                  {plan.rates.map((r) => (
                    <li key={r.roomTypeId} className="flex justify-between">
                      <span>{p.types.find((x) => x.id === r.roomTypeId)?.name ?? '?'}</span>
                      <span className="tabular">{rupees(r.base)}</span>
                    </li>
                  ))}
                </ul>
                {canSetUp && (
                  <Button size="sm" variant="ghost" onClick={() => setEdit(plan)}>
                    {t('res.edit')}
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {edit && (
        <PlanDialog
          branchId={p.branchId}
          types={p.types}
          plan={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

/** A plan's code, name, meal plan and the base rate of each room type (seasons and the rest keep what they had). */
function PlanDialog({
  branchId,
  types,
  plan,
  onClose,
}: {
  branchId: string;
  types: RoomType[];
  plan: Plan | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [meal, setMeal] = useState(plan?.meal ?? 'EP');
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries((plan?.rates ?? []).map((r) => [r.roomTypeId, String(r.base / 100)])),
  );
  const save = useHotelMutation(() => {
    const body = {
      ...(plan ?? {}),
      branchId,
      code: code.toUpperCase(),
      name,
      meal,
      rates: types
        .filter((x) => Number(rates[x.id]) > 0)
        .map((x) => ({
          ...(plan?.rates.find((r) => r.roomTypeId === x.id) ?? {}),
          roomTypeId: x.id,
          base: Math.round(Number(rates[x.id]) * 100),
        })),
    };
    return plan ? send(`/api/hotel/plans/${plan.id}`, body, 'PUT') : send('/api/hotel/plans', body);
  }, t('hotel.rates.saved'));
  const any = types.some((x) => Number(rates[x.id]) > 0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={plan ? t('hotel.rates.editTitle', { code: plan.code }) : t('hotel.rates.add')}
      footer={
        <Button
          variant="primary"
          disabled={!code.trim() || !name.trim() || !any || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('hotel.rates.code')}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('res.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('hotel.rates.meal')}>
            <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
              {MEAL_PLANS.map((m) => (
                <option key={m} value={m}>
                  {t(`hotel.meal.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {types.map((x) => (
          <Field key={x.id} label={t('hotel.rates.nightOf', { type: x.name })}>
            <Input
              inputMode="decimal"
              value={rates[x.id] ?? ''}
              onChange={(e) => setRates((r) => ({ ...r, [x.id]: e.target.value }))}
            />
          </Field>
        ))}
      </div>
    </Dialog>
  );
}
