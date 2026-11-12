import type { Db, Tx } from '@mono/db';
import { readModuleSettings, type ModuleKeyWithSettings } from '@mono/shared';

/** The person keys of a settings object: the ones a branch may set for itself. */
export const personKeys = (settings: object) => Object.keys(settings).filter((k) => k.endsWith('UserId'));

/**
 * A module's flow-designer settings. With a branch, that branch's own people (phase 12: its slip receiver,
 * ticket coordinator, verifier …) stand in for the company's; times, rules and toggles are always the company's.
 */
export async function moduleSettings<K extends ModuleKeyWithSettings>(
  db: Db | Tx,
  companyId: string,
  module: K,
  branchId?: string | null,
) {
  const row = await db.moduleSetting.findFirst({ where: { companyId, module } });
  const settings = readModuleSettings(module, row?.json);
  if (!branchId) return settings;
  const own = await db.moduleBranchSetting.findFirst({ where: { companyId, module, branchId } });
  const people = (own?.json ?? {}) as Record<string, unknown>;
  const out = { ...settings } as Record<string, unknown>;
  for (const k of personKeys(settings)) if (typeof people[k] === 'string' && people[k]) out[k] = people[k];
  return out as typeof settings;
}
