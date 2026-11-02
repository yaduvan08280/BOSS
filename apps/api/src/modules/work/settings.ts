import type { Db, Tx } from '@mono/db';
import { readModuleSettings, type ModuleKeyWithSettings } from '@mono/shared';

export async function moduleSettings<K extends ModuleKeyWithSettings>(
  db: Db | Tx,
  companyId: string,
  module: K,
) {
  const row = await db.moduleSetting.findFirst({ where: { companyId, module } });
  return readModuleSettings(module, row?.json);
}
