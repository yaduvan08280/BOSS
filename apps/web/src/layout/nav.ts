import {
  Bug,
  BadgeIndianRupee,
  Store,
  ConciergeBell,
  UtensilsCrossed,
  Tags,
  Trash2,
  PackageCheck,
  ChefHat,
  Warehouse,
  Banknote,
  Calculator,
  HandCoins,
  ReceiptText,
  Blocks,
  Boxes,
  Building2,
  GitFork,
  Trophy,
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
  BarChart3,
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
  CalendarClock,
  BedDouble,
  CalendarDays,
  Moon,
  PartyPopper,
  Wine,
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
  /** Shown only when the company has switched this module on. */
  needs?: 'hospitality';
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
      {
        key: 'reports',
        path: '/reports',
        icon: ChartColumn,
        phase: 0,
        tag: 'systems',
        permission: 'reports.view',
      },
      {
        key: 'outlets',
        path: '/outlets',
        icon: Trophy,
        phase: 0,
        tag: 'systems',
        permission: 'reports.view',
      },
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
      {
        key: 'stockLocations',
        path: '/ims/locations',
        icon: Warehouse,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockTransfers',
        path: '/ims/transfers',
        icon: Truck,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockKitchen',
        path: '/ims/kitchen',
        icon: ChefHat,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockReceipts',
        path: '/ims/receipts',
        icon: PackageCheck,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockWastage',
        path: '/ims/wastage',
        icon: Trash2,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockCounts',
        path: '/ims/counts',
        icon: ClipboardList,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
      {
        key: 'stockPrices',
        path: '/ims/prices',
        icon: Tags,
        phase: 0,
        tag: 'inventory',
        permission: 'ims.view',
      },
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
    key: 'money',
    items: [
      {
        key: 'moneyBills',
        path: '/money/bills',
        icon: ReceiptText,
        phase: 0,
        tag: 'systems',
        permission: 'money.view',
      },
      {
        key: 'moneyParties',
        path: '/money/parties',
        icon: Contact,
        phase: 0,
        tag: 'systems',
        permission: 'money.view',
      },
      {
        key: 'moneyOwed',
        path: '/money/owed',
        icon: HandCoins,
        phase: 0,
        tag: 'systems',
        permission: 'money.view',
      },
      {
        key: 'moneyDayClose',
        path: '/money/day-close',
        icon: Banknote,
        phase: 0,
        tag: 'systems',
        permission: 'money.view',
      },
      {
        key: 'moneySetup',
        path: '/money/setup',
        icon: Calculator,
        phase: 0,
        tag: 'systems',
        permission: 'money.admin',
      },
    ],
  },
  {
    key: 'hospitality',
    items: [
      {
        key: 'pos',
        path: '/hosp/pos',
        icon: Store,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'kds',
        path: '/hosp/kds',
        icon: ChefHat,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'reservations',
        path: '/hosp/reservations',
        icon: CalendarClock,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'guests',
        path: '/hosp/guests',
        icon: Contact,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hotelDesk',
        path: '/hotel/desk',
        icon: BedDouble,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hotelTape',
        path: '/hotel/calendar',
        icon: CalendarDays,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hotelHk',
        path: '/hotel/housekeeping',
        icon: Sparkles,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hotelAudit',
        path: '/hotel/audit',
        icon: Moon,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hotelRates',
        path: '/hotel/rates',
        icon: Tags,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'banquets',
        path: '/hosp/banquets',
        icon: PartyPopper,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'barRegister',
        path: '/hosp/bar',
        icon: Wine,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'compliance',
        path: '/hosp/compliance',
        icon: ShieldCheck,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hospReports',
        path: '/hosp/reports',
        icon: BarChart3,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'posDay',
        path: '/hosp/day',
        icon: ReceiptText,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
      {
        key: 'hospMenu',
        path: '/hosp/menu',
        icon: UtensilsCrossed,
        phase: 0,
        tag: 'systems',
        permission: 'hosp.view',
        needs: 'hospitality',
      },
    ],
  },
  {
    key: 'masters',
    items: [
      { key: 'myMasters', path: '/masters', icon: Boxes, phase: 0, tag: 'masters' },
      { key: 'masterLibrary', path: '/masters/library', icon: LibraryBig, phase: 0, tag: 'masters' },
      {
        key: 'valueLists',
        path: '/masters/lists',
        icon: ListChecks,
        phase: 0,
        tag: 'masters',
        permission: 'core.edit',
      },
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
      { key: 'groupBranches', path: '/system/branches', icon: GitFork, phase: 0, tag: 'setup' },
      { key: 'integration', path: '/system/integration', icon: Plug, phase: 0, tag: 'messaging' },
      { key: 'inventorySetup', path: '/system/inventory', icon: Package, phase: 0, tag: 'setup' },
      { key: 'hospitalitySetup', path: '/system/hospitality', icon: ConciergeBell, phase: 0, tag: 'setup' },
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
export const navAllowed = (
  item: NavItem,
  permissions: readonly string[],
  company?: { hospitality?: boolean },
) =>
  (!item.permission || hasPermission(permissions, item.permission)) &&
  (!item.needs || company?.[item.needs] === true);
