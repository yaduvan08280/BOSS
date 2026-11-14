import { Check, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HrRules } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useUsers } from '@/modules/system/api';
import { hm, hrApi, useHrMutation, useHrRules } from './api';
import { StepAnswer, StepAutopilot, StepBuddy } from './BuddySteps';
import { StepLate, StepLeave, StepPunches } from './RulesSteps';

const STEPS = ['late', 'punches', 'leave', 'buddy', 'answer', 'autopilot', 'check'] as const;

/** System Master → HR rules: the 7-step wizard (CLAUDE.md §9.1). */
export function RulesWizard() {
  const q = useHrRules();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return <Wizard key={JSON.stringify(q.data.rules)} saved={q.data.rules} />;
}

function Wizard({ saved }: { saved: HrRules }) {
  const { t } = useTranslation();
  const [rules, setRules] = useState(saved);
  const [step, setStep] = useState(0);
  const save = useHrMutation(
    () => hrApi.saveRules(rules),
    () => t('hr.w.saved'),
  );
  const key = STEPS[step]!;
  const props = { rules, set: setRules };
  const body = {
    late: <StepLate {...props} />,
    punches: <StepPunches {...props} />,
    leave: <StepLeave {...props} />,
    buddy: <StepBuddy {...props} />,
    answer: <StepAnswer {...props} />,
    autopilot: <StepAutopilot {...props} />,
    check: <Summary rules={rules} go={setStep} />,
  }[key];

  return (
    <div className="space-y-4">
      <ol
        className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0"
        aria-label={t('hr.w.steps')}
      >
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={i === step ? 'step' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium whitespace-nowrap',
                i === step
                  ? 'border-ink bg-ink text-ink-foreground'
                  : i < step
                    ? 'bg-muted'
                    : 'bg-card text-muted-foreground',
              )}
            >
              <span className="tabular-nums">{i + 1}</span> {t(`hr.w.step.${s}`)}
            </button>
          </li>
        ))}
      </ol>
      <Card>
        <CardHeader>
          <CardTitle>
            {step + 1}. {t(`hr.w.step.${key}`)}
          </CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
          {t('hr.w.back')}
        </Button>
        {key === 'check' ? (
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />} {t('hr.w.save')}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => setStep(step + 1)}>
            {t('hr.w.next')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Step 7: every answer, grouped, each with a way back to change it. */
function Summary({ rules, go }: { rules: HrRules; go: (step: number) => void }) {
  const { t } = useTranslation();
  const users = useUsers();
  const name = (id?: string | null) =>
    id ? (users.data?.find((u) => u.id === id)?.name ?? '?') : t('hr.w.nobody');
  const yn = (b: boolean) => (b ? t('common.yes') : t('common.no'));
  const groups: { title: string; step: number; lines: [string, string][] }[] = [
    {
      title: t('hr.w.groupAttendance'),
      step: 0,
      lines: [
        [t('hr.w.grace'), `${rules.late.graceMinutes} min`],
        [t('hr.w.halfDayAfter'), hm(rules.late.halfDayAfterMinutes)],
        [t('hr.w.fullDay'), `${rules.late.fullDayHours} h`],
        [
          t('hr.w.missedOut'),
          rules.late.missedPunchOut === 'halfDay' ? t('hr.w.missedHalf') : t('hr.w.missedShiftEnd'),
        ],
        [t('hr.w.away'), t(`hr.w.${rules.punches.awayFromOffice}`)],
        [t('hr.w.noLocation'), t(`hr.w.${rules.punches.noLocation}`)],
        [t('hr.w.selfie'), yn(rules.punches.selfie)],
        [t('hr.w.corrections'), String(rules.punches.correctionsPerMonth)],
        [
          t('hr.w.overtime'),
          rules.punches.overtime
            ? `${t('common.yes')} · ${rules.punches.overtimeAfterMinutes} min`
            : t('common.no'),
        ],
        [t('hr.w.overrides'), String(rules.overrides.filter((o) => o.id).length)],
      ],
    },
    {
      title: t('hr.w.groupLeave'),
      step: 2,
      lines: [
        [t('hr.w.yearStart'), rules.leave.yearStartMonth === 4 ? t('hr.w.april') : t('hr.w.january')],
        [t('hr.w.compOff'), `${rules.leave.compOffValidDays} ${t('hr.w.days')}`],
        [t('hr.w.hrPerson'), name(rules.leave.hrUserId)],
        [t('hr.w.notice'), `${rules.leave.noticeDays} ${t('hr.w.days')}`],
      ],
    },
    {
      title: t('hr.w.groupBuddy'),
      step: 3,
      lines: [
        [
          t('hr.w.noBuddy'),
          t(
            `hr.w.${rules.buddy.noBuddy === 'off' ? 'off' : rules.buddy.noBuddy === 'block' ? 'noBuddyBlock' : 'noBuddyWarn'}`,
          ),
        ],
        [
          t('hr.w.needsBuddy'),
          rules.buddy.needsBuddy === 'days'
            ? `${t('hr.w.daysUp')} (${rules.buddy.needsBuddyDays})`
            : t(`hr.w.${rules.buddy.needsBuddy === 'any' ? 'anyLeave' : 'fullDayUp'}`),
        ],
        [t('hr.w.otherDept'), yn(rules.buddy.otherDepartment)],
        [t('hrBranch.otherBranch'), yn(rules.buddy.otherBranch)],
        [t('hr.w.maxCover'), String(rules.buddy.maxCover)],
        [t('hr.w.order'), rules.buddyAnswer.order.map((s) => t(`hr.w.source.${s}`)).join(' → ')],
        [t('hr.w.answerWithin'), `${rules.buddyAnswer.answerHours} h`],
        [
          t('hr.w.onReturn'),
          t(
            `hr.w.return${rules.buddyAnswer.onReturn === 'notStarted' ? 'NotStarted' : rules.buddyAnswer.onReturn === 'all' ? 'All' : 'Keep'}`,
          ),
        ],
        [t('hr.w.absentConfirm'), `${rules.buddyAnswer.absentConfirmHours} h`],
      ],
    },
    {
      title: t('hr.w.groupAutopilot'),
      step: 5,
      lines: [
        [t('hr.w.autoPick'), yn(rules.autopilot.autoPick)],
        [t('hr.w.autoApprove'), yn(rules.autopilot.autoApproveShort)],
        [t('hr.w.absentToBuddy'), yn(rules.autopilot.absentToBuddy)],
        [
          t('hr.w.morning'),
          rules.autopilot.morningReport
            ? `${t('common.yes')} · ${rules.autopilot.morningReportAt}`
            : t('common.no'),
        ],
      ],
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {groups.map((g) => (
        <section key={g.title} className="rounded-control border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{g.title}</h3>
            <Button size="sm" variant="ghost" onClick={() => go(g.step)}>
              {t('hr.w.change')}
            </Button>
          </div>
          <dl className="space-y-1 text-sm">
            {g.lines.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
