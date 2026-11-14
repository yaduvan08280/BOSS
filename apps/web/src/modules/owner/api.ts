import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Span = { from?: string; to?: string };
const qs = (s: Span) => {
  const p = new URLSearchParams();
  if (s.from) p.set('from', s.from);
  if (s.to) p.set('to', s.to);
  const out = p.toString();
  return out ? `?${out}` : '';
};
const useOwner = <T>(key: string, path: string, s: Span = {}) =>
  useQuery({
    queryKey: ['owner', key, s.from ?? '', s.to ?? ''],
    queryFn: () => api<T>(`/api/owner/${path}${qs(s)}`),
  });

export type RangeKey =
  | 'voidPct'
  | 'discountPct'
  | 'wastagePct'
  | 'cashDiff'
  | 'attendancePct'
  | 'lateWorkPct'
  | 'checklistMissedPct';
export type Flag = { key: string; n: number; weight: number };
export type CompanyMorning = {
  companyId: string;
  name: string;
  day: string;
  mine: boolean;
  sales: number;
  bills: number;
  cashDiff: number;
  attendancePct: number | null;
  absent: number;
  overdue: number;
  lateSteps: number;
  missed: number;
  escalated: number;
  red: number;
  flags: Flag[];
};
export type Morning = { companies: CompanyMorning[]; worst: (Flag & { company: string })[]; linked: number };
export type Exceptions = {
  from: string;
  to: string;
  exceptions: {
    branchId: string;
    branch: string;
    manager: string | null;
    key: RangeKey;
    value: number;
    limit: number;
  }[];
  branches: { branchId: string; branch: string; ranges: Record<RangeKey, number>; own: boolean }[];
  defaults: Record<RangeKey, number>;
};
export type LeagueRow = {
  branchId: string;
  branch: string;
  type: string;
  manager: string | null;
  sales: number;
  bills: number;
  people: number;
  voidPct: number | null;
  discountPct: number | null;
  wastagePct: number | null;
  cashDiff: number;
  attendancePct: number | null;
  lateWorkPct: number | null;
  checklistMissedPct: number | null;
  score: number | null;
};
export type League = { from: string; to: string; branches: LeagueRow[] };
export type Leaks = {
  from: string;
  to: string;
  sales: number;
  totals: {
    voids: number;
    discounts: number;
    cancelled: number;
    cashShort: number;
    wastage: number;
    all: number;
  };
  people: {
    userId: string;
    name: string;
    branch: string;
    voids: number;
    voidCount: number;
    discounts: number;
    noCharge: number;
    cancelled: number;
    cashShort: number;
    wastage: number;
    total: number;
  }[];
  voidReasons: { reason: string; value: number }[];
  wastageByPlace: { place: string; value: number }[];
};
export type Promises = {
  from: string;
  to: string;
  keptPct: number | null;
  due: number;
  people: {
    userId: string;
    name: string;
    branch: string;
    due: number;
    kept: number;
    broken: number;
    moved: number;
    declined: number;
    keptPct: number | null;
    avgSlipDays: number;
    team: { people: number; keptPct: number | null };
  }[];
};
export type Delay = {
  from: string;
  to: string;
  total: number;
  unpriced: number;
  processes: {
    flowId: string;
    name: string;
    rupeesPerDay: number;
    steps: number;
    lateSteps: number;
    lateDays: number;
    cost: number;
  }[];
  people: { userId: string; name: string; lateSteps: number; lateDays: number; cost: number }[];
  steps: { process: string; step: string; lateSteps: number; lateDays: number; cost: number }[];
};
export type BusFactor = {
  total: number;
  since: string;
  people: {
    userId: string;
    name: string;
    branch: string;
    count: number;
    items: { kind: 'step' | 'checklist' | 'branch' | 'department'; what: string; times?: number }[];
  }[];
};
export type Vendors = {
  since: string;
  vendors: {
    vendor: string;
    orders: number;
    value: number;
    deliveries: number;
    onTimePct: number | null;
    rejectedPct: number | null;
    rateUps: number;
    rateDowns: number;
  }[];
  cheaper: {
    item: string;
    unit: string;
    vendor: string;
    rate: number;
    other: string;
    otherRate: number;
    savePct: number;
  }[];
};
export type CashFlow = {
  from: string;
  to: string;
  totals: { in: number; out: number; overdueIn: number; overdueOut: number };
  lowest: { day: string; running: number } | null;
  days: {
    day: string;
    in: number;
    out: number;
    net: number;
    running: number;
    notes: { kind: string; text: string; amount: number }[];
  }[];
};

export const useMorning = () => useOwner<Morning>('morning', 'morning');
export const useExceptions = (s: Span) => useOwner<Exceptions>('exceptions', 'exceptions', s);
export const useLeague = (s: Span) => useOwner<League>('league', 'league', s);
export const useLeaks = (s: Span) => useOwner<Leaks>('leaks', 'leaks', s);
export const usePromises = (s: Span) => useOwner<Promises>('promises', 'promises', s);
export const useDelay = (s: Span) => useOwner<Delay>('delay', 'delay', s);
export const useBusFactor = () => useOwner<BusFactor>('bus', 'bus-factor');
export const useVendors = () => useOwner<Vendors>('vendors', 'vendors');
export const useCashFlow = () => useOwner<CashFlow>('cash', 'cash-flow');
