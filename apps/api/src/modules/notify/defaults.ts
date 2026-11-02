import type { Tx } from '@mono/db';
import {
  DEFAULT_REMINDER_PATTERNS,
  defaultRules,
  defaultTemplates,
  type TemplateChannel,
} from '@mono/shared';

/** Add any built-in templates the company doesn't have yet (by code + language). Returns how many were added. */
export async function loadDefaultTemplates(tx: Tx, companyId: string, channels?: TemplateChannel[]) {
  const have = new Set(
    (await tx.template.findMany({ where: { companyId }, select: { code: true, language: true } })).map(
      (t) => `${t.code}:${t.language}`,
    ),
  );
  const missing = defaultTemplates(channels).filter((t) => !have.has(`${t.code}:${t.language}`));
  if (missing.length)
    await tx.template.createMany({ data: missing.map((t) => ({ ...t, companyId, isDefault: true })) });
  return missing.length;
}

/** Add a default rule for every event that has no rule yet. */
export async function loadDefaultRules(tx: Tx, companyId: string) {
  const have = new Set(
    (
      await tx.notificationRule.findMany({ where: { companyId, deletedAt: null }, select: { event: true } })
    ).map((r) => r.event),
  );
  const missing = defaultRules().filter((r) => !have.has(r.event));
  if (missing.length)
    await tx.notificationRule.createMany({
      data: missing.map((r) => ({ ...r, companyId, isDefault: true })),
    });
  return missing.length;
}

export async function loadDefaultReminderPatterns(tx: Tx, companyId: string) {
  if (await tx.reminderPattern.count({ where: { companyId, deletedAt: null } })) return 0;
  await tx.reminderPattern.createMany({ data: DEFAULT_REMINDER_PATTERNS.map((p) => ({ ...p, companyId })) });
  return DEFAULT_REMINDER_PATTERNS.length;
}

/** Everything a new company needs to start sending: templates, rules and reminder patterns. */
export async function ensureNotifyDefaults(tx: Tx, companyId: string) {
  return {
    templates: await loadDefaultTemplates(tx, companyId),
    rules: await loadDefaultRules(tx, companyId),
    reminders: await loadDefaultReminderPatterns(tx, companyId),
  };
}
