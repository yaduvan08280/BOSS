import { Clock, Plus, Route } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { EmptyState, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { TabStrip } from '@/components/work';
import { cn } from '@/lib/utils';
import { useDueLabel, useParamState } from '@/lib/work';
import { formatDateTime } from '@/lib/when';
import { useUsers } from '@/modules/system/api';
import { RECORD_TONE, useMyFms, useRecord } from './api';
import { RecordDrawer } from './RecordDrawer';
import { knownOf } from './record-links';
import { StartDialog } from './StartDialog';
import { StepDialog } from './StepDialog';

const TABS = ['steps', 'owned'] as const;

/** My FMS steps (CLAUDE.md §6.2): steps waiting on me, records I started, and flows I can start. */
export function MyStepsPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, params, set } = useParamState('tab', TABS, 'steps');
  const tz = me.company.timezone;
  const people = useUsers().data ?? [];
  const names = new Map(people.map((p) => [p.id, p.name]));
  const due = useDueLabel();
  const q = useMyFms();
  const [starting, setStarting] = useState<string | null>(null);
  const [doing, setDoing] = useState<{ recordId: string; stepId: string } | null>(null);
  const open = params.get('record');

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.myFmsSteps')} subtitle={t('navDesc.myFmsSteps')} />
      {!q.data ? (
        <PageSkeleton />
      ) : (
        <>
          {q.data.flows.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('fms.startWithYou')}</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {q.data.flows.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-card border bg-card p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{f.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('fms.nRunning', { count: f.running })}
                      </div>
                    </div>
                    <Button size="sm" variant="primary" onClick={() => setStarting(f.id)}>
                      <Plus /> {f.runName}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <TabStrip
            tabs={TABS}
            active={tab}
            onChange={(k) => set({ tab: k })}
            label={(k) => t(`fms.my.${k}`)}
            counts={{ steps: q.data.steps.length, owned: q.data.owned.length }}
          />
          {tab === 'steps' ? (
            !q.data.steps.length ? (
              <EmptyState icon={Route} title={t('fms.noMySteps')} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-card border bg-card">
                {q.data.steps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 p-4">
                    <button className="min-w-0 flex-1 text-left" onClick={() => set({ record: s.record.id })}>
                      <div className="text-xs text-muted-foreground">
                        {s.record.flow.name} · <span className="font-mono">#{s.record.number}</span>{' '}
                        {s.record.title}
                      </div>
                      <div className="text-sm font-semibold">{s.stepName}</div>
                    </button>
                    <span
                      className={cn(
                        'flex items-center gap-1 text-xs',
                        s.late ? 'font-semibold text-status-bad-fg' : 'text-muted-foreground',
                      )}
                    >
                      <Clock className="size-3.5" /> {due(s.plannedAt)}
                    </span>
                    {s.record.status === 'ON_HOLD' ? (
                      <StatusChip tone="warn">{t('fms.status.ON_HOLD')}</StatusChip>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setDoing({ recordId: s.record.id, stepId: s.id })}
                      >
                        {t('fms.doStep')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )
          ) : !q.data.owned.length ? (
            <EmptyState icon={Route} title={t('fms.noOwned')} />
          ) : (
            <ul className="divide-y overflow-hidden rounded-card border bg-card">
              {q.data.owned.map((r) => {
                const s = r.steps[0];
                const n = s ? s.position + 1 : r.of;
                return (
                  <li key={r.id}>
                    <button
                      className="grid w-full gap-2 p-4 text-left hover:bg-muted/40 md:grid-cols-[1.4fr_1fr_auto] md:items-center"
                      onClick={() => set({ record: r.id })}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{r.title}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.flow.name} · <span className="font-mono">#{r.number}</span> ·{' '}
                          {formatDateTime(r.startedAt, tz)}
                        </div>
                      </div>
                      <div>
                        <div className="h-1.5 overflow-hidden rounded-pill bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${Math.round(((r.status === 'CLOSED' ? r.of : n - 1) / Math.max(1, r.of)) * 100)}%`,
                            }}
                          />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {s ? `${s.stepName} · ${t('fms.stepOf', { n, of: r.of })}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-1 md:items-end">
                        <StatusChip tone={RECORD_TONE[r.status]}>{t(`fms.status.${r.status}`)}</StatusChip>
                        {s?.doerId && (
                          <span className="text-xs text-muted-foreground">{names.get(s.doerId)}</span>
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
      {starting && (
        <StartDialog
          flowId={starting}
          tz={tz}
          people={people}
          onClose={() => setStarting(null)}
          onStarted={(id) => (setStarting(null), set({ record: id, tab: 'owned' }))}
        />
      )}
      {doing && <DoStep {...doing} tz={tz} onClose={() => setDoing(null)} />}
    </div>
  );
}

/** Loads the record (for the step's form) and opens the step dialog. */
function DoStep({
  recordId,
  stepId,
  tz,
  onClose,
}: {
  recordId: string;
  stepId: string;
  tz: string;
  onClose: () => void;
}) {
  const r = useRecord(recordId).data;
  const people = useUsers().data ?? [];
  const row = r?.steps.find((s) => s.id === stepId);
  const step = row && r?.definition.steps.find((s) => s.key === row.stepKey);
  if (!r || !step) return null;
  return (
    <StepDialog
      stepId={stepId}
      step={step}
      flowId={r.flow.id}
      recordId={r.id}
      known={knownOf(r)}
      title={`${r.title} · #${r.number}`}
      tz={tz}
      people={people}
      onClose={onClose}
    />
  );
}
