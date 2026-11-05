import {
  Bug,
  BadgeIndianRupee,
  Blocks,
  Boxes,
  Building2,
  CalendarCheck,
  CalendarOff,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  Contact,
  FileText,
  Funnel,
  GitBranch,
  Handshake,
  House,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LibraryBig,
  LifeBuoy,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Network,
  NotebookPen,
  Package,
  Palette,
  PhoneCall,
  Plug,
  Repeat,
  Route,
  ScanSearch,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Ticket,
  Target,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  Workflow,
  Scale,
} from 'lucide-react';
import { hasPermission, type PermissionKey } from '@mono/shared';

export type NavItem = {
  key: string;
  path: string;
  icon: LucideIcon;
  /** Phase in which the screen is built (CLAUDE.md §18). 0 = available now. */
  phase: number;
  /** Category chip on Home. */
  tag:
    | 'businessEngine'
    | 'systems'
    | 'hr'
    | 'inventory'
    | 'salesCrm'
    | 'masters'
    | 'workspace'
    | 'messaging'
    | 'setup';
  /** Shown only to people with this permission. */
  permission?: PermissionKey;
};

export type NavSection = { key: string; items: NavItem[] };

export const WORKSPACE_NAV: NavSection[] = [
  {
    key: 'workspace',
    items: [
      { key: 'home', path: '/', icon: House, phase: 0, tag: 'workspace' },
      { key: 'myWorkspace', path: '/workspace', icon: Inbox, phase: 0, tag: 'workspace' },
      { key: 'support', path: '/support', icon: LifeBuoy, phase: 0, tag: 'workspace' },
    ],
  },
  {
    key: 'businessEngine',
    items: [
      { key: 'delegation', path: '/delegation', icon: ListTodo, phase: 0, tag: 'businessEngine' },
      { key: 'checklists', path: '/checklists', icon: ListChecks, phase: 0, tag: 'businessEngine' },
      { key: 'helpSlips', path: '/help-slips', icon: NotebookPen, phase: 0, tag: 'businessEngine' },
      { key: 'helpTickets', path: '/help-tickets', icon: Ticket, phase: 0, tag: 'businessEngine' },
      { key: 'ea', path: '/ea', icon: ClipboardList, phase: 0, tag: 'businessEngine' },
      { key: 'weeklyMis', path: '/mis', icon: ChartColumn, phase: 0, tag: 'businessEngine' },
    ],
  },
  {
    key: 'systems',
    items: [
      { key: 'myFmsSteps', path: '/fms/my-steps', icon: Route, phase: 0, tag: 'systems' },
      { key: 'liveFms', path: '/fms/live', icon: Workflow, phase: 0, tag: 'systems' },
      { key: 'documents', path: '/documents', icon: FileText, phase: 0, tag: 'systems' },
      { key: 'fmsBuilder', path: '/fms/builder', icon: GitBranch, phase: 0, tag: 'systems' },
    ],
  },
  {
    key: 'hr',
    items: [
      { key: 'attendance', path: '/hr/attendance', icon: CalendarCheck, phase: 0, tag: 'hr' },
      { key: 'leave', path: '/hr/leave', icon: CalendarOff, phase: 0, tag: 'hr' },
      { key: 'coverBoard', path: '/hr/cover', icon: Handshake, phase: 0, tag: 'hr' },
      {
        key: 'payroll',
        path: '/hr/payroll',
        icon: BadgeIndianRupee,
        phase: 0,
        tag: 'hr',
        permission: 'hr.admin',
      },
    ],
  },
  {
    key: 'inventory',
    items: [
      { key: 'stock', path: '/ims/stock', icon: Package, phase: 0, tag: 'inventory' },
      { key: 'purchase', path: '/ims/purchase', icon: ShoppingCart, phase: 0, tag: 'inventory' },
      { key: 'maxReview', path: '/ims/max-review', icon: Scale, phase: 0, tag: 'inventory' },
      { key: 'stockAudit', path: '/ims/audit', icon: ScanSearch, phase: 0, tag: 'inventory' },
    ],
  },
  {
    key: 'salesCrm',
    items: [
      { key: 'crmDashboard', path: '/crm', icon: LayoutDashboard, phase: 0, tag: 'salesCrm' },
      { key: 'crmPlan', path: '/crm/setup', icon: Target, phase: 0, tag: 'salesCrm' },
      { key: 'customers', path: '/crm/customers', icon: Contact, phase: 0, tag: 'salesCrm' },
      { key: 'scot', path: '/crm/scot', icon: Repeat, phase: 0, tag: 'salesCrm' },
      { key: 'calls', path: '/crm/calls', icon: PhoneCall, phase: 0, tag: 'salesCrm' },
      { key: 'crmOrders', path: '/crm/orders', icon: Truck, phase: 0, tag: 'salesCrm' },
      { key: 'collections', path: '/crm/collections', icon: BadgeIndianRupee, phase: 0, tag: 'salesCrm' },
      { key: 'nbd', path: '/crm/nbd', icon: Funnel, phase: 0, tag: 'salesCrm' },
      { key: 'meca', path: '/crm/meca', icon: TrendingUp, phase: 0, tag: 'salesCrm' },
    ],
  },
  {
    key: 'masters',
    items: [
      { key: 'myMasters', path: '/masters', icon: Boxes, phase: 0, tag: 'masters' },
      { key: 'masterLibrary', path: '/masters/library', icon: LibraryBig, phase: 0, tag: 'masters' },
      { key: 'buildMaster', path: '/masters/build', icon: Sparkles, phase: 0, tag: 'masters' },
    ],
  },
];

export const SYSTEM_NAV: NavSection[] = [
  {
    key: 'setup',
    items: [
      { key: 'companySetup', path: '/system/company', icon: Building2, phase: 0, tag: 'setup' },
      { key: 'departments', path: '/system/departments', icon: Blocks, phase: 0, tag: 'setup' },
      { key: 'users', path: '/system/users', icon: Users, phase: 0, tag: 'setup' },
      { key: 'roles', path: '/system/roles', icon: ShieldCheck, phase: 0, tag: 'setup' },
      { key: 'orgChart', path: '/system/org-chart', icon: Network, phase: 0, tag: 'setup' },
      { key: 'integration', path: '/system/integration', icon: Plug, phase: 0, tag: 'messaging' },
      { key: 'inventorySetup', path: '/system/inventory', icon: Package, phase: 0, tag: 'setup' },
      { key: 'crmSetup', path: '/system/crm', icon: ClipboardCheck, phase: 0, tag: 'setup' },
      { key: 'apiKeys', path: '/system/api-keys', icon: KeyRound, phase: 0, tag: 'setup' },
      { key: 'hrRules', path: '/system/hr-rules', icon: UserCog, phase: 0, tag: 'setup' },
      { key: 'businessDetails', path: '/system/business-details', icon: Sparkles, phase: 0, tag: 'setup' },
      { key: 'appearance', path: '/system/appearance', icon: Palette, phase: 0, tag: 'setup' },
      { key: 'errors', path: '/system/errors', icon: Bug, phase: 0, tag: 'setup' },
      { key: 'engineDesigner', path: '/system/engine', icon: Workflow, phase: 0, tag: 'setup' },
      { key: 'uiKit', path: '/dev/ui', icon: Palette, phase: 0, tag: 'setup' },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = [...WORKSPACE_NAV, ...SYSTEM_NAV].flatMap((s) => s.items);

export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_ITEMS.filter((i) =>
    i.path === '/' ? pathname === '/' : pathname === i.path || pathname.startsWith(`${i.path}/`),
  ).sort((a, b) => b.path.length - a.path.length)[0];
}

/** Screens behind a permission (Payroll) are left out of menus, Home and search for everyone else. */
export const navAllowed = (item: NavItem, permissions: readonly string[]) =>
  !item.permission || hasPermission(permissions, item.permission);
