import { useQuery } from '@tanstack/react-query';
import { Who } from '@/components/brand';
import { Clock, Download, Plus, Workflow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { TabStrip } from '@/components/work';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useDueLabel, useParamState } from '@/lib/work';
import { formatDateTime } from '@/lib/when';
import { useUsers } from '@/modules/system/api';
import { RECORD_TONE, useLive } from './api';
import { ExtraValues, LiveColumnsButton } from './LiveColumns';
import { RecordDrawer } from './RecordDrawer';
import { StartDialog } from './StartDialog';

const TABS = ['running', 'late', 'dueToday', 'onHold', 'closed', 'report'] as const;

/** Live FMS (CLAUDE.md §6.2): one flow at a time — where every record is and what is late. */
export function LiveFmsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, params, set } = useParamState('tab', TABS, 'running');
  const flowId = params.get('flow');
  const open = params.get('record');
  const tz = me.company.timezone;
  const people = useUsers().data ?? [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const due = useDueLabel();
  const q = useLive(flowId, tab === 'report' ? 'running' : tab);
  const [starting, setStarting] = useState(false);
  const data = q.data;
  const flow = data?.flow;

  const csv = () => {
    if (!data) return;
    const rows = data.records.map((r) => {
      const s = r.steps[0];
      return [
        r.number,
        r.title,
        formatDateTime(r.startedAt, tz),
        s?.stepName ?? '',
        s?.doerId ? names.get(s.doerId) : '',
        s ? formatDateTime(s.plannedAt, tz) : '',
        t(`fms.status.${r.status}`),
        ...data.columns.map((c) => r.cols?.[c.path] ?? ''),
      ];
    });
    const head = [
      '#',
      'Record',
      'Started',
      'Step',
      'With',
      'Due',
      'Status',
      ...data.columns.map((c) => c.label),
    ];
    const text = [head, ...rows]
      .map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`\uFEFF${text}`], { type: 'text/csv' }));
    a.download = `${flow?.name ?? 'fms'}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.liveFms')} subtitle={t('navDesc.liveFms')} />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : !flow ? (
        <EmptyState icon={Workflow} title={t('fms.noLive')} body={t('fms.noLiveBody')} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label={t('fms.flow')}
              className="w-auto min-w-64"
              value={flow.id}
              onChange={(e) => set({ flow: e.target.value, record: null })}
            >
              {data!.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex gap-2">
              {hasPermission(me.user.permissions, 'fms.edit') && (
                <LiveColumnsButton flowId={flow.id} chosen={flow.liveColumns} />
              )}
              <Button size="sm" onClick={csv}>
                <Download /> {t('task.rep.export')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setStarting(true)}>
                <Plus /> {t('fms.newRun', { run: flow.runName })}
              </Button>
            </div>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label={t('fms.stages')}>
            <ol className="flex w-max gap-2">
              {data!.stages.map((s, i) => (
                <li key={s.key} className="w-32 shrink-0 rounded-card border bg-card p-3 text-center">
                  <div
                    className={cn(
                      'mx-auto grid size-10 place-items-center rounded-full text-sm font-bold',
                      s.late
                        ? 'bg-status-bad-bg text-status-bad-fg'
                        : s.count
                          ? 'bg-status-info-bg text-status-info-fg'
                          : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {s.count}
                  </div>
                  <div className="mt-1.5 line-clamp-2 text-xs font-medium">
                    {i + 1}. {s.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.late ? t('fms.hereLate', { n: s.count, late: s.late }) : t('fms.here', { n: s.count })}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <TabStrip
            tabs={TABS}
            active={tab}
            onChange={(k) => set({ tab: k })}
            label={(k) => t(`fms.live.${k}`)}
            counts={data!.tiles ?? {}}
          />
          {tab === 'report' ? (
            <FlowReport flowId={flow.id} names={names} />
          ) : !data!.records.length ? (
            <EmptyState icon={Workflow} title={t('fms.noRecords')} />
          ) : (
            <ul className="divide-y overflow-hidden rounded-card border bg-card">
              {data!.records.map((r) => {
                const s = r.steps[0];
                const late = s && new Date(s.plannedAt) < new Date();
                return (
                  <li key={r.id}>
                    <button
                      onClick={() => set({ record: r.id })}
                      className="grid w-full gap-2 p-4 text-left hover:bg-muted/40 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center md:gap-4"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.title}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">#{r.number}</span> ·{' '}
                          {t('fms.startedOn', { at: formatDateTime(r.startedAt, tz) })}
                        </div>
                        <ExtraValues columns={data!.columns} cols={r.cols} />
                      </div>
                      <div className="text-sm">
                        {s ? (
                          <>
                            <div className="truncate">{s.stepName}</div>
                            <div className="text-xs text-muted-foreground">
                              {t('fms.stepOf', { n: s.position + 1, of: r.of })}
                            </div>
                          </>
                        ) : (
                          <StatusChip tone={RECORD_TONE[r.status]}>{t(`fms.status.${r.status}`)}</StatusChip>
                        )}
                      </div>
                      <div className="text-sm">
                        {s?.doerId ? <Who id={s.doerId} name={names.get(s.doerId)} /> : '—'}
                        {s?.coveredById && ` (${t('hr.covering')})`}
                      </div>
                      <div
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground',
                        )}
                      >
                        {s && (
                          <>
                            <Clock className="size-3.5" /> {due(s.plannedAt)}
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {open && <RecordDrawer id={open} tz={tz} people={people} onClose={() => set({ record: null })} />}
      {starting && flow && (
        <StartDialog
          flowId={flow.id}
          tz={tz}
          people={people}
          onClose={() => setStarting(false)}
          onStarted={(id) => (setStarting(false), set({ record: id }))}
        />
      )}
    </div>
  );
}

/** Planned vs actual per step, worst steps first, and each doer's on-time %. */
function FlowReport({ flowId, names }: { flowId: string; names: Map<string, string> }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['fms', 'report', flowId],
    queryFn: () =>
      api<{
        days: number;
        steps: {
          key: string;
          name: string;
          passed: number;
          plannedHours: number;
          actualHours: number;
          onTimePct: number;
        }[];
        worst: string[];
        people: { id: string; total: number; onTimePct: number }[];
      }>(`/api/fms/flows/${flowId}/report`),
  });
  if (!q.data) return <PageSkeleton />;
  const pct = (n: number) => (
    <span
      className={cn(
        'tabular font-semibold',
        n >= 90 ? 'text-status-ok-fg' : n >= 70 ? 'text-status-warn-fg' : 'text-status-bad-fg',
      )}
    >
      {n}%
    </span>
  );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5">{t('fms.step')}</th>
              <th className="px-3">{t('fms.passed')}</th>
              <th className="px-3">{t('fms.plannedH')}</th>
              <th className="px-3">{t('fms.actualH')}</th>
              <th className="px-3">{t('fms.onTimePct')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.data.steps.map((s) => (
              <tr
                key={s.key}
                className={cn(q.data.worst.includes(s.key) && s.onTimePct < 90 && 'bg-status-bad-bg/30')}
              >
                <td className="px-3 py-2">{s.name}</td>
                <td className="tabular px-3">{s.passed}</td>
                <td className="tabular px-3">{s.plannedHours}</td>
                <td className="tabular px-3">{s.actualHours}</td>
                <td className="px-3">{pct(s.onTimePct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!q.data.steps.length && <p className="p-4 text-sm text-muted-foreground">{t('fms.noReport')}</p>}
      </div>
      <div className="rounded-card border bg-card p-4">
        <h3 className="mb-2 text-sm font-semibold">{t('fms.byPerson')}</h3>
        <ul className="space-y-1.5 text-sm">
          {q.data.people.map((p) => (
            <li key={p.id} className="flex justify-between">
              <span>{names.get(p.id) ?? '?'}</span>
              <span>
                {pct(p.onTimePct)} <span className="text-xs text-muted-foreground">({p.total})</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{t('fms.reportDays', { n: q.data.days })}</p>
      </div>
    </div>
  );
}
