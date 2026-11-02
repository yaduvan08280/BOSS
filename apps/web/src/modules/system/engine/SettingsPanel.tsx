import { Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Badge, Field, Select, Switch } from '@/components/ui/form';
import { useWorkMutation } from '@/lib/work';
import { api } from '@/lib/api';
import { formatShortDateTime } from '@/lib/when';
import { eventLabel } from '../integration/labels';
import { useEngineChanges, type EngineModuleInfo } from './api';
import { ENGINE_FIELDS, optionLabel, type SettingField } from './fields';

/** "Set up your flow": who does it, times and rules, steps on/off; recent changes; who hears about what. */
export function SettingsPanel({
  info,
  people,
  tz,
  onDraft,
}: {
  info: EngineModuleInfo;
  people: OrgPerson[];
  tz: string;
  /** Live preview: the chart follows unsaved toggles. */
  onDraft: (draft: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const module = info.module;
  const [draft, setDraft] = useState<Record<string, unknown>>(info.settings);
  const changes = useEngineChanges(module);
  const keys = [['engine'], ['tasks'], ['checklists'], ['slips'], ['tickets'], ['ea']];
  const save = useWorkMutation(
    () => api(`/api/work/settings/${module}`, { method: 'PUT', body: draft }),
    keys,
    () => t('engine.saved'),
  );
  const reset = useWorkMutation(
    () => api<Record<string, unknown>>(`/api/work/settings/${module}`, { method: 'DELETE' }),
    keys,
    () => t('engine.resetDone'),
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(info.settings);
  const set = (k: string, v: unknown) => {
    const next = { ...draft, [k]: v };
    setDraft(next);
    onDraft(next);
  };
  const people_ = people.filter((p) => p.status === 'ACTIVE');
  const names = new Map(people.map((p) => [p.id, p.name]));
  const show = (k: string, v: unknown) => {
    const f = [
      ...ENGINE_FIELDS[module].who,
      ...ENGINE_FIELDS[module].times,
      ...ENGINE_FIELDS[module].steps,
    ].find((x) => x.key === k);
    if (!f) return String(v);
    if (f.kind === 'toggle') return v ? t('engine.on') : t('engine.offWord');
    if (f.kind === 'person') return v ? (names.get(String(v)) ?? '?') : t('engine.notSet');
    return optionLabel(t, f, v as string);
  };

  const render = (f: SettingField) => {
    const v = draft[f.key];
    if (f.kind === 'toggle')
      return (
        <label key={f.key} className="flex items-start justify-between gap-3 py-2">
          <span>
            <span className="block text-sm font-medium">{t(`engine.f.${f.key}`)}</span>
            <span className="block text-xs text-muted-foreground">{t(`engine.h.${f.key}`)}</span>
          </span>
          <Switch
            checked={Boolean(v)}
            onCheckedChange={(c) => set(f.key, c)}
            aria-label={t(`engine.f.${f.key}`)}
          />
        </label>
      );
    if (f.kind === 'person')
      return (
        <Field key={f.key} label={t(`engine.f.${f.key}`)} hint={t(`engine.h.${f.key}`)}>
          <Select value={(v as string) ?? ''} onChange={(e) => set(f.key, e.target.value || null)}>
            <option value="">{t('engine.default')}</option>
            {people_.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      );
    return (
      <Field key={f.key} label={t(`engine.f.${f.key}`)}>
        <Select
          value={String(v)}
          onChange={(e) =>
            set(f.key, typeof f.options[0] === 'number' ? Number(e.target.value) : e.target.value)
          }
        >
          {f.options.map((o) => (
            <option key={o} value={o}>
              {optionLabel(t, f, o)}
            </option>
          ))}
        </Select>
      </Field>
    );
  };
  const section = (n: string, title: string, fields: SettingField[], grid = false) =>
    fields.length > 0 && (
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">
            {n}
          </span>
          {title}
        </h3>
        <div className={grid ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1' : 'divide-y'}>
          {fields.map(render)}
        </div>
      </section>
    );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('engine.setUp')}</h2>
        <Badge className={info.custom ? 'bg-status-info-bg text-status-info-fg' : undefined}>
          {info.custom ? t('engine.custom') : t('engine.defaultBadge')}
        </Badge>
      </div>
      {section('1', t('engine.who'), ENGINE_FIELDS[module].who, true)}
      {section('1B', t('engine.times'), ENGINE_FIELDS[module].times, true)}
      {section('2', t('engine.steps'), ENGINE_FIELDS[module].steps)}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
        </Button>
        {info.custom && (
          <Button
            variant="ghost"
            disabled={reset.isPending}
            onClick={() => reset.mutate(undefined, { onSuccess: (d) => (setDraft(d), onDraft(d)) })}
          >
            <RotateCcw /> {t('engine.reset')}
          </Button>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('engine.changes')}</h3>
        {!changes.data?.length ? (
          <p className="text-xs text-muted-foreground">{t('engine.noChanges')}</p>
        ) : (
          <ul className="space-y-2">
            {changes.data.slice(0, 6).map((c) => {
              const diff = Object.keys({ ...c.before, ...c.after }).filter(
                (k) => JSON.stringify(c.before?.[k]) !== JSON.stringify(c.after?.[k]),
              );
              return (
                <li key={c.id} className="rounded-control border p-2.5 text-xs">
                  <div className="text-muted-foreground">
                    {c.actorName ?? 'MONO'} · {formatShortDateTime(c.createdAt, tz)}
                  </div>
                  {diff.length ? (
                    diff.map((k) => (
                      <div key={k}>
                        <span className="font-medium">{t(`engine.f.${k}`)}</span>: {show(k, c.before?.[k])} →{' '}
                        {show(k, c.after?.[k])}
                      </div>
                    ))
                  ) : (
                    <div>{t('engine.resetToDefault')}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">{t('engine.rolesLegend')}</h3>
        <ul className="space-y-2">
          {info.roles.map((r) => (
            <li key={r.role} className="text-xs">
              <span className="font-semibold">{t(`notify.to.${r.role}`)}</span>
              <span className="text-muted-foreground">
                {' — '}
                {r.telegram.length
                  ? r.telegram.map((e) => eventLabel(t, e)).join(', ')
                  : t('engine.noTelegram')}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
