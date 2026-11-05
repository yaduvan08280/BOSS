import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROUND_UNITS, type CrmConfig, type Me, type SeasonKind } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { HolidaysTab } from '@/modules/hr/HolidaysTab';
import { Chips, NumberChoice, Question } from '@/modules/hr/ui';
import { crmApi, inr, useCrmMutation, type PlanData, type Progress } from '../api';
import { useConfigEditor } from './editors';
import { usePlanEditor } from './editors';
import { SetupCard } from './shell';

/** A list of short texts: add, change, remove. */
function TextList({
  items,
  onChange,
  label,
  max,
  disabled,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  label: string;
  max: number;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [add, setAdd] = useState('');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {items.map((x, i) => (
          <span
            key={`${x}${i}`}
            className="inline-flex items-center gap-1 rounded-pill bg-muted py-1 pl-3 pr-1 text-sm"
          >
            {x}
            <button
              type="button"
              aria-label={t('common.remove')}
              disabled={disabled}
              className="grid size-5 place-items-center rounded-full hover:bg-card"
              onClick={() => onChange(items.filter((_, k) => k !== i))}
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => (
          e.preventDefault(),
          add.trim() && !items.includes(add.trim()) && (onChange([...items, add.trim()]), setAdd(''))
        )}
      >
        <Input
          aria-label={label}
          placeholder={label}
          value={add}
          disabled={disabled || items.length >= max}
          onChange={(e) => setAdd(e.target.value)}
          className="max-w-xs"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={disabled || !add.trim()}>
          <Plus /> {t('crm.s.add')}
        </Button>
      </form>
    </div>
  );
}

/** CRM configuration 7: lead sources, enquiry form fields, qualify questions, funnel stages with planned days. */
export function NbdSetupPage({ progress, canEdit }: { progress: Progress; canEdit: boolean }) {
  const { t } = useTranslation();
  const e = useConfigEditor(progress, 'nbd', ['nbd']);
  const n = e.value.nbd;
  const up = (x: Partial<CrmConfig['nbd']>) => canEdit && e.set({ nbd: { ...n, ...x } });
  return (
    <SetupCard
      title={t('crm.s.page.nbd')}
      hint={t('crm.s.nbdHint')}
      onSave={e.save}
      saving={e.saving}
      locked={!canEdit}
      dirty={e.dirty}
    >
      <Question label={t('crm.s.sources')}>
        <TextList
          items={n.sources}
          onChange={(sources) => up({ sources })}
          label={t('crm.s.addSource')}
          max={30}
          disabled={!canEdit}
        />
      </Question>
      <Question label={t('crm.s.formFields')} hint={t('crm.s.formFieldsHint')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(n.fields) as (keyof typeof n.fields)[]).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Switch
                checked={n.fields[k]}
                disabled={!canEdit}
                onCheckedChange={(v) => up({ fields: { ...n.fields, [k]: v } })}
              />{' '}
              {t(`crm.s.field.${k}`)}
            </label>
          ))}
        </div>
      </Question>
      <Question label={t('crm.s.questions')} hint={t('crm.s.questionsHint')}>
        <TextList
          items={n.questions}
          onChange={(questions) => up({ questions })}
          label={t('crm.s.addQuestion')}
          max={10}
          disabled={!canEdit}
        />
      </Question>
      <Question label={t('crm.s.stages')} hint={t('crm.s.stagesHint')}>
        <ol className="space-y-2">
          {n.stages.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-sm text-muted-foreground">{i + 1}.</span>
              <Input
                aria-label={t('crm.s.stageName')}
                value={s.name}
                disabled={!canEdit}
                onChange={(ev) =>
                  up({ stages: n.stages.map((x, k) => (k === i ? { ...x, name: ev.target.value } : x)) })
                }
                className="max-w-xs"
              />
              <Input
                aria-label={t('crm.s.stageDays', { stage: s.name })}
                inputMode="numeric"
                value={s.days}
                disabled={!canEdit}
                onChange={(ev) =>
                  up({
                    stages: n.stages.map((x, k) =>
                      k === i ? { ...x, days: Math.max(1, Math.min(365, Number(ev.target.value) || 1)) } : x,
                    ),
                  })
                }
                className="w-20 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">{t('hr.w.days')}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('common.remove')}
                disabled={!canEdit || n.stages.length < 2}
                onClick={() => up({ stages: n.stages.filter((_, k) => k !== i) })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ol>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canEdit || n.stages.length >= 10}
          onClick={() =>
            up({
              stages: [
                ...n.stages,
                { key: `stage_${Date.now().toString(36).slice(-5)}`, name: t('crm.s.newStage'), days: 7 },
              ],
            })
          }
        >
          <Plus /> {t('crm.s.addStage')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('crm.s.wonLost')}</p>
      </Question>
    </SetupCard>
  );
}

/** Settings 1–2: holidays and weekly offs are the HR calendar's (one calendar for the whole app). */
export function CalendarPage({ me, page }: { me: Me; page: 'holidays' | 'weeklyOff' }) {
  const { t } = useTranslation();
  const done = useCrmMutation(
    () => crmApi.markDone(page),
    () => t('crm.s.saved'),
  );
  return (
    <SetupCard
      title={t(`crm.s.page.${page}`)}
      hint={t('crm.s.calendarHint')}
      onSave={() => done.mutate(undefined)}
      saving={done.isPending}
      saveLabel={t('crm.s.looksRight')}
    >
      <HolidaysTab me={me} />
    </SetupCard>
  );
}

const KINDS: SeasonKind[] = ['peak', 'good', 'slow', 'normal'];
const TONE: Record<SeasonKind, string> = {
  peak: 'bg-status-ok-bg text-status-ok-fg',
  good: 'bg-status-info-bg text-status-info-fg',
  slow: 'bg-status-warn-bg text-status-warn-fg',
  normal: 'bg-muted text-muted-foreground',
};

/** Settings 3: seasons (Peak / Good / Slow, their lift) on the months; the year at a glance. */
export function SeasonsPage({ plan }: { plan: PlanData }) {
  const { t, i18n } = useTranslation();
  const e = usePlanEditor(plan, 'seasons', ['seasons']);
  const s = e.input.seasons;
  const kindOf = (m: number): SeasonKind =>
    s.peak.includes(m) ? 'peak' : s.good.includes(m) ? 'good' : s.slow.includes(m) ? 'slow' : 'normal';
  const setKind = (m: number, k: SeasonKind) => {
    const drop = (xs: number[]) => xs.filter((x) => x !== m);
    e.set({
      seasons: {
        ...s,
        peak: k === 'peak' ? [...drop(s.peak), m] : drop(s.peak),
        good: k === 'good' ? [...drop(s.good), m] : drop(s.good),
        slow: k === 'slow' ? [...drop(s.slow), m] : drop(s.slow),
      },
    });
  };
  const next = (k: SeasonKind) => KINDS[(KINDS.indexOf(k) + 1) % KINDS.length]!;
  return (
    <SetupCard
      title={t('crm.s.page.seasons')}
      hint={t('crm.s.seasonsHint')}
      onSave={e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty || !plan.config.done.includes('seasons')}
    >
      {(['peak', 'good', 'slow'] as const).map((k) => (
        <Question key={k} label={t(`crm.s.season.${k}`)}>
          <NumberChoice
            label={t(`crm.s.season.${k}`)}
            value={s[`${k}Pct`]}
            presets={k === 'peak' ? [20, 40, 60] : k === 'good' ? [10, 15, 25] : [-10, -20, -30]}
            unit="%"
            step={5}
            min={k === 'slow' ? -90 : 0}
            max={k === 'slow' ? 0 : 300}
            show={(n) => (n > 0 ? `+${n}` : String(n))}
            onChange={(v) => !e.locked && e.set({ seasons: { ...s, [`${k}Pct`]: v } })}
          />
        </Question>
      ))}
      <div className="space-y-2">
        <div className="text-sm font-medium">{t('crm.s.yearAtGlance')}</div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
          {plan.view.months.map((pm) => {
            const m = Number(pm.month.slice(5));
            const k = kindOf(m);
            return (
              <button
                key={pm.month}
                type="button"
                disabled={e.locked}
                onClick={() => setKind(m, next(k))}
                className={cn('rounded-control px-2 py-2 text-center text-xs', TONE[k])}
                aria-label={`${pm.month}: ${t(`crm.s.season.${k}`)}`}
              >
                <div className="font-semibold">
                  {new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
                    month: 'short',
                    timeZone: 'UTC',
                  }).format(new Date(`${pm.month}-01T00:00:00Z`))}
                </div>
                <div>{t(`crm.s.season.${k}`)}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t('crm.s.tapMonth')}</p>
      </div>
      {e.confirm}
    </SetupCard>
  );
}

/** Settings 4: round targets to ₹1,000 / ₹10,000 / ₹1 L (every level still adds up exactly). */
export function RoundingPage({ plan }: { plan: PlanData }) {
  const { t } = useTranslation();
  const e = usePlanEditor(plan, 'rounding', ['roundUnit']);
  return (
    <SetupCard
      title={t('crm.s.page.rounding')}
      hint={t('crm.s.roundingHint')}
      onSave={e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty || !plan.config.done.includes('rounding')}
    >
      <Chips
        label={t('crm.s.page.rounding')}
        value={e.input.roundUnit}
        onChange={(roundUnit) => !e.locked && e.set({ roundUnit })}
        options={ROUND_UNITS.map((u) => ({ value: u, label: u ? inr(u) : t('crm.s.noRounding') }))}
      />
      <p className="text-sm text-muted-foreground">
        {t('crm.s.roundingExample', {
          month: inr(e.view.months[0]!.turnover),
          week: inr(e.view.months[0]!.weeks[0]!.turnover),
        })}
      </p>
      {e.confirm}
    </SetupCard>
  );
}
