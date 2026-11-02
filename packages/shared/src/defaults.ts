import { z } from 'zod';

/** Per-company module settings (ModuleSetting.json), edited on the Business Engine flow designer page. */
export const delegationSettingsSchema = z.object({
  eaUserId: z.string().nullable(),
  acceptWithinMinutes: z.number().int().min(5).max(1440),
  verifyWithinMinutes: z.number().int().min(5).max(10080),
  reportsOpenOn: z.enum(['thisWeek', 'all']),
  doerMustAccept: z.boolean(),
  eaVerifies: z.boolean(),
  allowReopen: z.boolean(),
});
export type DelegationSettings = z.infer<typeof delegationSettingsSchema>;

export const checklistSettingsSchema = z.object({
  verifierUserId: z.string().nullable(),
  remindBeforeMinutes: z.number().int().min(0).max(1440),
  missedAfterHours: z.number().int().min(1).max(72),
  verifierStep: z.boolean(),
  photoVoiceProof: z.boolean(),
  tellOwnerAboutMisses: z.boolean(),
});
export type ChecklistSettings = z.infer<typeof checklistSettingsSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

export const slipSettingsSchema = z.object({
  receiverUserId: z.string().nullable(),
  approverUserId: z.string().nullable(),
  receiverForwardHours: z.number().int().min(1).max(168),
  /** Who answers for the slip getting closed in time. "none": nobody else — the raiser stays accountable. */
  accountability: z.enum(['none', 'receiver', 'approver']),
  approverDecideHours: z.number().int().min(1).max(168),
  delegateWithinHours: z.number().int().min(1).max(168),
  raiserCloseHours: z.number().int().min(1).max(336),
  solutionsRequired: z.number().int().min(1).max(3),
  receiverScreens: z.boolean(),
  approverStep: z.boolean(),
});
export type SlipSettings = z.infer<typeof slipSettingsSchema>;

export const ticketSettingsSchema = z.object({
  coordinatorUserId: z.string().nullable(),
  firstReplyHours: z.number().int().min(1).max(72),
  fixHours: z.number().int().min(1).max(720),
  escalationLevels: z.number().int().min(0).max(2),
  proofToResolve: z.boolean(),
  closeBy: z.enum(['raiser', 'auto24h']),
});
export type TicketSettings = z.infer<typeof ticketSettingsSchema>;

export const eaSettingsSchema = z.object({
  eaUserId: z.string().nullable(),
  weekStartsOn: z.number().int().min(1).max(7),
  weeklyPlanDay: z.number().int().min(1).max(7),
  waitingCap: z.number().int().min(1).max(50),
  dailyBriefAt: hhmm,
  dayStart: hhmm,
  dayEnd: hhmm,
  infoKeepDays: z.number().int().min(1).max(90),
  somedayReviewDays: z.number().int().min(1).max(90),
  delegationFollowUpDays: z.number().int().min(1).max(30),
  informationStage: z.boolean(),
  waitingStage: z.boolean(),
  missedDayToSomeday: z.boolean(),
});
export type EaSettings = z.infer<typeof eaSettingsSchema>;

export const MODULE_SETTINGS_SCHEMAS = {
  delegation: delegationSettingsSchema,
  checklist: checklistSettingsSchema,
  slip: slipSettingsSchema,
  ticket: ticketSettingsSchema,
  ea: eaSettingsSchema,
} as const;

export const MODULE_DEFAULTS = {
  delegation: {
    eaUserId: null,
    acceptWithinMinutes: 30,
    verifyWithinMinutes: 60,
    reportsOpenOn: 'thisWeek',
    doerMustAccept: true,
    eaVerifies: true,
    allowReopen: true,
  } satisfies DelegationSettings,
  checklist: {
    verifierUserId: null,
    remindBeforeMinutes: 30,
    missedAfterHours: 4,
    verifierStep: true,
    photoVoiceProof: true,
    tellOwnerAboutMisses: true,
  } satisfies ChecklistSettings,
  slip: {
    receiverUserId: null,
    approverUserId: null,
    receiverForwardHours: 4,
    accountability: 'none',
    approverDecideHours: 24,
    delegateWithinHours: 4,
    raiserCloseHours: 48,
    solutionsRequired: 3,
    receiverScreens: true,
    approverStep: true,
  } satisfies SlipSettings,
  ticket: {
    coordinatorUserId: null,
    firstReplyHours: 4,
    fixHours: 24,
    escalationLevels: 2,
    proofToResolve: true,
    closeBy: 'raiser',
  } satisfies TicketSettings,
  ea: {
    eaUserId: null,
    weekStartsOn: 1,
    weeklyPlanDay: 6,
    waitingCap: 6,
    dailyBriefAt: '08:30',
    dayStart: '08:00',
    dayEnd: '20:00',
    infoKeepDays: 7,
    somedayReviewDays: 7,
    delegationFollowUpDays: 2,
    informationStage: true,
    waitingStage: true,
    missedDayToSomeday: true,
  } satisfies EaSettings,
};
export type ModuleKeyWithSettings = keyof typeof MODULE_DEFAULTS;
export type ModuleSettings<K extends ModuleKeyWithSettings> = z.infer<(typeof MODULE_SETTINGS_SCHEMAS)[K]>;

/** Stored JSON merged over the defaults; unknown or invalid keys fall back to the default. */
export function readModuleSettings<K extends ModuleKeyWithSettings>(
  module: K,
  stored: unknown,
): ModuleSettings<K> {
  const schema = MODULE_SETTINGS_SCHEMAS[module].partial();
  const parsed = schema.safeParse(stored ?? {});
  return {
    ...MODULE_DEFAULTS[module],
    ...(parsed.success ? parsed.data : {}),
  } as ModuleSettings<K>;
}
