import { ArrowDown, ArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HrRules } from '@mono/shared';
import { TimeInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Chips, NumberChoice, Question, YesNo } from './ui';

type Props = { rules: HrRules; set: (next: HrRules) => void };

export function StepBuddy({ rules, set }: Props) {
  const { t } = useTranslation();
  const b = rules.buddy;
  const up = (x: Partial<HrRules['buddy']>) => set({ ...rules, buddy: { ...b, ...x } });
  return (
    <>
      <Question label={t('hr.w.noBuddy')}>
        <Chips
          label={t('hr.w.noBuddy')}
          value={b.noBuddy}
          onChange={(v) => up({ noBuddy: v })}
          options={[
            { value: 'block', label: t('hr.w.noBuddyBlock') },
            { value: 'warn', label: t('hr.w.noBuddyWarn') },
            { value: 'off', label: t('hr.w.off') },
          ]}
        />
      </Question>
      <Question label={t('hr.w.needsBuddy')}>
        <Chips
          label={t('hr.w.needsBuddy')}
          value={b.needsBuddy}
          onChange={(v) => up({ needsBuddy: v })}
          options={[
            { value: 'any', label: t('hr.w.anyLeave') },
            { value: 'fullDay', label: t('hr.w.fullDayUp') },
            { value: 'days', label: t('hr.w.daysUp') },
          ]}
        />
        {b.needsBuddy === 'days' && (
          <NumberChoice
            label={t('hr.w.needsBuddy')}
            value={b.needsBuddyDays}
            presets={[2, 3, 5]}
            unit={t('hr.w.days')}
            min={1}
            max={30}
            onChange={(v) => up({ needsBuddyDays: v })}
          />
        )}
      </Question>
      <Question label={t('hr.w.otherDept')}>
        <YesNo
          label={t('hr.w.otherDept')}
          value={b.otherDepartment}
          onChange={(v) => up({ otherDepartment: v })}
        />
      </Question>
      <Question label={t('hr.w.maxCover')}>
        <NumberChoice
          label={t('hr.w.maxCover')}
          value={b.maxCover}
          presets={[1, 2, 3]}
          unit={t('hr.w.people')}
          min={1}
          max={10}
          onChange={(v) => up({ maxCover: v })}
        />
      </Question>
    </>
  );
}

export function StepAnswer({ rules, set }: Props) {
  const { t } = useTranslation();
  const a = rules.buddyAnswer;
  const up = (x: Partial<HrRules['buddyAnswer']>) => set({ ...rules, buddyAnswer: { ...a, ...x } });
  const move = (i: number, by: number) => {
    const next = [...a.order];
    const [x] = next.splice(i, 1);
    next.splice(i + by, 0, x!);
    up({ order: next });
  };
  return (
    <>
      <Question label={t('hr.w.order')} hint={t('hr.w.orderHint')}>
        <ol className="space-y-1.5">
          {a.order.map((s, i) => (
            <li key={s} className="flex items-center gap-2 rounded-control border bg-card px-3 py-2 text-sm">
              <span className="w-5 font-semibold">{i + 1}</span>
              <span className="flex-1">{t(`hr.w.source.${s}`)}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={i === 0}
                aria-label={t('hr.w.up')}
                onClick={() => move(i, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                disabled={i === a.order.length - 1}
                aria-label={t('hr.w.down')}
                onClick={() => move(i, 1)}
              >
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ol>
      </Question>
      <Question label={t('hr.w.answerWithin')}>
        <NumberChoice
          label={t('hr.w.answerWithin')}
          value={a.answerHours}
          presets={[2, 4, 8, 24]}
          unit="h"
          min={1}
          max={72}
          onChange={(v) => up({ answerHours: v })}
        />
      </Question>
      <Question label={t('hr.w.onReturn')}>
        <Chips
          label={t('hr.w.onReturn')}
          value={a.onReturn}
          onChange={(v) => up({ onReturn: v })}
          options={[
            { value: 'notStarted', label: t('hr.w.returnNotStarted') },
            { value: 'all', label: t('hr.w.returnAll') },
            { value: 'keep', label: t('hr.w.returnKeep') },
          ]}
        />
      </Question>
      <Question label={t('hr.w.absentConfirm')}>
        <NumberChoice
          label={t('hr.w.absentConfirm')}
          value={a.absentConfirmHours}
          presets={[1, 2, 4]}
          unit="h"
          min={1}
          max={24}
          onChange={(v) => up({ absentConfirmHours: v })}
        />
      </Question>
    </>
  );
}

export function StepAutopilot({ rules, set }: Props) {
  const { t } = useTranslation();
  const a = rules.autopilot;
  const up = (x: Partial<HrRules['autopilot']>) => set({ ...rules, autopilot: { ...a, ...x } });
  return (
    <>
      <Question label={t('hr.w.autoPick')}>
        <YesNo label={t('hr.w.autoPick')} value={a.autoPick} onChange={(v) => up({ autoPick: v })} />
      </Question>
      <Question label={t('hr.w.autoApprove')}>
        <YesNo
          label={t('hr.w.autoApprove')}
          value={a.autoApproveShort}
          onChange={(v) => up({ autoApproveShort: v })}
        />
      </Question>
      <Question label={t('hr.w.absentToBuddy')}>
        <YesNo
          label={t('hr.w.absentToBuddy')}
          value={a.absentToBuddy}
          onChange={(v) => up({ absentToBuddy: v })}
        />
      </Question>
      <Question label={t('hr.w.morning')} hint={t('hr.w.morningHint')}>
        <div className="flex flex-wrap items-center gap-3">
          <YesNo
            label={t('hr.w.morning')}
            value={a.morningReport}
            onChange={(v) => up({ morningReport: v })}
          />
          {a.morningReport && (
            <TimeInput
              value={a.morningReportAt}
              aria-label={t('hr.w.morningAt')}
              onChange={(v) => up({ morningReportAt: v })}
              className="w-28"
            />
          )}
        </div>
      </Question>
    </>
  );
}
