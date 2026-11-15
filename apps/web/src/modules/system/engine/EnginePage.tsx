import {
  BedDouble,
  Boxes,
  ClipboardList,
  Expand,
  HandCoins,
  ListChecks,
  ListTodo,
  Map as MapIcon,
  NotebookPen,
  PartyPopper,
  Shrink,
  Ticket,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  engineGraph,
  isEngineProcess,
  PROCESS_GROUPS,
  PROCESSES,
  processDef,
  processGraph,
  systemMap,
  type EngineModule,
} from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { ScrollRow } from '@/components/scroll-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useMe } from '@/modules/auth/session';
import { useFlows } from '@/modules/fms/api';
import { useUsers } from '../api';
import { useEngine } from './api';
import { EngineAlerts } from './EngineAlerts';
import { FlowChart, FlowLegend } from './FlowChart';
import { FmsView } from './FmsView';
import { ProcessSetup, type SetupDraft } from './ProcessSetup';
import { FmsInfo, MapIndex, ProcessInfo } from './ProcessSide';
import { SettingsPanel } from './SettingsPanel';

const GROUP_ICON: Record<string, LucideIcon> = {
  map: MapIcon,
  work: Workflow,
  hr: Users,
  sales: TrendingUp,
  stock: Boxes,
  money: HandCoins,
  restaurant: UtensilsCrossed,
  hotel: BedDouble,
  events: PartyPopper,
  fms: ListChecks,
};
const ENGINE_ICON: Record<EngineModule, LucideIcon> = {
  checklist: ListChecks,
  delegation: ListTodo,
  slip: NotebookPen,
  ticket: Ticket,
  ea: ClipboardList,
};

const statusCount = (key: string) =>
  processGraph(key)!.nodes.filter((n) => n.kind === 'status' || n.kind === 'finished' || n.kind === 'deadend')
    .length;

/**
 * Business Engine (CLAUDE.md §5, decision 238): the life of every process in MONO, drawn from the state machines the
 * API runs, with the five engine modules' settings beside their charts, the company's own FMS processes, and a map of
 * how they all hand over to each other. `?m=<process>`, `?m=map`, or `?g=fms&f=<flow id>`.
 */
export function EnginePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const hosp = Boolean(useMe().data?.company.hospitality);
  const shown = PROCESSES.filter((p) => hosp || !p.hosp);
  const m = params.get('m') ?? '';
  const def = shown.find((p) => p.key === m);
  const group = params.get('g') === 'fms' ? 'fms' : m === 'map' ? 'map' : (def?.group ?? 'work');
  const process = group === 'fms' || group === 'map' ? group : (def?.key ?? 'delegation');
  const groups = ['map', ...PROCESS_GROUPS.filter((g) => shown.some((p) => p.group === g)), 'fms'];
  const open = (key: string) => setParams({ m: key }, { replace: false });

  const [view, setView] = useState<'chart' | 'alerts'>('chart');
  const [full, setFull] = useState(false);
  const [drafts, setDrafts] = useState<Partial<Record<EngineModule, Record<string, unknown>>>>({});
  // A process's own rules from its Set up panel: the chart follows them (decision 239).
  const [setup, setSetup] = useState<SetupDraft>();
  const [side, setSide] = useState<'setup' | 'links'>('setup');
  const q = useEngine();
  const flows = useFlows();
  const people = useUsers().data ?? [];
  const tz = useMe().data?.company.timezone ?? 'Asia/Kolkata';
  const engine = isEngineProcess(process) ? process : null;
  const info = engine ? q.data?.find((x) => x.module === engine) : undefined;
  const flowList = (flows.data ?? []).filter((f) => f.status !== 'ARCHIVED');
  const flow = flowList.find((f) => f.id === params.get('f')) ?? flowList[0];
  const graph =
    process === 'map'
      ? systemMap(hosp)
      : engine
        ? engineGraph(engine, drafts[engine] ?? info?.settings, processDef(engine)?.links)
        : processGraph(process, setup?.process === process ? setup.rules : undefined);

  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;

  const card = (
    key: string,
    title: string,
    sub: string,
    Icon: LucideIcon,
    active: boolean,
    go: () => void,
  ) => (
    <li key={key}>
      <button
        type="button"
        onClick={go}
        className={cn(
          'flex w-full items-center gap-3 rounded-card border bg-card p-3 text-left',
          active ? 'border-primary ring-1 ring-primary' : 'hover:border-primary/50',
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-muted">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold whitespace-nowrap">{title}</span>
          <span className="block text-xs whitespace-nowrap text-muted-foreground">{sub}</span>
        </span>
      </button>
    </li>
  );

  const title =
    process === 'map'
      ? t('flows.mapTitle')
      : process === 'fms'
        ? (flow?.name ?? t('flows.group.fms'))
        : engine
          ? t('engine.lifeOf', { what: t(`engine.thing.${engine}`) })
          : t(`flows.p.${process}`);
  const hint =
    process === 'map' ? t('flows.mapHint') : process === 'fms' ? t('flows.fmsHint') : t('flows.lifeHint');

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('flows.title')}</h2>
        {!hosp && <p className="text-xs text-muted-foreground">{t('flows.hospOff')}</p>}
      </div>
      <ScrollRow label={t('engine.modules')} watch={group}>
        <div className="flex w-max gap-1 border-b">
          {groups.map((g) => {
            const Icon = GROUP_ICON[g]!;
            return (
              <button
                key={g}
                type="button"
                data-current={g === group}
                aria-current={g === group ? 'page' : undefined}
                onClick={() =>
                  g === 'map' || g === 'fms'
                    ? setParams(g === 'map' ? { m: 'map' } : { g: 'fms' })
                    : setParams({ m: shown.find((p) => p.group === g)!.key })
                }
                className={cn(
                  '-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap',
                  g === group
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="size-4" /> {t(`flows.group.${g}`)}
              </button>
            );
          })}
        </div>
      </ScrollRow>

      {group !== 'map' && (
        <nav aria-label={t(`flows.group.${group}`)} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-2 pb-1">
            {group === 'fms'
              ? flowList.map((f) =>
                  card(
                    f.id,
                    f.name,
                    `${f.code} · ${t('flows.steps', { count: f.steps })}`,
                    Workflow,
                    f.id === flow?.id,
                    () => setParams({ g: 'fms', f: f.id }, { replace: true }),
                  ),
                )
              : shown
                  .filter((p) => p.group === group)
                  .map((p) => {
                    const e = isEngineProcess(p.key) ? q.data!.find((x) => x.module === p.key) : undefined;
                    return card(
                      p.key,
                      e ? t(`engine.m.${p.key}`) : t(`flows.p.${p.key}`),
                      e
                        ? `${e.custom ? t('engine.custom') : t('engine.defaultBadge')} · ${t('engine.alertsN', { n: e.alerts.active, total: e.alerts.total })}`
                        : t('flows.statusesN', { count: statusCount(p.key) }),
                      isEngineProcess(p.key) ? ENGINE_ICON[p.key] : (GROUP_ICON[p.group] ?? Workflow),
                      p.key === process,
                      () => setParams({ m: p.key }, { replace: true }),
                    );
                  })}
          </ul>
        </nav>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          className={cn('min-w-0 overflow-hidden', full && 'fixed inset-2 z-50 flex flex-col lg:inset-6')}
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{title}</h2>
              <p className="text-xs text-muted-foreground">{engine ? t('engine.lifeHint') : hint}</p>
            </div>
            <div className="flex gap-1.5">
              {engine && info && (
                <div className="inline-flex rounded-control bg-muted p-1">
                  {(['chart', 'alerts'] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className={cn(
                        'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-xs font-medium whitespace-nowrap',
                        view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                      )}
                    >
                      {v === 'chart'
                        ? t('engine.flowchart')
                        : t('engine.alerts', { n: info.alerts.active, total: info.alerts.total })}
                    </button>
                  ))}
                </div>
              )}
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
          {process === 'fms' ? (
            <FmsView id={flow?.id} loading={flows.isPending} />
          ) : engine && view === 'alerts' ? (
            <EngineAlerts module={engine} />
          ) : (
            <>
              <FlowChart
                process={process}
                graph={graph!}
                onOpen={open}
                className={full ? 'h-auto flex-1 lg:h-auto' : undefined}
              />
              {process !== 'map' && (
                <div className="border-t p-3">
                  <FlowLegend />
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="p-4">
          {process === 'fms' ? (
            flow && <FmsInfo flow={flow} />
          ) : process === 'map' ? (
            <MapIndex keys={shown.map((p) => p.key)} onOpen={open} />
          ) : (
            <div className="space-y-4">
              <div role="tablist" className="grid grid-cols-2 rounded-control bg-muted p-1">
                {(['setup', 'links'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={side === v}
                    onClick={() => setSide(v)}
                    className={cn(
                      'h-9 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium whitespace-nowrap',
                      side === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {t(v === 'setup' ? 'flows.setupTab' : 'flows.howLinks')}
                  </button>
                ))}
              </div>
              {side === 'links' ? (
                <ProcessInfo process={process} onOpen={open} />
              ) : engine && info ? (
                <SettingsPanel
                  key={`${engine}-${JSON.stringify(info.settings)}`}
                  info={info}
                  people={people}
                  tz={tz}
                  onDraft={(d) => setDrafts({ ...drafts, [engine]: d })}
                />
              ) : (
                <ProcessSetup key={process} process={process} people={people} onDraft={setSetup} />
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
