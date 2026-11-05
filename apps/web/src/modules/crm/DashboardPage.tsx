import { BadgeIndianRupee, Funnel, PhoneCall, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatLocalDate, SEATS, type Me } from '@mono/shared';
import { firstName } from '@/lib/utils';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { useUsers } from '@/modules/system/api';
import { Bars, Ring, Spark } from './charts';
import { inr, useDashboard } from './api';

/** Sales CRM → Dashboard (§11.2): this month against the plan, the KPI tiles, revenue against target, the year. */
export function DashboardPage({ me }: { me: Me }) {
  const { t, i18n } = useTranslation();
  const [viewAs, setViewAs] = useState('');
  const users = useUsers();
  const view = viewAs.startsWith('seat:')
    ? { seat: viewAs.slice(5) }
    : viewAs.startsWith('user:')
      ? { userId: viewAs.slice(5) }
      : {};
  const q = useDashboard(view);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hourCycle: 'h23',
      timeZone: me.company.timezone,
    }).format(new Date()),
  );
  const greet = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const mon = (m: string) =>
    new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${m}-01T00:00:00Z`));
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-ink p-5 text-ink-foreground">
        <div>
          <div className="text-sm opacity-80">
            <span className="mr-2 inline-flex items-center gap-1 rounded-pill bg-status-bad px-2 py-0.5 text-[11px] font-semibold text-white">
              LIVE
            </span>
            {formatLocalDate(d.today)}
          </div>
          <h1 className="mt-1 text-2xl font-semibold">
            {t(`crm.d.greet.${greet}`, { name: firstName(me.user.name) })}
          </h1>
          <p className="mt-2 text-sm opacity-90">
            {t('crm.d.monthLine', {
              target: inr(d.month.target, true),
              achieved: inr(d.month.achieved, true),
              pace: d.month.pacePct ?? '—',
              gap: inr(d.month.gap, true),
              days: d.month.daysLeft,
            })}
          </p>
          {!d.planned && <p className="mt-1 text-xs opacity-80">{t('crm.d.noPlan')}</p>}
        </div>
        {!d.viewing.own && (
          <Select
            value={viewAs}
            aria-label={t('crm.d.viewAs')}
            onChange={(e) => setViewAs(e.target.value)}
            className="w-56 text-foreground"
          >
            <option value="">{t('crm.d.everyone')}</option>
            {SEATS.map((s) => (
              <option key={s} value={`seat:${s}`}>
                {t('crm.d.viewSeat', { seat: t(`crm.seat.${s}`) })}
              </option>
            ))}
            {(users.data ?? [])
              .filter((u) => u.status === 'ACTIVE')
              .map((u) => (
                <option key={u.id} value={`user:${u.id}`}>
                  {t('crm.d.viewSeat', { seat: u.name })}
                </option>
              ))}
          </Select>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/crm/calls">
            <PhoneCall /> {t('crm.d.startCalls')}
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/crm/collections">
            <BadgeIndianRupee /> {t('crm.d.collect')}
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/crm/nbd">
            <Funnel /> {t('nav.nbd')}
          </Link>
        </Button>
        <Button asChild variant="ghost">
          <Link to="/crm/setup">
            <Settings2 /> {t('nav.crmPlan')}
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <div className="space-y-1">
          <KpiTile
            label={t('crm.d.revenue')}
            value={inr(d.tiles.revenue.value, true)}
            hero
            note={
              d.tiles.revenue.deltaPct !== null
                ? t('crm.d.delta', { pct: d.tiles.revenue.deltaPct })
                : undefined
            }
          />
          <Spark values={d.tiles.revenue.spark.map(Number)} />
        </div>
        <div className="space-y-1">
          <KpiTile
            label={t('crm.d.gp')}
            value={inr(d.tiles.gp.value, true)}
            note={
              d.tiles.gp.marginPct !== null ? t('crm.s.marginIs', { pct: d.tiles.gp.marginPct }) : undefined
            }
          />
          <Spark values={d.tiles.gp.spark.map(Number)} />
        </div>
        <KpiTile label={t('crm.d.orders')} value={d.tiles.orders} />
        <KpiTile
          label={t('crm.d.collectionDue')}
          value={inr(d.tiles.collectionDue, true)}
          tone={Number(d.tiles.collectionDue) > 0 ? 'bad' : undefined}
        />
        <KpiTile
          label={t('crm.d.calls')}
          value={`${d.tiles.calls.done} / ${d.tiles.calls.overdue}`}
          note={t('crm.d.callsNote')}
        />
        <KpiTile
          label={t('crm.d.leads')}
          value={d.tiles.leads.open}
          note={t('crm.d.leadsNote', {
            count: d.tiles.leads.thisWeek,
            value: inr(d.tiles.leads.value, true),
          })}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <Card>
          <CardHeader>
            <CardTitle>{t('crm.d.vsTarget')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Bars
              label={t('crm.d.vsTarget')}
              data={d.byMonth.map((m) => ({
                label: m.month,
                value: Number(m.achieved),
                target: Number(m.target),
                extra: Number(m.gp),
                muted: !m.past && m.month !== d.today.slice(0, 7),
              }))}
            />
            <div className="mt-1 grid grid-cols-12 text-center text-[10px] text-muted-foreground">
              {d.byMonth.map((m) => (
                <span key={m.month}>{mon(m.month)}</span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-primary" /> {t('crm.d.achieved')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-0.5 w-3 bg-foreground" /> {t('crm.d.target')}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-status-ok" /> {t('crm.s.gp')}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="flex flex-col items-center justify-center gap-2 p-5">
          <Ring pct={d.year.donePct} label={t('crm.d.yearDone')} sub={t('crm.d.yearDone')} />
          <StatusChip
            tone={d.year.achievedPct !== null && d.year.achievedPct >= d.year.donePct ? 'ok' : 'warn'}
          >
            {t('crm.d.yearAchieved', {
              pct: d.year.achievedPct ?? 0,
              value: inr(d.year.achieved, true),
              target: inr(d.year.target, true),
            })}
          </StatusChip>
        </Card>
      </div>
    </div>
  );
}
