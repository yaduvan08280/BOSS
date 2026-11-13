import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { BanquetStatus, BranchRules, ComplianceState } from '@mono/shared';
import { api, ApiError } from '@/lib/api';
import { useOutlets } from '@/modules/hosp/api';

/** Phase 18 — banquets, the bar register and compliance: types, queries and one mutation helper. */
const KEY = ['banquet'];
export type Hall = {
  id: string;
  branchId: string;
  name: string;
  capacities: { style: string; guests: number }[];
  rent: number;
};
export type Package = {
  id: string;
  name: string;
  pricePerPlate: number;
  taxCode: string | null;
  items: { name: string }[];
};
export type BanquetEvent = {
  id: string;
  number: string;
  status: BanquetStatus;
  occasion: string;
  day: string;
  from: string;
  to: string;
  halls: { id: string; name: string }[];
  expectedCovers: number;
  guaranteedCovers: number | null;
  actualCovers: number | null;
  guest: { name: string; mobile: string } | null;
  quote: {
    packageId: string | null;
    packageName: string | null;
    pricePerPlate: number;
    hallRent: number;
    extras: { name: string; amount: number }[];
  } | null;
  totals: { covers: number; taxable: number; tax: number; total: number };
  advance: { needed: number; paid: number };
  beo: Record<string, string> | null;
  beoVersion: number;
  beoSentAt: string | null;
  indent: { itemId: string; name: string; unit: string; need: number; have: number; short: number }[];
  checklist: { text: string; dept: string; done: boolean }[];
  invoice: { number: string; total: number; due: number } | null;
  feedback: { rating: number; comments: string | null } | null;
  note: string | null;
};
export type ExciseRow = {
  day: string;
  location: string;
  itemId: string;
  brand: string;
  sizeMl: number;
  opening: Qty;
  received: Qty;
  sold: Qty;
  breakage: Qty;
  closing: Qty;
};
type Qty = { bottles: number; ml: number };
export type Excise = {
  licenceNo: string | null;
  permitNo: string | null;
  dryDays: { date: string; reason: string }[];
  rows: ExciseRow[];
};
export type ComplianceRow = {
  id: string;
  kind: string;
  name: string;
  number: string | null;
  expiresOn: string;
  everyDays: number | null;
  state: ComplianceState;
  daysLeft: number;
};
export type TempPoint = {
  id: string;
  name: string;
  unit: string;
  min: number | null;
  max: number | null;
  last: { value: number; ok: boolean; at: string } | null;
  outOfRange: number;
};

const useGet = <T>(key: unknown[], url: string, enabled = true, ms: number | false = false) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled, refetchInterval: ms });
export const useHalls = (branchId: string) =>
  useGet<Hall[]>(['halls', branchId], `/api/banquets/halls?branchId=${branchId}`, Boolean(branchId));
export const usePackages = () => useGet<Package[]>(['packages'], '/api/banquets/packages');
export const useEvents = (branchId: string) =>
  useGet<{ today: string; events: BanquetEvent[] }>(
    ['events', branchId],
    `/api/banquets/events?branchId=${branchId}`,
    Boolean(branchId),
    30_000,
  );
export const useBranchRules = (branchId: string) =>
  useGet<{ rules: BranchRules; today: string }>(
    ['rules', branchId],
    `/api/hosp/branch-rules?branchId=${branchId}`,
    Boolean(branchId),
  );
export const useExcise = (branchId: string, day: string) =>
  useGet<Excise>(
    ['excise', branchId, day],
    `/api/bar/excise?branchId=${branchId}&from=${day}`,
    Boolean(branchId && day),
  );
export const useCompliance = (branchId: string) =>
  useGet<{ today: string; counts: Record<'valid' | 'expiring' | 'expired', number>; items: ComplianceRow[] }>(
    ['compliance', branchId],
    `/api/compliance?branchId=${branchId}`,
    Boolean(branchId),
  );
export const useTemps = (branchId: string) =>
  useGet<{ points: TempPoint[] }>(
    ['temps', branchId],
    `/api/compliance/temps?branchId=${branchId}`,
    Boolean(branchId),
  );

export function useBanquetMutation<I, O = unknown>(
  request: (input: I) => Promise<O>,
  success?: string | ((o: O) => string | undefined),
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (o) => {
      const msg = typeof success === 'function' ? success(o) : success;
      if (msg) toast.success(msg);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
export const send = <T = unknown>(url: string, body: unknown = {}, method = 'POST') =>
  api<T>(url, { method, body });

/** The branches that run hospitality (those with an outlet). The first is chosen until another is picked. */
export function useHospBranch() {
  const outlets = useOutlets();
  const [picked, setPicked] = useState('');
  const seen = new Map<string, string>();
  for (const o of outlets.data ?? []) if (!seen.has(o.branchId)) seen.set(o.branchId, o.branch);
  const list = [...seen].map(([id, name]) => ({ id, name }));
  return { loading: outlets.isPending, list, branchId: picked || list[0]?.id || '', setBranchId: setPicked };
}
export const EVENT_TONE: Record<BanquetStatus, 'ok' | 'warn' | 'bad' | 'info' | 'over' | 'neutral'> = {
  ENQUIRY: 'warn',
  QUOTED: 'info',
  CONFIRMED: 'ok',
  COMPLETED: 'over',
  CLOSED: 'neutral',
  LOST: 'neutral',
  CANCELLED: 'bad',
};
export const dmy = (day: string) => day.split('-').reverse().join('/');
