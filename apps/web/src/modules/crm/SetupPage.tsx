import { Check, ChevronLeft, ChevronRight, Circle, Lock, LockOpen, Send, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, SETUP_PAGES, type Me, type PlanStatus, type SetupPage as Page } from '@mono/shared';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/dialog';
import { useParamState } from '@/lib/work';
import { cn } from '@/lib/utils';
import { Ring } from './charts';
import { crmApi, inr, useCrmMutation, usePlan, useProgress, type PlanData, type Progress } from './api';
import { AfterOrderPage } from './setup/AfterOrderPage';
import { BusinessPage, CustomerRulesPage, SeatsPage, SellToPage } from './setup/ConfigPages';
import { CalendarPage, NbdSetupPage, RoundingPage, SeasonsPage } from './setup/NbdAndSettings';
import { MonthsPage, WeeksPage } from './setup/PlanMonthPages';
import { QuartersPage, YearPage } from './setup/PlanYearPages';
import { SplitPage } from './setup/SplitPage';
import { Stat } from './setup/shell';

const ALL = ['overview', ...SETUP_PAGES] as const;
const GROUPS: { key: string; pages: Page[] }[] = [
  { key: 'plan', pages: ['year', 'quarters', 'months', 'weeks'] },
  { key: 'config', pages: ['business', 'sellTo', 'seats', 'split', 'customerRules', 'afterOrder', 'nbd'] },
  { key: 'settings', pages: ['holidays', 'weeklyOff', 'seasons', 'rounding'] },
];
const STATUS_TONE: Record<PlanStatus, 'neutral' | 'warn' | 'ok'> = {
  DRAFT: 'neutral',
  PENDING: 'warn',
  APPROVED: 'ok',
};

/** Sales CRM → Plan & setup (§11): the 15-page journey, the FY, the plan's status and its approval. */
export function SetupPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: page, set } = useParamState('page', ALL, 'overview');
  const [fy, setFy] = useState<number | undefined>(undefined);
  const plan = usePlan(fy);
  const progress = useProgress();
  const [unlock, setUnlock] = useState(false);
  const act = useCrmMutation(
    (a: 'submit' | 'approve' | 'reject' | 'withdraw' | 'unlock') => crmApi.planAction(a, plan.data!.fy),
    (r) => t(`crm.s.status.${r.status}`),
  );
  if (plan.isPending || progress.isPending) return <PageSkeleton />;
  if (plan.isError || progress.isError)
    return <ErrorState onRetry={() => void (plan.refetch(), progress.refetch())} />;
  const p = plan.data;
  const pr = progress.data;
  const admin = hasPermission(me.user.permissions, 'crm.admin');
  const lockedPlanPage = (x: string) =>
    ['year', 'quarters', 'months', 'weeks', 'seasons', 'rounding'].includes(x) && p.status !== 'DRAFT';
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.crmPlan')} subtitle={t('navDesc.crmPlan')} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('crm.s.prevFy')}
            onClick={() => setFy(p.fy - 1)}
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-semibold">
            {t('crm.s.fy', { from: p.fy, to: String(p.fy + 1).slice(2) })}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('crm.s.nextFy')}
            onClick={() => setFy(p.fy + 1)}
          >
            <ChevronRight />
          </Button>
          <StatusChip tone={STATUS_TONE[p.status]}>{t(`crm.s.status.${p.status}`)}</StatusChip>
          <span className="text-sm text-muted-foreground">
            {t('crm.s.pagesDone', { done: pr.done, of: pr.of })}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.status === 'DRAFT' && admin && p.saved && (
            <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
              <Send /> {t('crm.s.sendForApproval')}
            </Button>
          )}
          {p.status === 'PENDING' && p.canApprove && (
            <>
              <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
                <Check /> {t('crm.s.approve')}
              </Button>
              <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('reject')}>
                <Undo2 /> {t('crm.s.sendBack')}
              </Button>
            </>
          )}
          {p.status === 'PENDING' && admin && !p.canApprove && (
            <Button variant="secondary" disabled={act.isPending} onClick={() => act.mutate('withdraw')}>
              <Undo2 /> {t('crm.s.withdraw')}
            </Button>
          )}
          {p.status === 'APPROVED' && admin && (
            <Button variant="secondary" onClick={() => setUnlock(true)}>
              <LockOpen /> {t('crm.s.unlock')}
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <nav
          aria-label={t('crm.s.journey')}
          className="flex gap-1 overflow-x-auto pb-1 lg:block lg:space-y-4 lg:overflow-visible"
        >
          <PageLink
            page="overview"
            active={page === 'overview'}
            done={false}
            onClick={() => set({ page: 'overview' })}
          />
          {GROUPS.map((g) => (
            <div key={g.key} className="flex gap-1 lg:block lg:space-y-1">
              <div className="hidden px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground lg:block">
                {t(`crm.s.group.${g.key}`)}
              </div>
              {g.pages.map((x) => (
                <PageLink
                  key={x}
                  page={x}
                  active={page === x}
                  done={pr.config.done.includes(x)}
                  locked={lockedPlanPage(x)}
                  onClick={() => set({ page: x })}
                />
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0">
          {page === 'overview' && <Overview plan={p} progress={pr} go={(x) => set({ page: x })} />}
          {page === 'year' && <YearPage plan={p} />}
          {page === 'quarters' && <QuartersPage plan={p} />}
          {page === 'months' && <MonthsPage plan={p} />}
          {page === 'weeks' && <WeeksPage plan={p} />}
          {page === 'business' && <BusinessPage progress={pr} canEdit={admin} />}
          {page === 'sellTo' && <SellToPage progress={pr} canEdit={admin} />}
          {page === 'seats' && <SeatsPage progress={pr} canEdit={admin} />}
          {page === 'split' && <SplitPage progress={pr} plan={p} canEdit={admin} />}
          {page === 'customerRules' && <CustomerRulesPage progress={pr} canEdit={admin} />}
          {page === 'afterOrder' && <AfterOrderPage progress={pr} canEdit={admin} />}
          {page === 'nbd' && <NbdSetupPage progress={pr} canEdit={admin} />}
          {(page === 'holidays' || page === 'weeklyOff') && <CalendarPage me={me} page={page} />}
          {page === 'seasons' && <SeasonsPage plan={p} />}
          {page === 'rounding' && <RoundingPage plan={p} />}
        </div>
      </div>
      <Confirm
        open={unlock}
        onOpenChange={setUnlock}
        title={t('crm.s.unlockTitle')}
        body={t('crm.s.unlockBody')}
        confirm={t('crm.s.unlock')}
        onConfirm={() => (setUnlock(false), act.mutate('unlock'))}
      />
    </div>
  );
}

function PageLink({
  page,
  active,
  done,
  locked,
  onClick,
}: {
  page: string;
  active: boolean;
  done: boolean;
  locked?: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const Icon = locked ? Lock : done ? Check : Circle;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm lg:w-full',
        active ? 'bg-ink text-ink-foreground' : 'hover:bg-muted/60',
      )}
    >
      <Icon className={cn('size-3.5 shrink-0', done && !active && 'text-status-ok-fg')} />
      <span className="whitespace-nowrap">{t(`crm.s.page.${page}`)}</span>
    </button>
  );
}

/** Overview: the year, GP and margin, business type, status; the journey checklist; plan completeness. */
function Overview({ plan, progress, go }: { plan: PlanData; progress: Progress; go: (p: Page) => void }) {
  const { t } = useTranslation();
  const y = plan.view.year;
  const plannedParts = (['year', 'quarters', 'months', 'weeks'] as const).filter((x) =>
    progress.config.done.includes(x),
  ).length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat
          big
          label={t('crm.s.target')}
          value={inr(y.turnover, true)}
          sub={y.growthPct !== null ? t('crm.s.growthIs', { pct: y.growthPct }) : undefined}
        />
        <Stat
          label={t('crm.s.gpTarget')}
          value={inr(y.gp, true)}
          sub={t('crm.s.marginIs', { pct: y.marginPct })}
        />
        <Stat label={t('crm.s.page.business')} value={t(`crm.s.bt.${progress.config.businessType}`)} />
        <Stat
          label={t('crm.s.planStatus')}
          value={t(`crm.s.status.${plan.status}`)}
          sub={plan.approvedBy ? t('crm.s.approvedBy', { name: plan.approvedBy }) : undefined}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <ul className="divide-y rounded-card border bg-card">
          {GROUPS.flatMap((g) => g.pages).map((x) => {
            const done = progress.config.done.includes(x);
            return (
              <li key={x} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                <button type="button" className="text-left hover:underline" onClick={() => go(x)}>
                  {t(`crm.s.page.${x}`)}
                </button>
                <StatusChip tone={done ? 'ok' : 'neutral'}>
                  {done ? t('crm.s.done') : t('crm.s.toDo')}
                </StatusChip>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col items-center gap-2 rounded-card border bg-card p-4">
          <Ring pct={plannedParts * 25} label={t('crm.s.completeness')} sub={t('crm.s.completeness')} />
          <p className="text-center text-xs text-muted-foreground">{t('crm.s.completenessHint')}</p>
        </div>
      </div>
    </div>
  );
}
