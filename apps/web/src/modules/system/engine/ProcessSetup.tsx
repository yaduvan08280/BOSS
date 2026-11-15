import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { PeoplePicker } from '@/components/people-picker';
import { Button } from '@/components/ui/button';
import { Field, Select, Switch, Textarea } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { personLabel } from '@/lib/people';
import { useWorkMutation } from '@/lib/work';
import { useOutlets } from '@/modules/hosp/api';
import { useProperty } from '@/modules/hotel/api';
import { useBranches } from '../api';
import {
  fieldKey,
  getAt,
  PROCESS_SETUP,
  setAt,
  SETUP_ELSEWHERE,
  SOURCES,
  type ScopeKind,
  type SetupField,
  type SourceId,
} from './setup';

type Rules = Record<string, unknown>;
/** The rules the chart should follow (the saved ones, or the unsaved draft); undefined when no panel is open. */
export type SetupDraft = { process: string; rules: Rules } | undefined;
type Place = { id: string; name: string };

/**
 * "Set up this process" beside its chart (decision 239), for every process that is not one of the five engine
 * modules: the company's own rules that change it, saved to the area they belong to. The chart follows the draft.
 */
export function ProcessSetup({
  process,
  people,
  onDraft,
}: {
  process: string;
  people: OrgPerson[];
  onDraft: (d: SetupDraft) => void;
}) {
  const { t } = useTranslation();
  const def = PROCESS_SETUP[process];
  const [scopeId, setScopeId] = useState('');
  if (!def) {
    const where = SETUP_ELSEWHERE[process];
    return (
      <div className="space-y-3">
        <h2 className="text-base font-semibold">{t('engine.setUp')}</h2>
        <p className="text-sm text-muted-foreground">{t('flows.setup.nothing')}</p>
        {where && (
          <Button asChild size="sm" variant="secondary">
            <Link to={where}>
              {t('flows.setup.openSetup')} <ArrowRight />
            </Link>
          </Button>
        )}
      </div>
    );
  }
  const src = SOURCES[def.src];
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('engine.setUp')}</h2>
        <p className="text-xs text-muted-foreground">{t(`flows.setup.from.${def.src}`)}</p>
      </div>
      {src.scope && <ScopePicker kind={src.scope} value={scopeId} onChange={setScopeId} />}
      {(!src.scope || scopeId) && (
        <Loaded
          key={`${process}-${scopeId}`}
          process={process}
          src={def.src}
          scopeId={scopeId}
          people={people}
          onDraft={onDraft}
        />
      )}
      {src.more && (
        <div className="border-t pt-4">
          <Button asChild size="sm" variant="ghost">
            <Link to={src.more}>
              {t('flows.setup.allRules')} <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function Loaded({
  process,
  src,
  scopeId,
  people,
  onDraft,
}: {
  process: string;
  src: SourceId;
  scopeId: string;
  people: OrgPerson[];
  onDraft: (d: SetupDraft) => void;
}) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['engine', 'setup', src, scopeId],
    queryFn: () => SOURCES[src].read(scopeId),
  });
  if (q.isPending)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t('common.loading')}
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="text-sm text-status-bad-fg">
        {q.error instanceof ApiError ? q.error.message : t('flows.setup.cantRead')}
      </p>
    );
  return (
    <SetupForm
      key={q.dataUpdatedAt}
      process={process}
      src={src}
      scopeId={scopeId}
      saved={q.data}
      people={people}
      onDraft={onDraft}
    />
  );
}

function SetupForm({
  process,
  src,
  scopeId,
  saved,
  people,
  onDraft,
}: {
  process: string;
  src: SourceId;
  scopeId: string;
  saved: Rules;
  people: OrgPerson[];
  onDraft: (d: SetupDraft) => void;
}) {
  const { t } = useTranslation();
  const fields = PROCESS_SETUP[process]!.fields;
  const [draft, setDraft] = useState<Rules>(saved);
  // The chart starts from the saved rules, and forgets the draft when this panel goes.
  useEffect(() => {
    onDraft({ process, rules: saved });
    return () => onDraft(undefined);
  }, [process, saved, onDraft]);
  const changed = fields
    .map((f) => f.path)
    .filter((p) => JSON.stringify(getAt(draft, p)) !== JSON.stringify(getAt(saved, p)));
  // Lists are typed a line at a time; blank lines are dropped when saved.
  const clean = fields
    .filter((f) => f.kind === 'lines')
    .reduce(
      (d, f) =>
        setAt(
          d,
          f.path,
          ((getAt(d, f.path) as string[] | undefined) ?? []).map((x) => x.trim()).filter(Boolean),
        ),
      draft,
    );
  const save = useWorkMutation(
    () => SOURCES[src].save(clean, changed, scopeId),
    [['engine', 'setup'], ...SOURCES[src].keys],
    () => t('engine.saved'),
  );
  const set = (path: string, v: unknown) => {
    const next = setAt(draft, path, v);
    setDraft(next);
    onDraft({ process, rules: next });
  };
  const active = people.filter((p) => p.status === 'ACTIVE');

  const render = (f: SetupField) => {
    const k = fieldKey(src, f.path);
    const label = t(`flows.f.${k}`);
    const hint = t(`flows.h.${k}`, { defaultValue: '' }) || undefined;
    const v = getAt(draft, f.path);
    switch (f.kind) {
      case 'toggle':
        return (
          <label key={k} className="flex items-start justify-between gap-3 py-2">
            <span>
              <span className="block text-sm font-medium">{label}</span>
              {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            </span>
            <Switch checked={Boolean(v)} onCheckedChange={(c) => set(f.path, c)} aria-label={label} />
          </label>
        );
      case 'select':
        return (
          <Field key={k} label={label} hint={hint}>
            <Select
              value={String(v ?? '')}
              onChange={(e) =>
                set(f.path, typeof f.options[0] === 'number' ? Number(e.target.value) : e.target.value)
              }
            >
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {t(`flows.o.${k}.${o}`)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case 'number':
        return (
          <Field key={k} label={`${label} (${t(`flows.unit.${f.unit}`)})`} hint={hint}>
            <Input
              type="number"
              inputMode="numeric"
              min={f.min ?? 0}
              max={f.max}
              value={v === undefined || v === null ? '' : String(v)}
              onChange={(e) => set(f.path, e.target.value === '' ? (f.min ?? 0) : Number(e.target.value))}
            />
          </Field>
        );
      case 'money':
        return (
          <Field key={k} label={`${label} (₹)`} hint={hint}>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={String(Number(v ?? 0) / 100)}
              onChange={(e) => set(f.path, Math.round(Number(e.target.value || 0) * 100))}
            />
          </Field>
        );
      case 'time': {
        const m = Number(v ?? 0);
        const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        return (
          <Field key={k} label={label} hint={hint}>
            <Input
              type="time"
              value={hhmm}
              onChange={(e) => {
                const [h, mm] = e.target.value.split(':').map(Number);
                if (h !== undefined && mm !== undefined && !Number.isNaN(h + mm)) set(f.path, h * 60 + mm);
              }}
            />
          </Field>
        );
      }
      case 'person':
        return (
          <Field key={k} label={label} hint={hint}>
            <Select value={(v as string | null) ?? ''} onChange={(e) => set(f.path, e.target.value || null)}>
              <option value="">{t('engine.notSet')}</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {personLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
        );
      case 'people':
        return (
          <div key={k} className="space-y-1.5">
            <span className="block text-sm font-medium">{label}</span>
            <PeoplePicker
              ids={(v as string[] | undefined) ?? []}
              people={people}
              label={label}
              onChange={(ids) => set(f.path, ids)}
            />
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
          </div>
        );
      case 'lines':
        return (
          <Field key={k} label={label} hint={hint ?? t('flows.setup.onePerLine')}>
            <Textarea
              rows={5}
              value={((v as string[] | undefined) ?? []).join('\n')}
              onChange={(e) => set(f.path, e.target.value.split('\n'))}
              onBlur={(e) =>
                set(
                  f.path,
                  e.target.value
                    .split('\n')
                    .map((x) => x.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
        );
      case 'stageDays': {
        const stages = (v as { key: string; name: string; days: number }[] | undefined) ?? [];
        return (
          <div key={k} className="space-y-2">
            <span className="block text-sm font-medium">{label}</span>
            {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
            <ul className="space-y-1.5">
              {stages.map((s, i) => (
                <li key={s.key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    aria-label={`${s.name} (${t('flows.unit.days')})`}
                    className="w-20"
                    value={String(s.days)}
                    onChange={(e) =>
                      set(
                        f.path,
                        stages.map((x, j) => (j === i ? { ...x, days: Number(e.target.value || 1) } : x)),
                      )
                    }
                  />
                  <span className="text-xs text-muted-foreground">{t('flows.unit.days')}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">{fields.map(render)}</div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!changed.length || save.isPending}
          onClick={() => save.mutate(undefined)}
        >
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
        {changed.length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(saved);
              onDraft({ process, rules: saved });
            }}
          >
            {t('flows.setup.undo')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Which property / branch / outlet the rules are for (they are kept per place). The first is chosen at the start. */
function ScopePicker({
  kind,
  value,
  onChange,
}: {
  kind: ScopeKind;
  value: string;
  onChange: (id: string) => void;
}) {
  if (kind === 'property') return <PropertyPicker value={value} onChange={onChange} />;
  if (kind === 'outlet') return <OutletPicker value={value} onChange={onChange} />;
  return <BranchPicker value={value} onChange={onChange} />;
}
function PropertyPicker(p: { value: string; onChange: (id: string) => void }) {
  const list = useProperty().list;
  return <Places kind="property" list={list} {...p} />;
}
function OutletPicker(p: { value: string; onChange: (id: string) => void }) {
  const list = (useOutlets().data ?? []).filter((o) => o.active).map((o) => ({ id: o.id, name: o.name }));
  return <Places kind="outlet" list={list} {...p} />;
}
function BranchPicker(p: { value: string; onChange: (id: string) => void }) {
  const list = (useBranches().data ?? []).map((b) => ({ id: b.id, name: b.name }));
  return <Places kind="branch" list={list} {...p} />;
}
function Places({
  kind,
  list,
  value,
  onChange,
}: {
  kind: ScopeKind;
  list: Place[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const first = list[0]?.id ?? '';
  useEffect(() => {
    if (!value && first) onChange(first);
  }, [value, first, onChange]);
  if (!list.length) return <p className="text-sm text-muted-foreground">{t(`flows.setup.none.${kind}`)}</p>;
  return (
    <Field label={t(`flows.setup.scope.${kind}`)}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
