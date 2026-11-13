import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PayPurpose } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

/** Phase 19 — integrations: connections and their health, site agents, Tally, aggregator payouts, payment links. */
const KEY = ['connect'];
export type Connection = {
  id: string;
  kind: 'CHANNEL' | 'GATEWAY' | 'EINVOICE';
  branchId: string | null;
  provider: string;
  baseUrl: string | null;
  hasSecret: boolean;
  hookPath: string;
  rooms?: { roomTypeId: string; code: string }[];
  plans?: { ratePlanId: string; code: string }[];
  defaultPlanId?: string | null;
  modeId?: string | null;
  active: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  pending: number;
  failed: number;
};
export type Health = {
  ok: boolean;
  problems: number;
  connections: Connection[];
  overbooked: number;
  payments: { id: string; purpose: string; amount: number; note: string | null }[];
  agents: { id: string; name: string; branchId: string; lastSeenAt: string | null; online: boolean }[];
  printWaiting: number;
  tally: { waiting: number; failed: number };
};
export type Agent = {
  id: string;
  name: string;
  branchId: string;
  prefix: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};
export type TallyQueue = {
  waiting: number;
  posted: number;
  failed: { id: string; date: string; narration: string; error: string | null }[];
};
export type LogRow = {
  id: string;
  direction: 'IN' | 'OUT';
  what: string;
  ref: string | null;
  status: string;
  tries: number;
  error: string | null;
  at: string;
};
export type Payout = {
  id: string | null;
  summary: {
    matched: number;
    unknown: number;
    unpaid: number;
    again: number;
    net: number;
    deductions: number;
    diff: number;
  };
  matched: { ref: string; billed: number; net: number; deductions: number; diff: number }[];
  unknown: { ref: string; net: number }[];
  unpaid: { ref: string; billed: number }[];
};
export type AggregatorReport = {
  sides: {
    aggregator: string;
    name: string;
    orders: number;
    waiting: { id: string; ref: string; number: number; businessDay: string; billed: number }[];
    waitingAmount: number;
  }[];
  imports: { id: string; aggregator: string; fileName: string | null; createdAt: string }[];
};
export type Overbooked = {
  id: string;
  number: string;
  channel: string | null;
  channelRef: string | null;
  arrive: string;
  depart: string;
  guest: string;
};
export type PayLink = {
  id: string;
  purpose: PayPurpose;
  amount: number;
  url: string | null;
  status: 'CREATED' | 'PAID' | 'CANCELLED';
  note: string | null;
};

const useGet = <T>(key: unknown[], url: string, enabled = true, ms: number | false = false) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled, refetchInterval: ms });
export const useHealth = () => useGet<Health>(['health'], '/api/connect/health', true, 30_000);
export const useAgents = () => useGet<Agent[]>(['agents'], '/api/connect/agents');
export const useTallyQueue = (enabled: boolean) =>
  useGet<TallyQueue>(['tally'], '/api/connect/tally', enabled);
export const useLog = () => useGet<LogRow[]>(['log'], '/api/connect/log');
export const useAggregators = () => useGet<AggregatorReport>(['aggregators'], '/api/connect/aggregators');
export const useOverbooked = (branchId: string) =>
  useGet<Overbooked[]>(
    ['overbooked', branchId],
    `/api/connect/channel/overbooked?branchId=${branchId}`,
    Boolean(branchId),
  );
export const usePayLinks = (purpose: PayPurpose, refId: string, enabled: boolean) =>
  useGet<PayLink[]>(
    ['links', purpose, refId],
    `/api/connect/paylinks?purpose=${purpose}&refId=${refId}`,
    enabled,
    15_000,
  );

export function useConnectMutation<I, O = unknown>(
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['hotel'] });
    },
  });
}
export const send = <T = unknown>(url: string, body: unknown = {}, method = 'POST') =>
  api<T>(url, { method, body });
export const dmy = (day: string) => day.slice(0, 10).split('-').reverse().join('/');
export const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
