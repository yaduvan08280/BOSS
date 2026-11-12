import { useQuery } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { FlowDefinition, FlowMeta, OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Field, Select, Switch, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { personLabel } from '@/lib/people';
import { useWorkMutation } from '@/lib/work';
import { useDepartments } from '@/modules/system/api';
import { aiApi, useAiStatus } from '@/modules/ai/api';
import { useFlowPaths, type FlowDetail, type KpiCard } from './api';

/** Field types a KPI card can total: numbers, amounts, formulas, and item lines (as their total). */
const KPI_TYPES = ['number', 'amount', 'items', 'formula'];

/** Details (run name, departments, coordinator & solver, video, public form) and the KPI dashboard. */
export function FlowDetails({
  flow,
  people,
  part,
  def,
  meta,
  onMeta,
}: {
  flow: FlowDetail;
  people: OrgPerson[];
  part: 'details' | 'dashboard';
  def: FlowDefinition;
  meta: Partial<FlowMeta>;
  onMeta: (m: Partial<FlowMeta>) => void;
}) {
  const { t } = useTranslation();
  const departments = useDepartments().data ?? [];
  const value = <K extends keyof FlowMeta>(k: K) =>
    meta[k] !== undefined ? meta[k] : (flow as unknown as FlowMeta)[k];
  const person = (k: 'coordinatorId' | 'coordinatorBackupId' | 'solverId' | 'solverBackupId') => (
    <Field label={t(`fms.d.${k}`)} hint={t(`fms.d.${k}Hint`)}>
      <Select
        value={(value(k) as string | null) ?? ''}
        onChange={(e) => onMeta({ [k]: e.target.value || null })}
      >
        <option value="">{t('fms.d.nobody')}</option>
        {people
          .filter((p) => p.status === 'ACTIVE')
          .map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
      </Select>
    </Field>
  );
  const depts = (value('departmentIds') as string[] | undefined) ?? [];
  const share = useWorkMutation(
    (enabled: boolean) =>
      api<{ publicEnabled: boolean; publicToken: string }>(`/api/fms/flows/${flow.id}/public`, {
        method: 'POST',
        body: { enabled },
      }),
    [['fms']],
  );
  const link = share.data?.publicToken ?? flow.publicToken;
  const enabled = share.data?.publicEnabled ?? flow.publicEnabled;

  if (part === 'dashboard') return <KpiEditor flow={flow} def={def} />;
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label={t('fms.d.runName')} hint={t('fms.d.runNameHint')}>
        <Input
          value={(value('runName') as string) ?? ''}
          onChange={(e) => onMeta({ runName: e.target.value })}
        />
      </Field>
      <Field label={t('fms.d.video')}>
        <Input
          placeholder="https://youtu.be/…"
          value={(value('videoUrl') as string | null) ?? ''}
          onChange={(e) => onMeta({ videoUrl: e.target.value })}
        />
      </Field>
      {person('coordinatorId')}
      {person('coordinatorBackupId')}
      {person('solverId')}
      {person('solverBackupId')}
      <Field label={t('fms.d.departments')} className="sm:col-span-2">
        <div className="flex flex-wrap gap-1.5">
          {departments.map((d) => (
            <button
              key={d.id}
              type="button"
              aria-pressed={depts.includes(d.id)}
              onClick={() =>
                onMeta({
                  departmentIds: depts.includes(d.id) ? depts.filter((x) => x !== d.id) : [...depts, d.id],
                })
              }
              className={`h-8 rounded-pill border px-3 text-xs ${depts.includes(d.id) ? 'border-primary bg-primary/15 font-semibold' : 'bg-card'}`}
            >
              {d.name}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('fms.d.description')} className="sm:col-span-2">
        <Textarea
          className="font-sans"
          rows={3}
          value={(value('description') as string | null) ?? ''}
          onChange={(e) => onMeta({ description: e.target.value })}
        />
      </Field>
      <div className="space-y-2 rounded-card border p-4 sm:col-span-2">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold">{t('fms.d.publicForm')}</span>
            <span className="block text-xs text-muted-foreground">{t('fms.d.publicFormHint')}</span>
          </span>
          <Switch
            checked={enabled}
            disabled={flow.status !== 'PUBLISHED' || share.isPending}
            onCheckedChange={(c) => share.mutate(c)}
            aria-label={t('fms.d.publicForm')}
          />
        </label>
        {enabled && link && (
          <div className="flex gap-2">
            <Input readOnly value={`${location.origin}/f/${link}`} aria-label={t('fms.d.publicLink')} />
            <Button
              size="icon"
              aria-label={t('fms.d.copy')}
              onClick={() =>
                void navigator.clipboard
                  .writeText(`${location.origin}/f/${link}`)
                  .then(() => toast.success(t('fms.d.copied')))
              }
            >
              <Copy />
            </Button>
          </div>
        )}
        {flow.status !== 'PUBLISHED' && (
          <p className="text-xs text-muted-foreground">{t('fms.d.publishFirst')}</p>
        )}
      </div>
    </div>
  );
}

/** KPI cards: a field, counted/summed/averaged over a period, against the period before. */
function KpiEditor({ flow, def }: { flow: FlowDetail; def: FlowDefinition }) {
  const { t } = useTranslation();
  const [cards, setCards] = useState<Omit<KpiCard, 'id'>[]>(
    flow.kpis.map(({ label, source, aggregation, period }) => ({ label, source, aggregation, period })),
  );
  const values = useQuery({
    queryKey: ['fms', 'kpis', flow.id],
    queryFn: () => api<KpiCard[]>(`/api/fms/flows/${flow.id}/kpis`),
  });
  const save = useWorkMutation(
    () => api(`/api/fms/flows/${flow.id}/kpis`, { method: 'PUT', body: cards }),
    [['fms']],
    () => t('fms.b.saved'),
  );
  // What a card can read: the count, numbers of the forms (formulas and item totals too), and — from the
  // server's list of the process's values — columns of the rows its fields link to ("Item → Rate").
  const paths = useFlowPaths(flow.id);
  const stepName = new Map(def.steps.map((s) => [s.key, s.name]));
  const own = [
    ...def.startFields
      .filter((f) => KPI_TYPES.includes(f.type))
      .map((f) => ({ value: `start:${f.key}`, label: `${t('fms.b.startForm')}: ${f.label}` })),
    ...def.steps.flatMap((s) =>
      s.fields
        .filter((f) => KPI_TYPES.includes(f.type))
        .map((f) => ({ value: `step:${s.key}:${f.key}`, label: `${s.name}: ${f.label}` })),
    ),
  ];
  const linked = (paths.data ?? [])
    .filter((p) => p.numeric === null)
    .map((p) => {
      const where = p.kpi.startsWith('start:')
        ? t('fms.b.startForm')
        : (stepName.get(p.kpi.split(':')[1]!) ?? '');
      return { value: p.kpi, label: `${where}: ${p.label}` };
    });
  const sources = [
    { value: 'count', label: t('fms.k.count', { run: flow.runName }) },
    ...own,
    ...linked.filter((l) => !own.some((o) => o.value === l.value)),
  ];
  const set = (i: number, patch: Partial<KpiCard>) =>
    setCards(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  // "Suggest with AI": new cards go below the others, to check and save like any card.
  const ai = useAiStatus();
  const suggest = useWorkMutation(() => aiApi.suggestKpis(flow.id), []);
  const addSuggestions = () =>
    suggest.mutate(undefined, {
      onSuccess: (list) => {
        const have = new Set(cards.map((c) => `${c.source}|${c.aggregation}|${c.period}`));
        const usable = new Set(sources.map((x) => x.value));
        const add = list
          .filter((k) => usable.has(k.source) && !have.has(`${k.source}|${k.aggregation}|${k.period}`))
          .map(({ label, source, aggregation, period }) => ({ label, source, aggregation, period }));
        setCards([...cards, ...add].slice(0, 12));
        toast.success(t('ai.kpi.added', { count: add.length }));
      },
    });
  const fmt = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : n.toLocaleString('en-IN');
  return (
    <div className="space-y-4">
      {values.data && values.data.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {values.data.map((c) => (
            <div key={c.id} className="rounded-card border bg-card p-3">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="tabular text-2xl font-semibold">{fmt(c.value)}</div>
              <div className="text-[11px] text-muted-foreground">
                {t('fms.k.before', { v: fmt(c.previous), period: t(`fms.k.period.${c.period}`) })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="max-w-4xl space-y-2">
        {cards.map((c, i) => (
          <div
            key={i}
            className="grid grid-cols-1 gap-2 rounded-control border bg-card p-3 sm:grid-cols-[1fr_1.3fr_120px_120px_auto]"
          >
            <Input
              aria-label={t('fms.k.label')}
              placeholder={t('fms.k.label')}
              value={c.label}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <Select
              aria-label={t('fms.k.source')}
              value={c.source}
              onChange={(e) =>
                set(i, {
                  source: e.target.value,
                  aggregation: e.target.value === 'count' ? 'COUNT' : c.aggregation,
                })
              }
            >
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('fms.k.aggregation')}
              value={c.aggregation}
              onChange={(e) => set(i, { aggregation: e.target.value })}
            >
              {['COUNT', 'TOTAL', 'AVERAGE', 'MIN', 'MAX'].map((a) => (
                <option key={a} value={a}>
                  {t(`fms.k.agg.${a}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('fms.k.period')}
              value={c.period}
              onChange={(e) => set(i, { period: e.target.value })}
            >
              {['TODAY', 'WEEK', 'MONTH', 'FY'].map((p) => (
                <option key={p} value={p}>
                  {t(`fms.k.period.${p}`)}
                </option>
              ))}
            </Select>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('common.remove')}
              onClick={() => setCards(cards.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              setCards([
                ...cards,
                { label: t('fms.k.newCard'), source: 'count', aggregation: 'COUNT', period: 'MONTH' },
              ])
            }
          >
            <Plus /> {t('fms.k.add')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!ai.data?.connected || suggest.isPending}
            title={ai.data?.connected ? undefined : t('ai.connectFirst')}
            onClick={addSuggestions}
          >
            {suggest.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} {t('ai.kpi.suggest')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            {t('fms.k.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
