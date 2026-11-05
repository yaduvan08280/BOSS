import { CalendarDays, Check, Loader2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate, type PlanMonth, type PlanWeek } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Switch } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Chips, NumberChoice } from '@/modules/hr/ui';
import { Bars } from '../charts';
import { crmApi, inr, toPaise, useCrmMutation, type PlanData } from '../api';
import { usePlanEditor } from './editors';
import { MoneyInput, SetupCard } from './shell';
import { rupeeText } from './format';

const useMonthName = () => {
  const { i18n } = useTranslation();
  return (m: string, long = false) =>
    new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
      month: long ? 'long' : 'short',
      year: long ? 'numeric' : undefined,
      timeZone: 'UTC',
    }).format(new Date(`${m}-01T00:00:00Z`));
};
const SEASON_TONE = { peak: 'ok', good: 'info', slow: 'warn', normal: 'neutral' } as const;

/** Plan the Year 3: months (bars), growth within each quarter, and a month changed by hand. */
export function MonthsPage({ plan }: { plan: PlanData }) {
  const { t } = useTranslation();
  const name = useMonthName();
  const e = usePlanEditor(plan, 'months', ['monthGrowthPct']);
  const [editing, setEditing] = useState<number | null>(null);
  const reset = useCrmMutation(
    () => crmApi.savePlan({ monthGrowthPct: e.input.monthGrowthPct }, plan.fy, true),
    () => t('crm.s.saved'),
  );
  return (
    <SetupCard
      title={t('crm.s.page.months')}
      hint={t('crm.s.monthsHint')}
      onSave={plan.input.months ? undefined : e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty}
    >
      {!plan.input.months ? (
        <NumberChoice
          label={t('crm.s.monthGrowth')}
          value={e.input.monthGrowthPct}
          presets={[0, 2, 5, 10]}
          unit="%"
          min={-50}
          max={100}
          onChange={(monthGrowthPct) => !e.locked && e.set({ monthGrowthPct })}
          show={(n) => (n ? `+${n}` : t('crm.s.noGrowth'))}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-control border bg-muted/40 px-3 py-2 text-sm">
          {t('crm.s.monthsByHand')}
          <Button
            size="sm"
            variant="secondary"
            disabled={e.locked || reset.isPending}
            onClick={() => reset.mutate(undefined)}
          >
            {t('crm.s.workOutAgain')}
          </Button>
        </div>
      )}
      <Bars
        label={t('crm.s.page.months')}
        data={e.view.months.map((m) => ({ label: m.month, value: m.turnover, extra: m.gp }))}
      />
      <ul className="divide-y rounded-card border">
        {e.view.months.map((m, i) => (
          <li key={m.month} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-24 font-medium">{name(m.month)}</span>
              {m.season !== 'normal' && (
                <StatusChip tone={SEASON_TONE[m.season]}>{t(`crm.s.season.${m.season}`)}</StatusChip>
              )}
              <span className="text-xs text-muted-foreground">
                {t('crm.s.workingDays', { count: m.workingDays })}
              </span>
            </div>
            <div className="flex items-center gap-3 tabular-nums">
              <span className="text-xs text-muted-foreground">
                {t('crm.s.gpShort', { gp: inr(m.gp, true) })}
              </span>
              <b>{inr(m.turnover, true)}</b>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('crm.s.changeMonth', { month: name(m.month, true) })}
                disabled={e.locked}
                onClick={() => setEditing(i)}
              >
                <Pencil />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t('crm.s.monthsAddUp', { total: inr(e.view.year.turnover) })}
      </p>
      {editing !== null && (
        <MonthDialog
          plan={plan}
          month={e.view.months[editing]!}
          index={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {e.confirm}
    </SetupCard>
  );
}

function MonthDialog({
  plan,
  month,
  index,
  onClose,
}: {
  plan: PlanData;
  month: PlanMonth;
  index: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const name = useMonthName();
  const [turn, setTurn] = useState(rupeeText(month.turnover));
  const [gp, setGp] = useState(rupeeText(month.gp));
  const [keep, setKeep] = useState(true);
  const tp = toPaise(turn);
  const gpp = toPaise(gp);
  const save = useCrmMutation(
    () => crmApi.editMonth({ fy: plan.fy, index, turnover: tp!, gp: gpp ?? undefined, keepTotal: keep }),
    () => t('crm.s.saved'),
  );
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.s.changeMonth', { month: name(month.month, true) })}
      footer={
        <Button
          disabled={tp === null || save.isPending || (gpp !== null && gpp > tp!)}
          onClick={() => save.mutate(undefined, { onSuccess: onClose })}
        >
          {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('common.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label={t('crm.s.turnover')}>
          <MoneyInput label={t('crm.s.turnover')} value={turn} onChange={setTurn} />
        </Field>
        <Field label={t('crm.s.gp')}>
          <MoneyInput label={t('crm.s.gp')} value={gp} onChange={setGp} />
        </Field>
        <div className="space-y-2">
          <div className="text-sm font-medium">{t('crm.s.restOfPlan')}</div>
          <Chips
            label={t('crm.s.restOfPlan')}
            value={keep}
            onChange={setKeep}
            options={[
              { value: false, label: t('crm.s.changeYear') },
              { value: true, label: t('crm.s.keepYear') },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            {keep
              ? t('crm.s.keepYearHint', { total: inr(plan.view.year.turnover) })
              : t('crm.s.changeYearHint', {
                  total: inr(plan.view.year.turnover - month.turnover + (tp ?? 0)),
                })}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

/** Plan the Year 4: each month's Monday–Sunday weeks (part weeks joined or not) and day by day. */
export function WeeksPage({ plan }: { plan: PlanData }) {
  const { t } = useTranslation();
  const name = useMonthName();
  const e = usePlanEditor(plan, 'weeks', ['joinPartWeeks', 'dayPct']);
  const nowMonth = e.view.months.findIndex((m) => m.month === plan.today.slice(0, 7));
  const [m, setM] = useState(Math.max(0, nowMonth));
  const [days, setDays] = useState<PlanWeek | null>(null);
  const month = e.view.months[m]!;
  return (
    <SetupCard
      title={t('crm.s.page.weeks')}
      hint={t('crm.s.weeksHint')}
      onSave={e.save}
      saving={e.saving}
      locked={e.locked}
      dirty={e.dirty || !plan.config.done.includes('weeks')}
      saveLabel={t('crm.s.saveNext')}
    >
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={e.input.joinPartWeeks}
          disabled={e.locked}
          onCheckedChange={(joinPartWeeks) => e.set({ joinPartWeeks })}
        />{' '}
        {t('crm.s.joinWeeks')}
      </label>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('crm.s.pickMonth')}>
        {e.view.months.map((x, i) => (
          <button
            key={x.month}
            type="button"
            role="radio"
            aria-checked={i === m}
            onClick={() => setM(i)}
            className={cn(
              'h-8 rounded-pill border px-3 text-sm',
              i === m ? 'border-ink bg-ink text-ink-foreground' : 'bg-card text-muted-foreground',
            )}
          >
            {name(x.month)}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-card border">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              {['week', 'target', 'gp', 'working', 'holidays', 'perDay', ''].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">
                  {h && t(`crm.s.col.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {month.weeks.map((w) => (
              <tr key={w.start} className="border-t">
                <td className="px-3 py-2 tabular-nums">
                  {formatLocalDate(w.start).slice(0, 5)} – {formatLocalDate(w.end).slice(0, 5)}
                  {w.days < 7 && (
                    <span className="ml-1 text-xs text-muted-foreground">({t('hr.a.partWeek')})</span>
                  )}
                </td>
                <td className="px-3 py-2 font-medium tabular-nums">{inr(w.turnover)}</td>
                <td className="px-3 py-2 tabular-nums">{inr(w.gp)}</td>
                <td className="px-3 py-2 tabular-nums">{w.workingDays}</td>
                <td className="px-3 py-2 tabular-nums">{w.holidays}</td>
                <td className="px-3 py-2 tabular-nums">
                  {w.workingDays ? inr(Math.round(w.turnover / w.workingDays)) : '—'}
                </td>
                <td className="px-2 py-1 text-right">
                  <Button size="sm" variant="ghost" disabled={e.locked} onClick={() => setDays(w)}>
                    <CalendarDays /> {t('crm.s.dayByDay')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={cn('text-sm', e.view.addsUp ? 'text-status-ok-fg' : 'text-status-bad-fg')}>
        {t('crm.s.weeksCheck', {
          month: name(month.month, true),
          weeks: inr(month.weeks.reduce((a, w) => a + w.turnover, 0)),
          target: inr(month.turnover),
          year: inr(e.view.year.turnover),
        })}
      </p>
      {days && (
        <DayDialog
          week={days}
          pct={e.input.dayPct[days.start] ?? []}
          onSave={(pct) => (e.set({ dayPct: { ...e.input.dayPct, [days.start]: pct } }), setDays(null))}
          onClose={() => setDays(null)}
        />
      )}
      {e.confirm}
    </SetupCard>
  );
}

function DayDialog({
  week,
  pct,
  onSave,
  onClose,
}: {
  week: PlanWeek;
  pct: number[];
  onSave: (pct: number[]) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'equal' | 'each'>(pct.some((x) => x) ? 'each' : 'equal');
  const [vals, setVals] = useState(week.daily.map((_, i) => String(pct[i] ?? 0)));
  const day = (d: string) =>
    new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${d}T00:00:00Z`));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('crm.s.dayByDayTitle', { from: formatLocalDate(week.start), to: formatLocalDate(week.end) })}
      description={t('crm.s.dayByDayHint', { total: inr(week.turnover) })}
      footer={
        <Button
          onClick={() =>
            onSave(mode === 'equal' ? [] : vals.map((v) => Math.max(-100, Math.min(500, Number(v) || 0))))
          }
        >
          {t('crm.s.useThis')}
        </Button>
      }
    >
      <div className="space-y-3">
        <Chips
          label={t('crm.s.dayByDay')}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'equal', label: t('crm.s.equal') },
            { value: 'each', label: t('crm.s.each') },
          ]}
        />
        <ul className="divide-y rounded-control border">
          {week.daily.map((d, i) => (
            <li key={d.date} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="w-28">
                {day(d.date)} {formatLocalDate(d.date).slice(0, 5)}
              </span>
              {d.working ? (
                mode === 'each' ? (
                  <label className="flex items-center gap-1">
                    <Input
                      aria-label={t('crm.s.dayPct', { day: formatLocalDate(d.date) })}
                      inputMode="decimal"
                      value={vals[i]}
                      onChange={(e) => setVals(vals.map((v, k) => (k === i ? e.target.value : v)))}
                      className="w-20 text-right tabular-nums"
                    />
                    %
                  </label>
                ) : (
                  <span className="tabular-nums">{inr(d.turnover)}</span>
                )
              ) : (
                <span className="text-xs text-muted-foreground">{t('crm.s.dayOff')}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
