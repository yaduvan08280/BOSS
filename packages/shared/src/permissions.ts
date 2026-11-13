/** Permission keys are `${module}.${action}`. Roles store a list of keys (or '*' for everything). */
export const MODULES = [
  'core',
  'org',
  'delegation',
  'checklist',
  'slip',
  'ticket',
  'ea',
  'fms',
  'docs',
  'hr',
  'ims',
  'crm',
  'notify',
  'ai',
  'integrations',
  'search',
  'records',
  'reports',
  // Phase 12, stage D: `franchise.view` is the franchise-oversight right (see franchises' work); `franchise.admin`
  // runs royalties, brand audits and exits.
  'franchise',
  // Phase 12M: parties, tax rates, bills, receipts and payments, day close, vouchers.
  'money',
  'hosp',
] as const;
export type ModuleKey = (typeof MODULES)[number];

export const ACTIONS = ['view', 'create', 'edit', 'approve', 'admin'] as const;
export type ActionKey = (typeof ACTIONS)[number];

export type PermissionKey = `${ModuleKey}.${ActionKey}` | '*';

export const BUILT_IN_ROLES = ['OWNER', 'ADMIN', 'HOD', 'SUPERVISOR', 'EA', 'MEMBER'] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

const all = (actions: readonly ActionKey[], modules: readonly ModuleKey[] = MODULES) =>
  modules.flatMap((m) => actions.map((a) => `${m}.${a}` as PermissionKey));

const work: ModuleKey[] = [
  'delegation',
  'checklist',
  'slip',
  'ticket',
  'fms',
  'docs',
  'hr',
  'ims',
  'crm',
  'search',
  'hosp',
];

/** People who run a team build and change their own reports; everyone may open the ones shared with them. */
const builds: PermissionKey[] = ['reports.view', 'reports.create', 'reports.edit'];

export const DEFAULT_ROLE_PERMISSIONS: Record<BuiltInRole, PermissionKey[]> = {
  OWNER: ['*'],
  ADMIN: all(['view', 'create', 'edit', 'approve', 'admin']),
  HOD: [...all(['view', 'create', 'edit', 'approve'], work), ...builds, 'org.view', 'ea.view', 'ai.view'],
  SUPERVISOR: [...all(['view', 'create', 'edit'], work), ...builds, 'org.view', 'ai.view'],
  EA: [...all(['view', 'create', 'edit'], [...work, 'ea']), ...builds, 'org.view', 'ai.view'],
  MEMBER: [...all(['view', 'create'], work), 'reports.view', 'org.view'],
};

/**
 * Modules added after companies were already running. A built-in role that holds nothing of such a module yet
 * (nobody has set it in the Roles matrix) is given the defaults above when the server starts.
 */
export const LATER_MODULES: ModuleKey[] = ['records', 'reports', 'franchise', 'money', 'hosp'];

export function hasPermission(granted: readonly string[], needed: PermissionKey): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true;
  const [mod] = needed.split('.');
  return granted.includes(`${mod}.admin`);
}

/** System Master is only for Owner/Admin. */
export function canOpenSystemMaster(granted: readonly string[]): boolean {
  return granted.includes('*') || granted.includes('core.admin');
}
