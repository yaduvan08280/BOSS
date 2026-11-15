import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DayHeading } from '@/components/date-range';
import { EmptyState, ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import type { Span } from '@/lib/days';
import { useDays } from '@/lib/use-days';
import { rupees } from '@/modules/stock/api';

type Flash = {
  day: string;
  outlets: {
    outletId: string;
    outlet: string;
    sales: number;
    covers: number;
    perCover: number;
    voids: { count: number; value: number };
    discounts: number;
    noCharge: number;
    cashSystem: number;
    cashCounted: number | null;
    cashDiff: number | null;
    closed: boolean;
  }[];
  rooms: { branch: string; occupancyPct: number; adr: number; revPar: number; sold: number; rooms: number }[];
  cost: Record<'food' | 'beverage', { sales: number; cost: number; pct: number | null }>;
  totals: {
    sales: number;
    covers: number;
    perCover: number;
    voids: number;
    discounts: number;
    noCharge: number;
  };
};
const dmy = (d: string) => d.split('-').reverse().join('/');
const row = 'flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0';

/** The flash of each day of a span, the newest first; days with nothing sold and no audit are left out. */
export function FlashDays({ span, today }: { span: Span; today: string }) {
  const { t } = useTranslation();
  const q = useDays<Flash>(['hreports', 'flash'], span, (d) => `/api/hosp/reports/flash?day=${d}`);
  if (q.error) return <ErrorState onRetry={q.refetch} error={q.error} />;
  if (q.isPending) return <PageSkeleton />;
  const days = [...q.days]
    .reverse()
    .flatMap((d) => (d.data && d.data.outlets.length + d.data.rooms.length > 0 ? [d.data] : []));
  if (!days.length)
    return <EmptyState icon={BarChart3} title={t('hrep.nothing')} body={t('hrep.nothingBody')} />;
  return (
    <div className="space-y-6">
      {days.map((f) => (
        <section key={f.day} className="space-y-3">
          {span.from !== span.to && <DayHeading day={f.day} today={today} />}
          <OneDay f={f} />
        </section>
      ))}
    </div>
  );
}

function OneDay({ f }: { f: Flash }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4" data-testid="flash">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile hero label={t('hrep.sales', { day: dmy(f.day) })} value={rupees(f.totals.sales)} />
        <KpiTile
          label={t('hrep.covers')}
          value={String(f.totals.covers)}
          note={t('hrep.perCover', { amount: rupees(f.totals.perCover) })}
        />
        <KpiTile
          label={t('hrep.foodCost')}
          value={f.cost.food.pct == null ? '—' : `${f.cost.food.pct}%`}
          note={t('hrep.drinkCost', {
            pct: f.cost.beverage.pct == null ? '—' : `${f.cost.beverage.pct}%`,
          })}
        />
        <KpiTile
          label={t('hrep.voidsDiscounts')}
          value={rupees(f.totals.voids + f.totals.discounts)}
          note={t('hrep.noCharge', { count: f.totals.noCharge })}
        />
      </div>
      <Card className="p-4">
        {f.outlets.map((o) => (
          <div key={o.outletId} className={row}>
            <div>
              <div className="font-medium">{o.outlet}</div>
              <div className="text-xs text-muted-foreground">
                {t('hrep.outletLine', {
                  covers: o.covers,
                  perCover: rupees(o.perCover),
                  voids: rupees(o.voids.value),
                  discounts: rupees(o.discounts),
                })}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold tabular">{rupees(o.sales)}</div>
              <div className={o.cashDiff ? 'text-xs text-status-bad-fg' : 'text-xs text-muted-foreground'}>
                {o.cashDiff == null
                  ? t('hrep.cashOpen')
                  : o.cashDiff === 0
                    ? t('hrep.cashOk')
                    : t('hrep.cashDiff', { amount: rupees(o.cashDiff) })}
              </div>
            </div>
          </div>
        ))}
        {f.rooms.map((r) => (
          <div key={r.branch} className={row}>
            <div className="font-medium">{r.branch}</div>
            <div className="text-xs text-muted-foreground">
              {t('hrep.roomsLine', {
                sold: r.sold,
                rooms: r.rooms,
                occ: r.occupancyPct,
                adr: rupees(r.adr),
                revPar: rupees(r.revPar),
              })}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
