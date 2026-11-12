import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  GitBranch,
  List,
  Loader2,
  Plus,
  Rocket,
  Save,
  Wand2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  stepsToFix,
  validateFlow,
  type FlowDefinition,
  type FlowIssue,
  type FlowMeta,
  type FlowStep,
  type Me,
} from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabStrip } from '@/components/work';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useWorkMutation } from '@/lib/work';
import { useUsers } from '@/modules/system/api';
import { EditWithAiDialog } from '@/modules/ai/EditWithAiDialog';
import { toast } from 'sonner';
import { useFlow, type FlowDetail } from './api';
import { FieldsEditor } from './FieldsEditor';
import { keyFor } from './keys';
import { FlowDetails } from './FlowDetails';
import { FmsChart } from './FmsChart';
import { KnownFieldsFor } from './formula/KnownFieldsFor';
import { PublishProblems } from './PublishProblems';
import { StepEditor } from './StepEditor';

const TABS = ['steps', 'start', 'details', 'dashboard'] as const;
type Tab = (typeof TABS)[number];

/** Full-screen process editor (CLAUDE.md §6.2): steps, start form, details, KPI cards; save a draft, publish a version. */
export function FlowEditorPage({ me }: { me: Me }) {
  const { id } = useParams();
  const q = useFlow(id);
  if (q.isPending) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return <Editor key={`${q.data.id}-${q.data.version}`} flow={q.data} me={me} />;
}

function Editor({ flow }: { flow: FlowDetail; me: Me }) {
  const { t } = useTranslation();
  const users = useUsers().data;
  const people = useMemo(() => users ?? [], [users]);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const [def, setDef] = useState<FlowDefinition>(flow.definition);
  const [meta, setMeta] = useState<Partial<FlowMeta>>({});
  const [tab, setTab] = useState<Tab>('steps');
  const [view, setView] = useState<'list' | 'chart'>('list');
  const [selected, setSelected] = useState<string | null>(flow.definition.steps[0]?.key ?? null);
  const [problems, setProblems] = useState<FlowIssue[] | null>(null);
  const [changed, setChanged] = useState(false);
  const [aiEdit, setAiEdit] = useState(false);
  const issues = useMemo(
    () => validateFlow(def, new Set(people.filter((p) => p.status === 'ACTIVE').map((p) => p.id))),
    [def, people],
  );
  const toFix = useMemo(() => stepsToFix(issues), [issues]);
  const docTypes = useDocTypes();

  const edit = (next: FlowDefinition) => (setDef(next), setChanged(true));
  const save = useWorkMutation(
    () => api(`/api/fms/flows/${flow.id}`, { method: 'PUT', body: { definition: def, meta } }),
    [['fms']],
    () => t('fms.b.saved'),
  );
  const publish = useWorkMutation(
    async () => {
      await api(`/api/fms/flows/${flow.id}`, { method: 'PUT', body: { definition: def, meta } });
      return api<{ version: number }>(`/api/fms/flows/${flow.id}/publish`, { method: 'POST' });
    },
    [['fms']],
    (r) => t('fms.b.published', { v: r.version }),
  );
  const step = def.steps.find((s) => s.key === selected) ?? null;
  const setStep = (s: FlowStep) => edit({ ...def, steps: def.steps.map((x) => (x.key === s.key ? s : x)) });
  const insert = useCallback(
    (afterKey: string | null) => {
      const key = keyFor(
        t('fms.b.newStep', { n: def.steps.length + 1 }),
        def.steps.map((s) => s.key),
      );
      const fresh: FlowStep = {
        key,
        name: t('fms.b.newStep', { n: def.steps.length + 1 }),
        type: 'TASK',
        doerIds: [],
        starter: false,
        backupIds: [],
        time: { value: 4, unit: 'hours', anchor: 'previous' },
        checklist: [],
        fields: [],
        documents: [],
        proofRequired: false,
        notifyCustomer: false,
      };
      const at = afterKey ? def.steps.findIndex((s) => s.key === afterKey) + 1 : def.steps.length;
      edit({ ...def, steps: [...def.steps.slice(0, at), fresh, ...def.steps.slice(at)] });
      setSelected(key);
    },
    [def, t],
  );
  const move = (i: number, by: number) => {
    const steps = [...def.steps];
    const [x] = steps.splice(i, 1);
    steps.splice(i + by, 0, x!);
    edit({ ...def, steps });
  };
  const allFields = [...def.startFields, ...def.steps.flatMap((s) => s.fields)];
  const status =
    flow.status === 'PUBLISHED'
      ? flow.dirty || changed
        ? t('fms.b.publishedChanged', { v: flow.version })
        : t('fms.b.publishedV', { v: flow.version })
      : t(`fms.flowStatus.${flow.status}`);

  return (
    <div className="space-y-4">
      <div className="rounded-card border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <Button asChild size="icon" variant="ghost" aria-label={t('common.back')}>
            <Link to="/fms/builder">
              <ArrowLeft />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{flow.code}</span>
              <StatusChip
                tone={flow.status === 'PUBLISHED' ? 'ok' : flow.status === 'ARCHIVED' ? 'neutral' : 'warn'}
              >
                {status}
              </StatusChip>
            </div>
            <Input
              aria-label={t('fms.b.name')}
              className="mt-1 h-auto border-transparent bg-transparent px-0 text-xl font-semibold focus-visible:border-input sm:h-auto"
              defaultValue={flow.name}
              onChange={(e) => (setMeta({ ...meta, name: e.target.value }), setChanged(true))}
            />
            <p className="text-xs text-muted-foreground">
              {t('fms.b.metrics', {
                steps: def.steps.length,
                people: new Set(def.steps.flatMap((s) => s.doerIds)).size,
                days: flow.stats.days,
              })}
              {' · '}
              <span className={cn(issues.length ? 'font-semibold text-status-bad-fg' : 'text-status-ok-fg')}>
                {t('fms.b.toFix', { count: issues.length })}
              </span>
            </p>
          </div>
          <div className="inline-flex rounded-control bg-muted p-1 text-xs">
            {(['shifts', 'calendar'] as const).map((m) => (
              <button
                key={m}
                className={cn(
                  'h-8 rounded-[calc(var(--radius)*0.5)] px-3 font-medium',
                  def.timeModel === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
                onClick={() => edit({ ...def, timeModel: m })}
              >
                {t(`fms.b.model.${m}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={changed}
              title={changed ? t('ai.edit.saveFirst') : undefined}
              onClick={() => setAiEdit(true)}
            >
              <Wand2 /> {t('ai.edit.button')}
            </Button>
            <Button
              disabled={save.isPending || !changed}
              onClick={() => save.mutate(undefined, { onSuccess: () => setChanged(false) })}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('fms.b.saveDraft')}
            </Button>
            <Button
              variant="primary"
              disabled={publish.isPending}
              onClick={() =>
                issues.length
                  ? setProblems(issues)
                  : publish.mutate(undefined, { onSuccess: () => setChanged(false) })
              }
            >
              {publish.isPending ? <Loader2 className="animate-spin" /> : <Rocket />} {t('fms.b.publish')}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <span className="font-semibold">
            {t('fms.b.ready', { n: flow.readiness.score, of: flow.readiness.of })}
          </span>
          {Object.entries(flow.readiness.checks).map(([k, ok]) => (
            <span
              key={k}
              className={cn(
                'rounded-pill px-2 py-0.5',
                ok ? 'bg-status-ok-bg text-status-ok-fg' : 'bg-muted text-muted-foreground',
              )}
            >
              {ok ? '✓' : '○'} {t(`fms.ready.${k}`)}
            </span>
          ))}
        </div>
      </div>

      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={setTab}
        label={(k) => (k === 'steps' ? t('fms.b.tab.steps', { n: def.steps.length }) : t(`fms.b.tab.${k}`))}
      />

      {tab === 'steps' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-control bg-muted p-1 text-xs">
              {(['list', 'chart'] as const).map((v) => (
                <button
                  key={v}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-[calc(var(--radius)*0.5)] px-3 font-medium',
                    view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                  onClick={() => setView(v)}
                >
                  {v === 'list' ? <List className="size-3.5" /> : <GitBranch className="size-3.5" />}{' '}
                  {t(`fms.b.view.${v}`)}
                </button>
              ))}
            </div>
            <Button size="sm" className="ml-auto" onClick={() => insert(null)}>
              <Plus /> {t('fms.b.addStep')}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {view === 'chart' ? (
              <FmsChart
                def={def}
                names={names}
                toFix={toFix}
                selected={selected}
                onSelect={setSelected}
                onInsert={insert}
              />
            ) : (
              <ol className="space-y-1.5">
                {def.steps.map((s, i) => (
                  <li key={s.key}>
                    <div
                      className={cn(
                        'flex items-center gap-2 rounded-card border bg-card p-3',
                        selected === s.key && 'border-primary ring-1 ring-primary',
                      )}
                    >
                      <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(s.key)}>
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs">
                            {i + 1}
                          </span>
                          <span className="truncate">{s.name}</span>
                          {toFix.has(s.key) && (
                            <span className="grid size-5 place-items-center rounded-full bg-status-bad text-[11px] text-white">
                              !
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate pl-8 text-xs text-muted-foreground">
                          {t(`fms.st.${s.type}`)} ·{' '}
                          {s.starter
                            ? t('fms.b.starterShort')
                            : s.doerIds.map((d) => names.get(d) ?? '?').join(', ') || t('fms.b.noDoer')}{' '}
                          · {t('fms.b.nFields', { count: s.fields.length })}
                        </div>
                      </button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === 0}
                        aria-label={t('chk.up')}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={i === def.steps.length - 1}
                        aria-label={t('chk.down')}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                  </li>
                ))}
                {!def.steps.length && (
                  <p className="rounded-card border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t('fms.b.noSteps')}
                  </p>
                )}
              </ol>
            )}
            <div className="rounded-card border bg-card p-4">
              {step ? (
                <KnownFieldsFor def={def} stepKey={step.key}>
                  <StepEditor
                    key={step.key}
                    step={step}
                    steps={def.steps}
                    people={people}
                    docTypes={docTypes}
                    fields={allFields}
                    onChange={setStep}
                    onDelete={() => (
                      edit({ ...def, steps: def.steps.filter((s) => s.key !== step.key) }),
                      setSelected(null)
                    )}
                  />
                </KnownFieldsFor>
              ) : (
                <p className="text-sm text-muted-foreground">{t('fms.b.pickStep')}</p>
              )}
            </div>
          </div>
        </div>
      )}
      {tab === 'start' && (
        <div className="max-w-3xl space-y-2">
          <p className="text-sm text-muted-foreground">{t('fms.b.startHint')}</p>
          <FieldsEditor fields={def.startFields} onChange={(startFields) => edit({ ...def, startFields })} />
        </div>
      )}
      {(tab === 'details' || tab === 'dashboard') && (
        <FlowDetails
          flow={flow}
          people={people}
          part={tab}
          def={def}
          meta={meta}
          onMeta={(m) => (setMeta({ ...meta, ...m }), setChanged(true))}
        />
      )}

      {problems && (
        <PublishProblems
          problems={problems}
          def={def}
          onPick={(key) => (key && (setSelected(key), setTab('steps')), setProblems(null))}
        />
      )}
      {aiEdit && (
        <EditWithAiDialog
          flowId={flow.id}
          onClose={() => setAiEdit(false)}
          onAccept={(next) => {
            edit(next);
            setSelected(next.steps[0]?.key ?? null);
            setAiEdit(false);
            toast.success(t('ai.edit.applied'));
          }}
        />
      )}
    </div>
  );
}

/** Document types for the step editor (empty if this person can't see documents). */
function useDocTypes() {
  const q = useQuery({
    queryKey: ['fms', 'doctypes'],
    queryFn: () => api<{ types: { code: string; name: string }[] }>('/api/documents').then((r) => r.types),
    retry: false,
  });
  return q.data ?? [];
}
