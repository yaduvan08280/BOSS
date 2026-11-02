import { z } from 'zod';

/** Per-company module settings (ModuleSetting.json). The Business Engine flow designer edits these in phase 4. */
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
};
export type ModuleKeyWithSettings = keyof typeof MODULE_DEFAULTS;

/** Stored JSON merged over the defaults; unknown or invalid keys fall back to the default. */
export function readModuleSettings<K extends ModuleKeyWithSettings>(
  module: K,
  stored: unknown,
): (typeof MODULE_DEFAULTS)[K] {
  const schema = (module === 'delegation' ? delegationSettingsSchema : checklistSettingsSchema).partial();
  const parsed = schema.safeParse(stored ?? {});
  return {
    ...MODULE_DEFAULTS[module],
    ...(parsed.success ? parsed.data : {}),
  } as (typeof MODULE_DEFAULTS)[K];
}
