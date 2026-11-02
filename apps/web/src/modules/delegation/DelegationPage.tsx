import { CheckCircle2, ClipboardList, Gauge, ShieldCheck, Timer, Workflow } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { Badge } from '@/components/ui/form';
import { EmptyState, KpiTile, PageHeader } from '@/components/page';
import { useModuleSettings } from '@/lib/work';
import { cn } from '@/lib/utils';
import { useUsers } from '@/modules/system/api';
import { AddTask } from './AddTask';
import { useTasks, useTiles } from './api';
import { Reports } from './Reports';
import { TaskDrawer } from './TaskDrawer';
import { TaskList } from './TaskList';

const TABS = ['add', 'pending', 'verification', 'done', 'fms', 'scorecard'] as const;
type Tab = (typeof TABS)[number];

/** Delegation sheet (CLAUDE.md §5.1). */
export function DelegationPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'pending') as Tab;
  const open = params.get('task');
  const tz = me.company.timezone;
  const people = useUsers().data ?? [];
  const tiles = useTiles().data;
  const range = useModuleSettings('delegation').data?.reportsOpenOn === 'thisWeek' ? 'week' : 'all';
  const counts = useTasks({ tab: 'pending' }).data?.counts;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.delegation')} subtitle={t('navDesc.delegation')} />
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5 max-lg:[&>:first-child]:col-span-2">
        <KpiTile
          hero
          label={t('task.tile.pending')}
          value={tiles?.pending ?? '—'}
          note={t('task.tile.pendingNote')}
          icon={ClipboardList}
        />
        <KpiTile
          label={t('task.tile.overdue')}
          value={tiles?.overdue ?? '—'}
          tone={tiles?.overdue ? 'bad' : undefined}
          note={t('task.tile.overdueNote')}
          icon={Timer}
        />
        <KpiTile
          label={t('task.tile.toVerify')}
          value={tiles?.toVerify ?? '—'}
          note={t('task.tile.toVerifyNote', { count: tiles?.verifySlaMinutes ?? 60 })}
          icon={ShieldCheck}
        />
        <KpiTile
          label={t('task.tile.done')}
          value={tiles ? `${tiles.doneOnTime}/${tiles.doneThisWeek}` : '—'}
          note={t('task.tile.doneNote')}
          icon={CheckCircle2}
        />
        <KpiTile
          label={t('task.tile.score')}
          value={tiles?.score ?? '—'}
          unit={tiles?.score !== null && tiles ? '%' : undefined}
          note={t('task.tile.scoreNote')}
          icon={Gauge}
        />
      </div>
      <nav className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 border-b">
          {TABS.map((k) => (
            <button
              key={k}
              onClick={() => set({ tab: k })}
              className={cn(
                '-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                tab === k
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`task.tab.${k}`)}
              {counts && (k === 'pending' || k === 'verification' || k === 'done') && (
                <Badge>{counts[k]}</Badge>
              )}
            </button>
          ))}
        </div>
      </nav>
      {tab === 'add' && (
        <AddTask people={people} tz={tz} meId={me.user.id} onCreated={() => set({ tab: 'pending' })} />
      )}
      {(tab === 'pending' || tab === 'verification' || tab === 'done') && (
        <TaskList
          key={`${tab}-${range}`}
          tab={tab}
          defaultRange={range}
          people={people}
          tz={tz}
          onOpen={(id) => set({ task: id })}
        />
      )}
      {tab === 'fms' && (
        <EmptyState icon={Workflow} title={t('common.comingIn', { phase: 5 })} body={t('task.fmsSoon')} />
      )}
      {tab === 'scorecard' && <Reports tz={tz} />}
      {open && <TaskDrawer id={open} people={people} tz={tz} onClose={() => set({ task: null })} />}
    </div>
  );
}
