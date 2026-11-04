import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { payPolicySchema, type PayPolicy, type PayRules } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { personLabel } from '@/lib/people';
import { useDepartments, useDesignations, useUsers } from '@/modules/system/api';
import { useHrMutation } from './api';
import { payApi, usePayRules } from './payApi';
import { Chips, NumberChoice, Question, YesNo } from './ui';

type Scope = PayRules['overrides'][number]['scope'];

/** How attendance turns into pay: the company's answers, and answers that differ for a team, designation or person. */
export function PayRulesTab() {
  const q = usePayRules();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return <RulesForm key={JSON.stringify(q.data.rules)} saved={q.data.rules} />;
}

function RulesForm({ saved }: { saved: PayRules }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<PayRules>(saved);
  const save = useHrMutation(
    () => payApi.saveRules(rules),
    () => t('hr.p.rulesSaved'),
  );
  const company = payPolicySchema.parse(rules);
  const overrides = rules.overrides;
  const put = (i: number, o: PayRules['overrides'][number]) =>
    setRules({ ...rules, overrides: overrides.map((x, j) => (j === i ? o : x)) });
  const incomplete = overrides.some((o) => !o.id);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('hr.p.r.company')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PolicyQuestions value={company} onChange={(x) => setRules({ ...rules, ...x })} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('hr.p.r.different')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('hr.p.r.differentHint')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {overrides.map((o, i) => (
            <div key={i} className="space-y-2 rounded-control border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[160px_1fr_auto]">
                <Select
                  value={o.scope}
                  aria-label={t('hr.w.scope')}
                  onChange={(e) => put(i, { ...o, scope: e.target.value as Scope, id: '' })}
                >
                  <option value="department">{t('hr.w.team')}</option>
                  <option value="designation">{t('hr.p.r.designation')}</option>
                  <option value="person">{t('hr.w.person')}</option>
                </Select>
                <Who scope={o.scope} value={o.id} onChange={(id) => put(i, { ...o, id })} />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('common.remove')}
                  onClick={() => setRules({ ...rules, overrides: overrides.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
              <PolicyQuestions
                value={{ ...company, ...o.rules }}
                changed={o.rules}
                onChange={(x) => put(i, { ...o, rules: { ...o.rules, ...x } })}
              />
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setRules({ ...rules, overrides: [...overrides, { scope: 'designation', id: '', rules: {} }] })
            }
          >
            <Plus /> {t('hr.w.addOverride')}
          </Button>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {incomplete && <span className="text-sm text-status-warn-fg">{t('hr.p.r.pickWho')}</span>}
        <Button disabled={save.isPending || incomplete} onClick={() => save.mutate(undefined)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('hr.p.r.save')}
        </Button>
      </div>
    </div>
  );
}

function Who({ scope, value, onChange }: { scope: Scope; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const depts = useDepartments();
  const titles = useDesignations();
  const users = useUsers();
  const options =
    scope === 'department'
      ? (depts.data ?? []).map((d) => ({ id: d.id, label: d.name }))
      : scope === 'designation'
        ? (titles.data ?? []).map((d) => ({ id: d.id, label: d.name }))
        : (users.data ?? [])
            .filter((u) => u.status === 'ACTIVE')
            .map((u) => ({ id: u.id, label: personLabel(u) }));
  return (
    <Select value={value} aria-label={t('hr.w.who')} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('org.choose')}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * The pay questions. For an override, `changed` holds what differs from the company (marked), the rest shows
 * the company's answer.
 */
function PolicyQuestions({
  value: v,
  onChange,
  changed,
}: {
  value: PayPolicy;
  onChange: (x: Partial<PayPolicy>) => void;
  changed?: Partial<PayPolicy>;
}) {
  const { t } = useTranslation();
  const mark = (k: keyof PayPolicy, label: string) =>
    changed && changed[k] !== undefined ? `${label} · ${t('hr.p.r.differs')}` : label;
  const [fixed, setFixed] = useState(String(v.dayOffFixedPaise / 100));
  return (
    <div>
      <Question label={mark('monthDays', t('hr.p.r.monthDays'))} hint={t('hr.p.r.monthDaysHint')}>
        <Chips
          label={t('hr.p.r.monthDays')}
          value={v.monthDays}
          onChange={(monthDays) => onChange({ monthDays })}
          options={(['calendar', 'working', 'fixed'] as const).map((k) => ({
            value: k,
            label: t(`hr.p.r.md.${k}`),
          }))}
        />
        {v.monthDays === 'fixed' && (
          <NumberChoice
            label={t('hr.p.r.fixedDays')}
            value={v.fixedDays}
            presets={[26, 30]}
            unit={t('hr.w.days')}
            min={20}
            max={31}
            onChange={(fixedDays) => onChange({ fixedDays })}
          />
        )}
      </Question>
      <Question label={mark('paidOffDays', t('hr.p.r.paidOff'))} hint={t('hr.p.r.paidOffHint')}>
        <YesNo
          label={t('hr.p.r.paidOff')}
          value={v.paidOffDays}
          onChange={(paidOffDays) => onChange({ paidOffDays })}
        />
      </Question>
      <Question label={mark('dayOffWork', t('hr.p.r.dayOffWork'))} hint={t('hr.p.r.dayOffWorkHint')}>
        <Chips
          label={t('hr.p.r.dayOffWork')}
          value={v.dayOffWork}
          onChange={(dayOffWork) => onChange({ dayOffWork })}
          options={(['compOff', 'multiplier', 'fixed', 'none'] as const).map((k) => ({
            value: k,
            label: t(`hr.p.r.dow.${k}`),
          }))}
        />
        {v.dayOffWork === 'multiplier' && (
          <NumberChoice
            label={t('hr.p.r.multiplier')}
            value={v.dayOffMultiplier}
            presets={[1, 1.5, 2]}
            unit={t('hr.p.r.xDay')}
            step={0.25}
            min={0.25}
            max={5}
            onChange={(dayOffMultiplier) => onChange({ dayOffMultiplier })}
          />
        )}
        {v.dayOffWork === 'fixed' && (
          <label className="flex items-center gap-2 text-sm">
            ₹
            <Input
              inputMode="decimal"
              aria-label={t('hr.p.r.fixedAmount')}
              value={fixed}
              className="w-32 tabular-nums"
              onChange={(e) => {
                setFixed(e.target.value);
                const n = Math.round(Number(e.target.value) * 100);
                if (Number.isFinite(n) && n >= 0) onChange({ dayOffFixedPaise: n });
              }}
            />
            {t('hr.p.r.perDayOff')}
          </label>
        )}
      </Question>
      <Question label={mark('overtimePay', t('hr.p.r.overtime'))} hint={t('hr.p.r.overtimeHint')}>
        <YesNo
          label={t('hr.p.r.overtime')}
          value={v.overtimePay}
          onChange={(overtimePay) => onChange({ overtimePay })}
        />
        {v.overtimePay && (
          <NumberChoice
            label={t('hr.p.r.otRate')}
            value={v.overtimeMultiplier}
            presets={[1, 1.5, 2]}
            unit={t('hr.p.r.xHour')}
            step={0.25}
            min={0}
            max={5}
            onChange={(overtimeMultiplier) => onChange({ overtimeMultiplier })}
          />
        )}
      </Question>
      <Question label={mark('lateEvery', t('hr.p.r.late'))} hint={t('hr.p.r.lateHint')}>
        <NumberChoice
          label={t('hr.p.r.late')}
          value={v.lateEvery}
          presets={[0, 3, 4, 5]}
          unit=""
          show={(n) => (n ? t('hr.p.r.lateDays', { count: n }) : t('hr.p.r.off'))}
          max={31}
          onChange={(lateEvery) => onChange({ lateEvery })}
        />
        {v.lateEvery > 0 && (
          <NumberChoice
            label={t('hr.p.r.lateCut')}
            value={v.lateCutDays}
            presets={[0.5, 1]}
            unit={t('hr.p.r.dayCut')}
            step={0.5}
            max={5}
            onChange={(lateCutDays) => onChange({ lateCutDays })}
          />
        )}
      </Question>
      <Question label={mark('weeklyShortfall', t('hr.p.r.short'))} hint={t('hr.p.r.shortHint')}>
        <Chips
          label={t('hr.p.r.short')}
          value={v.weeklyShortfall}
          onChange={(weeklyShortfall) => onChange({ weeklyShortfall })}
          options={[
            { value: 'deduct', label: t('hr.p.r.shortDeduct') },
            { value: 'ignore', label: t('hr.p.r.shortIgnore') },
          ]}
        />
      </Question>
    </div>
  );
}
