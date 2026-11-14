import { DEFAULT_ROLE_PERMISSIONS, type ActionKey, type ModuleKey, type PermissionKey } from '../permissions';
import type { RoleReach } from '../branches/schemas';

const keys = (modules: ModuleKey[], actions: ActionKey[]) =>
  modules.flatMap((m) => actions.map((a) => `${m}.${a}` as PermissionKey));

/** What everybody needs every day: their tasks, checklists, slips, tickets, process steps, papers, attendance and leave. */
export const EVERYDAY: PermissionKey[] = [
  ...keys(['delegation', 'checklist', 'slip', 'ticket', 'fms', 'hr'], ['view', 'create']),
  'docs.view',
  'search.view',
  'org.view',
];

export type AccessPlan = { reach: RoleReach; permissions: PermissionKey[] };

/**
 * MONO's recommended access for the built-in roles: staff see their own branch and their daily work only;
 * the modules of a trade (stock, sales, money, hospitality) come with the role that works in them.
 */
export const RECOMMENDED_BUILT_IN: Record<'ADMIN' | 'HOD' | 'SUPERVISOR' | 'EA' | 'MEMBER', AccessPlan> = {
  ADMIN: { reach: 'group', permissions: DEFAULT_ROLE_PERMISSIONS.ADMIN },
  HOD: { reach: 'branches', permissions: DEFAULT_ROLE_PERMISSIONS.HOD },
  SUPERVISOR: { reach: 'branches', permissions: DEFAULT_ROLE_PERMISSIONS.SUPERVISOR },
  EA: { reach: 'group', permissions: DEFAULT_ROLE_PERMISSIONS.EA },
  MEMBER: { reach: 'branches', permissions: EVERYDAY },
};

/**
 * Roles for the people who work in one module. They are made when missing, and a Member whose main department's
 * name says what they do moves to the matching one — so nobody loses the screens of their own job.
 */
export const RECOMMENDED_WORK_ROLES: {
  name: string;
  departments: RegExp;
  plan: AccessPlan;
}[] = [
  {
    name: 'Sales staff',
    departments: /sales|marketing|crm|business dev/i,
    plan: {
      reach: 'branches',
      permissions: [...EVERYDAY, ...keys(['crm'], ['view', 'create', 'edit']), 'reports.view'],
    },
  },
  {
    name: 'Store staff',
    departments: /store|stock|inventory|purchase|warehouse|dispatch|logistic/i,
    plan: {
      reach: 'branches',
      permissions: [...EVERYDAY, ...keys(['ims'], ['view', 'create', 'edit']), 'reports.view'],
    },
  },
  {
    name: 'Accounts staff',
    departments: /account|finance|billing/i,
    plan: {
      reach: 'entity',
      permissions: [
        ...EVERYDAY,
        ...keys(['money'], ['view', 'create', 'edit']),
        'crm.view',
        'ims.view',
        'reports.view',
      ],
    },
  },
];

/** Roles a hospitality pack brings: a Member of a matching department moves to the one the company has. */
export const RECOMMENDED_PACK_ROLES: { name: string; departments: RegExp }[] = [
  { name: 'Kitchen station', departments: /kitchen|chef|cook|bakery|tandoor/i },
  { name: 'Bartender', departments: /\bbar\b|bartend|beverage/i },
  { name: 'Housekeeping attendant', departments: /housekeep|laundry/i },
  { name: 'Front office', departments: /front (office|desk)|reception/i },
  { name: 'Reservations', departments: /reservation|booking/i },
  { name: 'Cashier', departments: /cash/i },
  { name: 'Steward / captain', departments: /service|steward|restaurant|f ?& ?b|food|floor|dining|banquet/i },
];

/** A role a company or a pack made: it keeps its rights; only how far it sees is narrowed (admins stay company-wide). */
export function recommendedReach(permissions: readonly string[]): RoleReach {
  return permissions.includes('*') || permissions.includes('core.admin') ? 'group' : 'branches';
}
