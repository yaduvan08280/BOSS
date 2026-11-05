import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ROUND_UNITS } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Chips, NumberChoice } from '@/modules/hr/ui';
import { Bars } from '../charts';
import { inr, toPaise, type PlanData } from '../api';
import { usePlanEditor } from './editors';
import { MoneyInput, SetupCard, Stat } from './shell';
import { rupeeText } from './format';

/** Plan the Year 1: last year, this year's growth (or an exact amount), the margin. */
export function YearPage({ plan }: { plan: PlanData }) {
  const { t } = useTranslation();
  const e = usePlanEditor(plan, 'year', [
    'lastTurnover',
    'lastGp',
    'mode',
    'growthPct',
    'exactTurnover',
    'gpMarginPct',
    'roundUnit',
  ]);
  const [last, setLast] = useState(rupeeText(plan.input.lastTurnover));
  const [lastGp, setLastGp] = useState(rupeeText(plan.input.lastGp));
  const [exact, setExact] = useState(rupeeText(plan.input.exactTurnover));
  const y = e.view.year;
  const lastMargin = e.input.lastTurnover
    ? Math.round((e.input.lastGp / e.input.lastTurnover) * 1000) / 10
    : 0;
  return (
    <SetupCard
      title={t('crm.s.page.year')}
      hint={t('crm.s.yearHint')}
      onSave={e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('crm.s.lastTurnover')}>
          <MoneyInput
            label={t('crm.s.lastTurnover')}
            value={last}
            disabled={e.locked}
            onChange={(v) => (setLast(v), e.set({ lastTurnover: toPaise(v) ?? 0 }))}
          />
        </Field>
        <Field
          label={t('crm.s.lastGp')}
          hint={lastMargin ? t('crm.s.marginWas', { pct: lastMargin }) : undefined}
        >
          <MoneyInput
            label={t('crm.s.lastGp')}
            value={lastGp}
            disabled={e.locked}
            onChange={(v) => (setLastGp(v), e.set({ lastGp: toPaise(v) ?? 0 }))}
          />
        </Field>
      </div>
      <Chips
        label={t('crm.s.how')}
        value={e.input.mode}
        onChange={(mode) => !e.locked && e.set({ mode })}
        options={[
          { value: 'growth', label: t('crm.s.growBy') },
          { value: 'exact', label: t('crm.s.exact') },
        ]}
      />
      {e.input.mode === 'growth' ? (
        <NumberChoice
          label={t('crm.s.growBy')}
          value={e.input.growthPct}
          presets={[10, 20, 30, 50, 75, 100]}
          unit="%"
          min={-90}
          max={1000}
          onChange={(growthPct) => !e.locked && e.set({ growthPct })}
          show={(n) => `+${n}`}
        />
      ) : (
        <Field label={t('crm.s.exactAmount')}>
          <MoneyInput
            label={t('crm.s.exactAmount')}
            value={exact}
            disabled={e.locked}
            onChange={(v) => (setExact(v), e.set({ exactTurnover: toPaise(v) }))}
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('crm.s.margin')} hint={t('crm.s.marginHint')}>
          <Input
            inputMode="decimal"
            disabled={e.locked}
            placeholder={String(lastMargin)}
            value={e.input.gpMarginPct ?? ''}
            onChange={(ev) =>
              e.set({
                gpMarginPct:
                  ev.target.value === '' ? null : Math.min(100, Math.max(0, Number(ev.target.value) || 0)),
              })
            }
            className="w-28 tabular-nums"
          />
        </Field>
        <Field label={t('crm.s.page.rounding')}>
          <Chips
            label={t('crm.s.page.rounding')}
            value={e.input.roundUnit}
            onChange={(roundUnit) => !e.locked && e.set({ roundUnit })}
            options={ROUND_UNITS.map((u) => ({ value: u, label: u ? inr(u) : t('crm.s.noRounding') }))}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          big
          label={t('crm.s.target')}
          value={inr(y.turnover, true)}
          sub={y.growthPct !== null ? t('crm.s.growthIs', { pct: y.growthPct }) : undefined}
        />
        <Stat
          label={t('crm.s.gpTarget')}
          value={inr(y.gp, true)}
          sub={t('crm.s.marginIs', { pct: y.marginPct })}
        />
        <Stat label={t('crm.s.everyMonth')} value={inr(e.view.perMonth, true)} />
        <Stat label={t('crm.s.everyWeek')} value={inr(e.view.perWeek, true)} />
      </div>
      <Bars
        label={t('crm.s.lastVsThis')}
        className="h-28"
        data={[
          { label: t('crm.s.lastYear'), value: y.lastTurnover, muted: true, extra: y.lastGp },
          { label: t('crm.s.thisYear'), value: y.turnover, extra: y.gp },
        ]}
      />
      <div className="flex justify-around text-xs text-muted-foreground">
        <span>{t('crm.s.lastYear')}</span>
        <span>{t('crm.s.thisYear')}</span>
      </div>
      {e.confirm}
    </SetupCard>
  );
}

/** Plan the Year 2: each quarter's growth over the one before, fine-tuned; seasons and holidays already in. */
export function QuartersPage({ plan }: { plan: PlanData }) {
  const { t } = useTranslation();
  const e = usePlanEditor(plan, 'quarters', ['quarterGrowthPct', 'quarterTunePct']);
  const g = e.input.quarterGrowthPct;
  const tune = e.input.quarterTunePct;
  return (
    <SetupCard
      title={t('crm.s.page.quarters')}
      hint={t('crm.s.quartersHint')}
      onSave={e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty}
    >
      {[1, 2, 3].map((q) => (
        <div key={q} className="space-y-1">
          <div className="text-sm font-medium">{t('crm.s.qOverPrev', { q: q + 1, p: q })}</div>
          <NumberChoice
            label={t('crm.s.qOverPrev', { q: q + 1, p: q })}
            value={g[q]!}
            presets={[0, 5, 10, 15, 20, 30]}
            unit="%"
            min={-90}
            max={500}
            show={(n) => (n ? `+${n}` : t('crm.s.noGrowth'))}
            onChange={(v) => !e.locked && e.set({ quarterGrowthPct: g.map((x, i) => (i === q ? v : x)) })}
          />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {e.view.quarters.map((q, i) => (
          <div key={i} className="space-y-2 rounded-card border bg-card p-3">
            <div className="text-xs text-muted-foreground">Q{i + 1}</div>
            <div className="text-lg font-semibold tabular-nums">{inr(q.turnover, true)}</div>
            <div className="text-xs text-muted-foreground">
              {t('crm.s.gpShort', { gp: inr(q.gp, true) })} · {q.sharePct}%
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label={t('hr.w.less')}
                disabled={e.locked}
                onClick={() =>
                  e.set({ quarterTunePct: tune.map((x, k) => (k === i ? Math.max(-90, x - 5) : x)) })
                }
              >
                <Minus />
              </Button>
              <span className="w-12 text-center text-xs tabular-nums">
                {tune[i] ? `${tune[i]! > 0 ? '+' : ''}${tune[i]}%` : '—'}
              </span>
              <Button
                size="icon-sm"
                variant="secondary"
                aria-label={t('hr.w.more')}
                disabled={e.locked}
                onClick={() =>
                  e.set({ quarterTunePct: tune.map((x, k) => (k === i ? Math.min(500, x + 5) : x)) })
                }
              >
                <Plus />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('crm.s.yearStays', { total: inr(e.view.year.turnover, true) })}
      </p>
      {e.confirm}
    </SetupCard>
  );
}
