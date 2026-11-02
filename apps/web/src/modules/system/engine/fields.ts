import type { TFunction } from 'i18next';
import type { EngineModule } from '@mono/shared';

/** What the "Set up your flow" panel shows for each module: 1) who, 1B) times and rules, 2) steps on/off. */
export type SettingField =
  | { key: string; kind: 'person' }
  | {
      key: string;
      kind: 'select';
      options: (string | number)[];
      unit?: 'min' | 'h' | 'd' | 'weekday' | 'opt' | 'n';
    }
  | { key: string; kind: 'toggle' };

const sel = (
  key: string,
  options: (string | number)[],
  unit?: 'min' | 'h' | 'd' | 'weekday' | 'opt' | 'n',
): SettingField => ({
  key,
  kind: 'select',
  options,
  unit,
});

export const ENGINE_FIELDS: Record<
  EngineModule,
  { who: SettingField[]; times: SettingField[]; steps: SettingField[] }
> = {
  checklist: {
    who: [{ key: 'verifierUserId', kind: 'person' }],
    times: [
      sel('remindBeforeMinutes', [0, 15, 30, 60, 120], 'min'),
      sel('missedAfterHours', [1, 2, 4, 8, 12, 24], 'h'),
    ],
    steps: [
      { key: 'verifierStep', kind: 'toggle' },
      { key: 'photoVoiceProof', kind: 'toggle' },
      { key: 'tellOwnerAboutMisses', kind: 'toggle' },
    ],
  },
  delegation: {
    who: [{ key: 'eaUserId', kind: 'person' }],
    times: [
      sel('acceptWithinMinutes', [15, 30, 60, 120, 240], 'min'),
      sel('verifyWithinMinutes', [30, 60, 120, 240, 480, 1440], 'min'),
      sel('reportsOpenOn', ['thisWeek', 'all'], 'opt'),
    ],
    steps: [
      { key: 'doerMustAccept', kind: 'toggle' },
      { key: 'eaVerifies', kind: 'toggle' },
      { key: 'allowReopen', kind: 'toggle' },
    ],
  },
  slip: {
    who: [
      { key: 'receiverUserId', kind: 'person' },
      { key: 'approverUserId', kind: 'person' },
    ],
    times: [
      sel('receiverForwardHours', [1, 2, 4, 8, 24], 'h'),
      sel('accountability', ['none', 'receiver', 'approver'], 'opt'),
      sel('approverDecideHours', [4, 8, 24, 48, 72], 'h'),
      sel('delegateWithinHours', [1, 2, 4, 8, 24], 'h'),
      sel('raiserCloseHours', [24, 48, 72, 168], 'h'),
      sel('solutionsRequired', [1, 2, 3], 'n'),
    ],
    steps: [
      { key: 'receiverScreens', kind: 'toggle' },
      { key: 'approverStep', kind: 'toggle' },
    ],
  },
  ticket: {
    who: [{ key: 'coordinatorUserId', kind: 'person' }],
    times: [
      sel('firstReplyHours', [1, 2, 4, 8, 24], 'h'),
      sel('fixHours', [4, 8, 24, 48, 72, 168], 'h'),
      sel('escalationLevels', [0, 1, 2], 'opt'),
      sel('closeBy', ['raiser', 'auto24h'], 'opt'),
    ],
    steps: [{ key: 'proofToResolve', kind: 'toggle' }],
  },
  ea: {
    who: [{ key: 'eaUserId', kind: 'person' }],
    times: [
      sel('weekStartsOn', [1, 6, 7], 'weekday'),
      sel('weeklyPlanDay', [5, 6, 7], 'weekday'),
      sel('waitingCap', [3, 4, 6, 8, 10], 'n'),
      sel('dailyBriefAt', ['07:30', '08:00', '08:30', '09:00', '09:30']),
      sel('dayStart', ['07:00', '08:00', '09:00', '10:00']),
      sel('dayEnd', ['18:00', '19:00', '20:00', '21:00']),
      sel('infoKeepDays', [3, 7, 14, 30], 'd'),
      sel('somedayReviewDays', [7, 14, 30], 'd'),
      sel('delegationFollowUpDays', [1, 2, 3, 5], 'd'),
    ],
    steps: [
      { key: 'informationStage', kind: 'toggle' },
      { key: 'waitingStage', kind: 'toggle' },
      { key: 'missedDayToSomeday', kind: 'toggle' },
    ],
  },
};

export function optionLabel(t: TFunction, f: Extract<SettingField, { kind: 'select' }>, v: string | number) {
  switch (f.unit) {
    case 'min':
      return Number(v) === 0
        ? t('engine.u.atDue')
        : Number(v) < 60
          ? t('engine.u.min', { n: v })
          : Number(v) % 1440 === 0
            ? t('engine.u.d', { count: Number(v) / 1440 })
            : t('engine.u.h', { count: Number(v) / 60 });
    case 'h':
      return Number(v) % 24 === 0
        ? t('engine.u.d', { count: Number(v) / 24 })
        : t('engine.u.h', { count: Number(v) });
    case 'd':
      return t('engine.u.d', { count: Number(v) });
    case 'weekday':
      return t(`ea.dayLong.${v}`);
    case 'opt':
      return t(`engine.opt.${f.key}.${v}`);
    default:
      return String(v);
  }
}

/** Status / action names in the chart, from each module's own words. */
export function nodeLabel(t: TFunction, module: EngineModule, kind: string, key: string) {
  if (kind === 'start' || kind === 'action' || kind === 'auto') return t(`engine.act.${key}`);
  if (key === 'ESCALATED') return t('engine.escalated');
  const ns = {
    delegation: 'task.status',
    checklist: 'chk.status',
    slip: 'slip.status',
    ticket: 'ticket.status',
    ea: 'ea.stage',
  }[module];
  return t(`${ns}.${key}`);
}
