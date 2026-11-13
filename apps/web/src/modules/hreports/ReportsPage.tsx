import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { rupees } from '@/modules/stock/api';
import { Seg } from '@/modules/stock/ui';

type Tab = 'flash' | 'sales' | 'kitchen' | 'audit' | 'team';
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
type Sales = {
  total: number;
  covers: number;
  rows: { key: string; label: string; qty: number; sales: number; share: number }[];
};
type Service = {
  limitMin: number;
  rows: {
    station: string;
    tickets: number;
    avgMin: number | null;
    slowestMin: number | null;
    late: number;
    onTimePct: number | null;
  }[];
};
type Audit = {
  voids: { day: string; order: number; item: string; value: number; reason: string | null; by: string }[];
  discounts: { day: string; bill: string; kind: string; amount: number; reason: string | null; by: string }[];
  totals: { voids: number; discounts: number; noCharge: number };
};
type Team = {
  stewards: { name: string; orders: number; covers: number; sales: number; voids: number }[];
  housekeeping: { name: string; given: number; cleaned: number; passed: number }[];
};
const dmy = (d: string) => d.split('-').reverse().join('/');
const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

/** Hospitality → Reports (phase 20): yesterday's flash, what sold, the kitchen's times, voids and discounts, the team's week. */
export function HospReportsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('flash');
  const [from, setFrom] = useState(yesterday());
  const [to, setTo] = useState(today());
  const [by, setBy] = useState('item');
  const span = `from=${from}&to=${to}`;
  const get = <T,>(key: string, url: string, on: boolean) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ['hreports', key, url], queryFn: () => api<T>(url), enabled: on });
  const flash = get<Flash>('flash', `/api/hosp/reports/flash?day=${from}`, tab === 'flash');
  const sales = get<Sales>('sales', `/api/hosp/reports/sales?${span}&by=${by}`, tab === 'sales');
  const service = get<Service>('service', `/api/hosp/reports/service?${span}`, tab === 'kitchen');
  const audit = get<Audit>('audit', `/api/hosp/reports/audit?${span}`, tab === 'audit');
  const team = get<Team>('team', `/api/hosp/reports/team?day=${from}`, tab === 'team');
  const q = { flash, sales, kitchen: service, audit, team }[tab];
  const oneDay = tab === 'flash' || tab === 'team';
  const row = 'flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-0';
  return (
    <div className="space-y-4">
      <PageHeader title={t('hrep.title')} subtitle={t('hrep.subtitle')} />
      <Seg
        value={tab}
        onChange={setTab}
        options={(['flash', 'sales', 'kitchen', 'audit', 'team'] as const).map((key) => ({
          key,
          label: t(`hrep.tab.${key}`),
        }))}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <DateInput
            value={from}
            onChange={(v) => v && setFrom(v)}
            aria-label={oneDay ? t('hrep.day') : t('hrep.from')}
          />
        </div>
        {!oneDay && (
          <div className="w-40">
            <DateInput value={to} min={from} onChange={(v) => v && setTo(v)} aria-label={t('hrep.to')} />
          </div>
        )}
        {tab === 'sales' && (
          <div className="w-44">
            <Select aria-label={t('hrep.groupBy')} value={by} onChange={(e) => setBy(e.target.value)}>
              {['item', 'category', 'steward', 'hour', 'outlet'].map((k) => (
                <option key={k} value={k}>
                  {t(`hrep.by.${k}`)}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : tab === 'flash' && flash.data ? (
        flash.data.outlets.length + flash.data.rooms.length === 0 ? (
          <EmptyState icon={BarChart3} title={t('hrep.nothing')} body={t('hrep.nothingBody')} />
        ) : (
          <div className="space-y-4" data-testid="flash">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KpiTile
                hero
                label={t('hrep.sales', { day: dmy(flash.data.day) })}
                value={rupees(flash.data.totals.sales)}
              />
              <KpiTile
                label={t('hrep.covers')}
                value={String(flash.data.totals.covers)}
                note={t('hrep.perCover', { amount: rupees(flash.data.totals.perCover) })}
              />
              <KpiTile
                label={t('hrep.foodCost')}
                value={flash.data.cost.food.pct == null ? '—' : `${flash.data.cost.food.pct}%`}
                note={t('hrep.drinkCost', {
                  pct: flash.data.cost.beverage.pct == null ? '—' : `${flash.data.cost.beverage.pct}%`,
                })}
              />
              <KpiTile
                label={t('hrep.voidsDiscounts')}
                value={rupees(flash.data.totals.voids + flash.data.totals.discounts)}
                note={t('hrep.noCharge', { count: flash.data.totals.noCharge })}
              />
            </div>
            <Card className="p-4">
              {flash.data.outlets.map((o) => (
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
                    <div
                      className={o.cashDiff ? 'text-xs text-status-bad-fg' : 'text-xs text-muted-foreground'}
                    >
                      {o.cashDiff == null
                        ? t('hrep.cashOpen')
                        : o.cashDiff === 0
                          ? t('hrep.cashOk')
                          : t('hrep.cashDiff', { amount: rupees(o.cashDiff) })}
                    </div>
                  </div>
                </div>
              ))}
              {flash.data.rooms.map((r) => (
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
        )
      ) : tab === 'sales' && sales.data ? (
        <Card className="p-4" data-testid="sales-report">
          <div className={`${row} font-semibold`}>
            <span>{t('hrep.total')}</span>
            <span className="tabular">{rupees(sales.data.total)}</span>
          </div>
          {sales.data.rows.map((r) => (
            <div key={r.key} className={row}>
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="text-xs text-muted-foreground">
                {r.qty} · {r.share}%
              </span>
              <span className="w-28 text-right tabular">{rupees(r.sales)}</span>
            </div>
          ))}
          {sales.data.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('hrep.nothing')}</p>
          )}
        </Card>
      ) : tab === 'kitchen' && service.data ? (
        <Card className="p-4" data-testid="kitchen-report">
          {service.data.rows.map((r) => (
            <div key={r.station} className={row}>
              <span className="font-medium">{r.station}</span>
              <span className="text-xs text-muted-foreground">
                {t('hrep.kitchenLine', {
                  tickets: r.tickets,
                  avg: r.avgMin ?? '—',
                  slowest: r.slowestMin ?? '—',
                  late: r.late,
                  limit: service.data!.limitMin,
                })}
              </span>
              <span className="tabular">{r.onTimePct == null ? '—' : `${r.onTimePct}%`}</span>
            </div>
          ))}
          {service.data.rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('hrep.nothing')}</p>
          )}
        </Card>
      ) : tab === 'audit' && audit.data ? (
        <Card className="p-4" data-testid="audit-report">
          <div className={`${row} font-semibold`}>
            <span>{t('hrep.voids')}</span>
            <span className="tabular">{rupees(audit.data.totals.voids)}</span>
          </div>
          {audit.data.voids.map((v, i) => (
            <div key={i} className={row}>
              <span className="min-w-0 flex-1">
                {v.item} · #{v.order} · {dmy(v.day)}
                <span className="block text-xs text-muted-foreground">
                  {v.reason} — {v.by}
                </span>
              </span>
              <span className="tabular">{rupees(v.value)}</span>
            </div>
          ))}
          <div className={`${row} mt-3 font-semibold`}>
            <span>{t('hrep.discounts')}</span>
            <span className="tabular">{rupees(audit.data.totals.discounts)}</span>
          </div>
          {audit.data.discounts.map((d, i) => (
            <div key={i} className={row}>
              <span className="min-w-0 flex-1">
                {d.bill} · {dmy(d.day)} · {t(`hrep.kind.${d.kind}`)}
                <span className="block text-xs text-muted-foreground">
                  {d.reason} — {d.by}
                </span>
              </span>
              <span className="tabular">{rupees(d.amount)}</span>
            </div>
          ))}
        </Card>
      ) : tab === 'team' && team.data ? (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="team-report">
          <Card className="p-4">
            <h3 className="mb-2 font-semibold">{t('hrep.stewards')}</h3>
            {team.data.stewards.map((s) => (
              <div key={s.name} className={row}>
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('hrep.stewardLine', { orders: s.orders, covers: s.covers, voids: s.voids })}
                </span>
                <span className="tabular">{rupees(s.sales)}</span>
              </div>
            ))}
            {team.data.stewards.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('hrep.nothing')}</p>
            )}
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 font-semibold">{t('hrep.housekeeping')}</h3>
            {team.data.housekeeping.map((k) => (
              <div key={k.name} className={row}>
                <span className="font-medium">{k.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('hrep.hkLine', { cleaned: k.cleaned, given: k.given, passed: k.passed })}
                </span>
              </div>
            ))}
            {team.data.housekeeping.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('hrep.nothing')}</p>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
