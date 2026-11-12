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
];

export const DEFAULT_ROLE_PERMISSIONS: Record<BuiltInRole, PermissionKey[]> = {
  OWNER: ['*'],
  ADMIN: all(['view', 'create', 'edit', 'approve', 'admin']),
  HOD: [...all(['view', 'create', 'edit', 'approve'], work), 'org.view', 'ea.view', 'ai.view'],
  SUPERVISOR: [...all(['view', 'create', 'edit'], work), 'org.view', 'ai.view'],
  EA: [...all(['view', 'create', 'edit'], [...work, 'ea']), 'org.view', 'ai.view'],
  MEMBER: [...all(['view', 'create'], work), 'org.view'],
};

export function hasPermission(granted: readonly string[], needed: PermissionKey): boolean {
  if (granted.includes('*') || granted.includes(needed)) return true;
  const [mod] = needed.split('.');
  return granted.includes(`${mod}.admin`);
}

/** System Master is only for Owner/Admin. */
export function canOpenSystemMaster(granted: readonly string[]): boolean {
  return granted.includes('*') || granted.includes('core.admin');
}
