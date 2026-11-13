import type { Db } from '@mono/db';
import { hospRulesSchema } from '@mono/shared';
import { z } from 'zod';
import { writeAudit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import type { Actor } from '../work/actor';
import { ctxOf, hospOf, need } from './access';

/** Switching hospitality on for the company, and its rules: discount types and limits, no-charge reasons, day close. */
export const hospSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  rules: z.record(z.string(), z.unknown()).optional(),
});

export async function readHosp(db: Db, actor: Actor) {
  const h = await hospOf(db, actor.companyId);
  return { ...h, canAdmin: actor.permissions.includes('*') || actor.permissions.includes('hosp.admin') };
}

export async function saveHosp(db: Db, actor: Actor, input: z.input<typeof hospSettingsSchema>) {
  need(actor, 'hosp.admin', 'Only hospitality admins change this set-up');
  const patch = hospSettingsSchema.parse(input);
  const now = await hospOf(db, actor.companyId);
  // Only the parts sent change; the rest of the rules stay as they are.
  const rules = hospRulesSchema.parse({
    ...now.rules,
    ...(patch.rules ?? {}),
    dayClose: { ...now.rules.dayClose, ...((patch.rules?.dayClose as object | undefined) ?? {}) },
  });
  const keys = rules.discounts.map((d) => d.key);
  if (new Set(keys).size !== keys.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'Two discount types have the same key');
  const roleIds = rules.limits.map((l) => l.roleId);
  if (new Set(roleIds).size !== roleIds.length)
    throw new AppError(400, 'VALIDATION_FAILED', 'A role has two limits');
  if (
    roleIds.length &&
    (await db.role.count({ where: { companyId: actor.companyId, id: { in: roleIds } } })) !== roleIds.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'A limit is for a role that does not exist');
  const people = [...new Set([...rules.approverIds, ...rules.dayClose.closerIds])];
  if (
    people.length &&
    (await db.user.count({
      where: { companyId: actor.companyId, id: { in: people }, deletedAt: null, status: 'ACTIVE' },
    })) !== people.length
  )
    throw new AppError(400, 'VALIDATION_FAILED', 'Someone chosen is not an active person in the company');
  const enabled = patch.enabled ?? now.enabled;
  await db.$transaction(async (tx) => {
    await tx.hospSettings.upsert({
      where: { companyId: actor.companyId },
      create: { companyId: actor.companyId, enabled, rules, updatedById: actor.userId },
      update: { enabled, rules, updatedById: actor.userId },
    });
    await writeAudit(tx, ctxOf(actor), {
      action: 'hosp.settings_saved',
      entityType: 'hosp_settings',
      entityId: actor.companyId,
      before: now,
      after: { enabled, rules },
    });
  });
  return readHosp(db, actor);
}
