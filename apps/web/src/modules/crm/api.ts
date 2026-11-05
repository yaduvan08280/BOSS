import { useQuery } from '@tanstack/react-query';
import {
  formatINR,
  type AutoTag,
  type CrmConfig,
  type LeadStatus,
  type PlanInput,
  type PlanStatus,
  type PlanView,
  type Seat,
  type SetupPage,
} from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type PlanData = {
  fy: number;
  fyStart: string;
  today: string;
  status: PlanStatus;
  saved: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  input: PlanInput;
  view: PlanView;
  seats: {
    crr: number;
    nbd: number;
    owner: number;
    rows: { seat: Seat; userId: string | null; name: string | null; year: number; months: number[] }[];
    warnings: { code: string; seat?: Seat }[];
  };
  holidays: string[];
  workingWeekdays: number[];
  canEdit: boolean;
  canApprove: boolean;
  config: CrmConfig;
};
export type Progress = {
  pages: { page: SetupPage; done: boolean }[];
  done: number;
  of: number;
  afterOrderFlowId: string | null;
  config: CrmConfig;
};
export type Scot = {
  onScot: boolean;
  orders: number;
  averageOrder: string;
  everyDays: number | null;
  usualDay: number | null;
  rhythm: 'weekly' | 'fortnightly' | 'monthly' | 'everyN' | null;
  lastOrder: string | null;
  nextDue: string | null;
  callOn: string | null;
  callsPerMonth: number | null;
  topItems: string[];
};
export type CustomerRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  mobile: string | null;
  email: string | null;
  segment: string | null;
  handledById: string | null;
  handledBy: string | null;
  creditDays: number;
  ownerCustomer: boolean;
  sales12: string;
  gp12: string;
  marginPct: number | null;
  gpRank?: number | null;
  orders12: number;
  lastOrder: string | null;
  receivable: string;
  overdue: string;
  autoTags: AutoTag[];
  tags: string[];
  scot: Scot;
  fields: Record<string, unknown>;
};
export type CallRow = {
  id: string;
  kind: 'scot' | 'winback';
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  result: string | null;
  dueOn: string;
  lateDays: number;
  sc: string | null;
  customer: { id: string; name: string; city: string | null; mobile: string | null; creditDays: number };
  averageOrder: string;
  everyDays: number | null;
  lastOrder: string | null;
  nextDue: string | null;
  topItems: string[];
  tags: AutoTag[];
};
export type OrderCard = {
  id: string;
  number: string;
  customer: string;
  city: string | null;
  amount: string;
  orderDate: string;
  promisedOn: string | null;
  dueOn: string;
  recordId: string | null;
  step: {
    id: string;
    key: string;
    name: string;
    plannedAt: string | null;
    doer: string | null;
    late: boolean;
  } | null;
};
export type LeadCard = {
  id: string;
  number: string;
  name: string;
  company: string | null;
  mobile: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  requirement: string | null;
  value: string;
  buyWhen: string | null;
  status: LeadStatus;
  stage: string | null;
  daysInStage: number;
  plannedDays: number | null;
  stuck: boolean;
  nextAction: string | null;
  nextActionOn: string | null;
  noNext: boolean;
  ownerId: string | null;
  owner: string | null;
  createdAt: string;
};

const q = <T>(key: unknown[], url: string | null) =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useQuery({ queryKey: ['crm', ...key], queryFn: () => api<T>(url!), retry: false, enabled: Boolean(url) });

export const usePlan = (fy?: number) =>
  q<PlanData>(['plan', fy ?? 'now'], `/api/crm/plan${fy ? `?fy=${fy}` : ''}`);
export const useProgress = () => q<Progress>(['setup'], '/api/crm/setup');
export const useCustomers = () =>
  q<{
    customers: CustomerRow[];
    tiles: {
      customers: number;
      top20GpSharePct: number;
      withOwner: string;
      sleeping: number;
      lost: number;
      vampires: number;
    };
  }>(['customers'], '/api/crm/customers');
export const useCustomer = (id: string | null) =>
  q<
    CustomerRow & {
      ageing: Record<string, string>;
      orders: {
        id: string;
        number: string;
        date: string;
        amount: string;
        gp: string;
        status: string;
        items: { item: string; qty: number }[];
      }[];
    }
  >(['customer', id], id ? `/api/crm/customers/${id}` : null);
export const useScot = () => q<ScotSheet>(['scot'], '/api/crm/scot');
export type ScotSheet = {
  today: string;
  settings: CrmConfig['scot'];
  rows: (Scot & {
    customerId: string;
    name: string;
    city: string | null;
    mobile: string | null;
    callBeforeDays: number;
    overdue: boolean;
    openCall: boolean;
    scId: string | null;
    sc: string | null;
    sleeping: boolean;
  })[];
  tiles: { onScot: number; callsToday: number; overdue: number; next7: number; expected30: string };
  days: { date: string; calls: number; working: boolean }[];
  gap: { crrTarget: string; scotExpects: string; gap: string; sleepingLost: number };
};
export const useCalls = (scId?: string) =>
  q<{
    today: string;
    calls: CallRow[];
    tiles: { due: number; done: number; takenToday: string; crrToday: string; winBack: number };
    canPickSc: boolean;
  }>(['calls', scId ?? 'all'], `/api/crm/calls${scId ? `?scId=${scId}` : ''}`);
export const useOrders = () =>
  q<{
    columns: { key: string; name: string; cards: OrderCard[] }[];
    other: OrderCard[];
    tiles: { ordersThisMonth: number; onTimePct: number | null; backlog: string; late: number };
  }>(['orders'], '/api/crm/orders');
export const useCollections = () => q<Collections>(['collections'], '/api/crm/collections');
export type Collections = {
  today: string;
  rows: {
    customerId: string;
    name: string;
    city: string | null;
    mobile: string | null;
    email: string | null;
    creditDays: number;
    receivable: string;
    overdue: string;
    dueToday: string;
    ageing: Record<'0_30' | '31_60' | '61_90' | '90_plus', string>;
    promisedOn: string | null;
    promisedAmount: string | null;
    brokenPromise: boolean;
    lastNote: { kind: string; note: string | null; at: string } | null;
    tags: AutoTag[];
  }[];
  tiles: { receivable: string; overdue: string; dueToday: string; over90: string; promisedThisWeek: number };
  ageing: Record<'0_30' | '31_60' | '61_90' | '90_plus', string>;
};
export const useCollectionLog = (id: string | null) =>
  q<{
    notes: {
      id: string;
      kind: string;
      note: string | null;
      promisedOn: string | null;
      promisedAmount: string | null;
      by: string | null;
      at: string;
    }[];
    payments: {
      id: string;
      amount: string;
      date: string;
      mode: string | null;
      reference: string | null;
      by: string | null;
    }[];
  }>(['collection', id], id ? `/api/crm/collections/${id}` : null);
export const useFunnel = (ownerId?: string) =>
  q<{
    stages: CrmConfig['nbd']['stages'];
    sources: string[];
    questions: string[];
    fields: CrmConfig['nbd']['fields'];
    enquiries: LeadCard[];
    columns: (CrmConfig['nbd']['stages'][number] & { leads: LeadCard[] })[];
    closed: LeadCard[];
    tiles: {
      toQualify: number;
      open: number;
      inFunnel: string;
      stuck: number;
      noNext: number;
      won90: string;
      winRatePct: number | null;
    };
    canPickOwner: boolean;
  }>(['leads', ownerId ?? 'all'], `/api/crm/leads${ownerId ? `?ownerId=${ownerId}` : ''}`);
export const useMeca = (month?: string) =>
  q<{
    month: string;
    weeks: { week: string; start: string; end: string }[];
    rows: {
      seat: Seat;
      userId: string;
      name: string;
      monthTarget: string;
      weeks: {
        week: string;
        leads: number;
        conversionPct: number | null;
        averageSale: string;
        calls: { done: number; planned: number; grade: Grade };
        orders: { value: string; target: string; grade: Grade };
        future: boolean;
      }[];
    }[];
  }>(['meca', month ?? 'now'], `/api/crm/meca${month ? `?month=${month}` : ''}`);
export type Grade = 'green' | 'yellow' | 'red' | 'none';
export const useDashboard = (view: { seat?: string; userId?: string }) => {
  const s = new URLSearchParams(
    Object.entries(view).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return q<Dashboard>(['dashboard', s], `/api/crm/dashboard${s ? `?${s}` : ''}`);
};
export type Dashboard = {
  today: string;
  fy: number;
  planStatus: PlanStatus;
  planned: boolean;
  viewing: { seat: string | null; userId: string | null; own: boolean };
  month: { target: string; achieved: string; pacePct: number | null; gap: string; daysLeft: number };
  tiles: {
    revenue: { value: string; spark: string[]; deltaPct: number | null };
    gp: { value: string; marginPct: number | null; spark: string[] };
    orders: number;
    collectionDue: string;
    calls: { done: number; overdue: number };
    leads: { open: number; thisWeek: number; value: string };
  };
  byMonth: { month: string; target: string; achieved: string; gp: string; past: boolean }[];
  year: { donePct: number; achievedPct: number | null; achieved: string; target: string };
};

export const useCrmMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['crm'], ['fms']], success);

export const crmApi = {
  savePlan: (input: Partial<PlanInput>, fy: number, resetMonths = false) =>
    api<PlanData>('/api/crm/plan', { method: 'PUT', body: { fy, input, resetMonths } }),
  editMonth: (body: { fy: number; index: number; turnover: number; gp?: number; keepTotal: boolean }) =>
    api<PlanData>('/api/crm/plan/month', { method: 'POST', body }),
  planAction: (action: 'submit' | 'approve' | 'reject' | 'withdraw' | 'unlock', fy: number) =>
    api<PlanData>(`/api/crm/plan/${action}`, { method: 'POST', body: { fy } }),
  savePage: (page: SetupPage, patch: Partial<CrmConfig>) =>
    api<Progress>('/api/crm/setup', { method: 'PUT', body: { page, patch } }),
  markDone: (page: SetupPage) => api<Progress>('/api/crm/setup/done', { method: 'POST', body: { page } }),
  saveFields: (fields: CrmConfig['fields']) => api('/api/crm/fields', { method: 'PUT', body: fields }),
  saveTagDefs: (tags: CrmConfig['tags']) => api('/api/crm/tags', { method: 'PUT', body: tags }),
  saveCustomer: (body: object, id?: string) =>
    api<{ id: string; code: string; name: string }>(id ? `/api/crm/customers/${id}` : '/api/crm/customers', {
      method: id ? 'PUT' : 'POST',
      body,
    }),
  setTags: (id: string, tags: string[]) =>
    api(`/api/crm/customers/${id}/tags`, { method: 'PUT', body: { tags } }),
  importCustomers: (text: string) =>
    api<{ created: number }>('/api/crm/customers/import', { method: 'POST', body: { text } }),
  answer: (id: string, body: object) =>
    api<{ result: string; order: { number: string } | null }>(`/api/crm/calls/${id}/answer`, {
      method: 'POST',
      body,
    }),
  order: (body: object) => api<{ number: string }>('/api/crm/orders', { method: 'POST', body }),
  payment: (body: object) => api('/api/crm/payments', { method: 'POST', body }),
  note: (body: object) => api('/api/crm/collections/notes', { method: 'POST', body }),
  statement: (id: string) => api(`/api/crm/collections/${id}/statement`, { method: 'POST' }),
  enquiry: (body: object) => api('/api/crm/leads', { method: 'POST', body }),
  leadAction: (id: string, body: object) =>
    api<{ status: string; customerId: string | null }>(`/api/crm/leads/${id}/action`, {
      method: 'POST',
      body,
    }),
};

/** ₹ from paise (string or number): compact for tiles (₹45.36 L), whole rupees otherwise. */
export const inr = (paise: string | number, compact = false) =>
  formatINR(
    typeof paise === 'number' ? Math.round(paise) : paise,
    compact ? { compact: true } : { decimals: false },
  );
/** Typed rupees ("1,20,000" / "45000.50") → paise, or null when not a number. */
export const toPaise = (text: string) => {
  const n = Number(text.replace(/[,₹\s]/g, ''));
  return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** The plan worked out in the browser from unsaved inputs (same maths as the server). */
export const calendarOf = (p: PlanData) => ({
  fyStart: p.fyStart,
  holidays: new Set(p.holidays),
  workingWeekdays: new Set(p.workingWeekdays),
});
