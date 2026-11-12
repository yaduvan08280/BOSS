import { Activity, ArrowRight, Blocks, Building2, Users, Workflow } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SystemSummary } from '@mono/shared';
import { Skeleton } from '@/components/ui/card';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const GAP_LINKS: Record<string, string> = {
  profile: '/system/company',
  departmentsWithoutHod: '/system/org-chart',
  peopleWithoutDepartment: '/system/users',
  peopleWithoutLogin: '/system/users',
  peopleWithoutDesignation: '/system/users',
  noBranch: '/system/company/branches',
  noShift: '/system/company/shifts',
  telegramNotLinked: '/system/integration',
  branchesWithoutManager: '/system/branches',
};

function CardShell({
  hero,
  children,
  className,
}: {
  hero?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-28 w-[62vw] max-w-60 shrink-0 snap-start flex-col rounded-card border p-3.5 sm:min-h-36 sm:w-auto sm:max-w-none sm:p-5',
        hero ? 'border-ink bg-ink text-ink-foreground' : 'bg-card',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Head({ icon: Icon, label, hero }: { icon: typeof Activity; label: string; hero?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-[13px] font-medium',
        hero ? 'opacity-80' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden /> {label}
    </div>
  );
}

/** The five cards that sit on top of every System Master tab (CLAUDE.md §4.1). */
export function HeaderCards({ summary }: { summary: SystemSummary | undefined }) {
  const { t } = useTranslation();
  const [gapsOpen, setGapsOpen] = useState(false);
  if (!summary) {
    return (
      <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton
            key={i}
            className="h-36 w-[78vw] max-w-72 shrink-0 rounded-card sm:w-auto sm:max-w-none"
          />
        ))}
      </div>
    );
  }
  const { company, processes, people, health } = summary;
  const bar = [processes.live, processes.building, processes.notStarted];
  return (
    <>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-5">
        <CardShell hero>
          <Head icon={Building2} label={t('system.cardCompany')} hero />
          <div className="tabular mt-2 text-2xl font-semibold sm:mt-3 sm:text-3xl">
            {company.stepsDone}
            <span className="text-base opacity-60">/{company.stepsTotal}</span>
          </div>
          <div className="text-xs opacity-75">{t('system.stepsDone')}</div>
          <div className="mt-auto flex items-center justify-between pt-3 text-xs">
            <span className="opacity-75">
              {t('system.peopleDepts', { people: company.people, departments: company.departments })}
            </span>
            <Link to="/system/company" className="inline-flex items-center gap-1 font-semibold">
              {t('system.openTab')} <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </CardShell>

        <CardShell>
          <Head icon={Blocks} label={t('system.cardEngine')} />
          <div className="tabular mt-2 text-2xl font-semibold sm:mt-3 sm:text-3xl">
            {summary.engine.modules}
          </div>
          <div className="text-xs text-muted-foreground">{t('system.engineModules')}</div>
          <Link
            to="/system/engine"
            className="mt-auto inline-flex items-center gap-1 pt-3 text-xs font-semibold"
          >
            {t('system.openDesigner')} <ArrowRight className="size-3.5" />
          </Link>
        </CardShell>

        <CardShell>
          <Head icon={Workflow} label={t('system.cardProcesses')} />
          <div className="tabular mt-2 text-2xl font-semibold sm:mt-3 sm:text-3xl">{processes.total}</div>
          <div className="mt-auto pt-3">
            <div className="flex h-1.5 overflow-hidden rounded-pill bg-muted">
              {processes.total > 0 &&
                bar.map((n, i) => (
                  <span
                    key={i}
                    style={{ width: `${(n / processes.total) * 100}%` }}
                    className={['bg-status-ok', 'bg-status-warn', 'bg-status-neutral'][i]}
                  />
                ))}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {t('system.processSplit', {
                live: processes.live,
                building: processes.building,
                notStarted: processes.notStarted,
              })}
            </div>
          </div>
          <Link to="/fms/builder" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">
            {t('system.openBuilder')} <ArrowRight className="size-3.5" />
          </Link>
        </CardShell>

        <CardShell>
          <Head icon={Users} label={t('system.cardPeople')} />
          <div className="mt-3 grid grid-cols-4 gap-1 text-center">
            {(['heavy', 'balanced', 'light', 'free'] as const).map((k) => (
              <div key={k}>
                <div className="tabular text-xl font-semibold">{people[k]}</div>
                <div className="text-[11px] text-muted-foreground">{t(`system.load.${k}`)}</div>
              </div>
            ))}
          </div>
          <div className="mt-auto pt-3 text-xs text-muted-foreground">
            {t('system.inProcess', { n: people.inProcess, total: people.total })}
          </div>
        </CardShell>

        <CardShell>
          <Head icon={Activity} label={t('system.cardHealth')} />
          <div className="tabular mt-2 text-2xl font-semibold sm:mt-3 sm:text-3xl">
            {health.percent}
            <span className="text-base text-muted-foreground">%</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {t('system.readyOf', { ready: health.ready, total: health.checks })}
          </div>
          {health.gaps.length > 0 && (
            <button
              onClick={() => setGapsOpen(true)}
              className="mt-auto inline-flex items-center gap-1 pt-3 text-left text-xs font-semibold"
            >
              {t('system.seeMissing')} <ArrowRight className="size-3.5" />
            </button>
          )}
        </CardShell>
      </div>

      <Sheet open={gapsOpen} onOpenChange={setGapsOpen}>
        <SheetContent side="right" title={t('system.missingTitle')} description={t('system.missingBody')}>
          <ul className="space-y-2 overflow-y-auto p-5">
            {health.gaps.map((g) => (
              <li key={g.key}>
                <Link
                  to={GAP_LINKS[g.key] ?? '/system'}
                  onClick={() => setGapsOpen(false)}
                  className="flex items-center gap-3 rounded-card border bg-card p-3.5 hover:bg-muted"
                >
                  <span className="tabular grid size-9 shrink-0 place-items-center rounded-control bg-status-warn-bg text-sm font-semibold text-status-warn-fg">
                    {g.count}
                  </span>
                  <span className="flex-1 text-sm">{t(`system.gap.${g.key}`, { count: g.count })}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
