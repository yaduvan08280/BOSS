import {
  BellRing,
  ClipboardList,
  Expand,
  ListChecks,
  ListTodo,
  NotebookPen,
  Shrink,
  Ticket,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ENGINE_MODULES, engineGraph, NOTIFY_EVENTS, type EngineModule } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';
import { useUsers } from '../api';
import { eventLabel, recipientLabel } from '../integration/labels';
import { useRules } from '../integration/api';
import { useEngine } from './api';
import { FlowChart, FlowLegend } from './FlowChart';
import { SettingsPanel } from './SettingsPanel';

const ICON: Record<EngineModule, LucideIcon> = {
  checklist: ListChecks,
  delegation: ListTodo,
  slip: NotebookPen,
  ticket: Ticket,
  ea: ClipboardList,
};

/** Business Engine flow designer (CLAUDE.md §5): the life of each module, drawn from its state machine. */
export function EnginePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const module = (
    ENGINE_MODULES.includes(params.get('m') as EngineModule) ? params.get('m') : 'delegation'
  ) as EngineModule;
  const [view, setView] = useState<'chart' | 'alerts'>('chart');
  const [full, setFull] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<EngineModule, Record<string, unknown>>>>({});
  const q = useEngine();
  const people = useUsers().data ?? [];
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  const info = q.data?.find((m) => m.module === module);
  const graph = engineGraph(module, drafts[module] ?? info?.settings);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError || !info) return <ErrorState onRetry={() => void q.refetch()} />;

  return (
    <div className="space-y-4">
      <nav aria-label={t('engine.modules')} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2">
          {q.data!.map((m) => {
            const Icon = ICON[m.module];
            return (
              <li key={m.module}>
                <button
                  onClick={() => setParams({ m: m.module }, { replace: true })}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-card border bg-card p-3 text-left',
                    m.module === module ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-control bg-muted">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-sm font-semibold">
                      {t(`engine.m.${m.module}`)}
                    </span>
                    <span className="block whitespace-nowrap text-xs text-muted-foreground">
                      {m.custom ? t('engine.custom') : t('engine.defaultBadge')} ·{' '}
                      {t('engine.alertsN', { n: m.alerts.active, total: m.alerts.total })}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          className={cn('min-w-0 overflow-hidden', full && 'fixed inset-2 z-50 flex flex-col lg:inset-6')}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">
                {t('engine.lifeOf', { what: t(`engine.thing.${module}`) })}
              </h2>
              <p className="text-xs text-muted-foreground">{t('engine.lifeHint')}</p>
            </div>
            <div className="flex gap-1.5">
              <div className="inline-flex rounded-control bg-muted p-1">
                {(['chart', 'alerts'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      'h-8 whitespace-nowrap rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium',
                      view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {v === 'chart'
                      ? t('engine.flowchart')
                      : t('engine.alerts', { n: info.alerts.active, total: info.alerts.total })}
                  </button>
                ))}
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={full ? t('engine.exitFull') : t('engine.fullView')}
                onClick={() => setFull(!full)}
              >
                {full ? <Shrink /> : <Expand />}
              </Button>
            </div>
          </div>
          {view === 'chart' ? (
            <>
              <FlowChart
                module={module}
                graph={graph}
                className={full ? 'h-auto flex-1 lg:h-auto' : undefined}
              />
              <div className="border-t p-3">
                <FlowLegend />
              </div>
            </>
          ) : (
            <Alerts module={module} />
          )}
        </Card>

        <Card className="p-4">
          <SettingsPanel
            key={`${module}-${JSON.stringify(info.settings)}`}
            info={info}
            people={people}
            tz={tz}
            onDraft={(d) => setDrafts({ ...drafts, [module]: d })}
          />
        </Card>
      </div>
    </div>
  );
}

/** Each event of the module: is a rule on, who gets it, on which channels. */
function Alerts({ module }: { module: EngineModule }) {
  const { t } = useTranslation();
  const rules = useRules();
  const events = NOTIFY_EVENTS.filter((e) => e.module === module);
  return (
    <div className="space-y-2 p-4">
      <ul className="divide-y rounded-card border">
        {events.map((e) => {
          const rule = rules.data?.find((r) => r.event === e.event && r.active);
          return (
            <li key={e.event} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <span className="flex items-center gap-2">
                <BellRing className="size-4 text-muted-foreground" />
                {eventLabel(t, e.event)}
              </span>
              {rule ? (
                <span className="text-xs text-muted-foreground">
                  {rule.recipients.map((r) => recipientLabel(t, r)).join(', ')} · {rule.channels.join(', ')}
                </span>
              ) : (
                <StatusChip tone="neutral">{t('engine.noRule')}</StatusChip>
              )}
            </li>
          );
        })}
      </ul>
      <Button asChild size="sm" variant="ghost">
        <Link to="/system/integration/rules">
          <Workflow /> {t('engine.editRules')}
        </Link>
      </Button>
    </div>
  );
}
