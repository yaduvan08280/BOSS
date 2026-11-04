import { useQuery } from '@tanstack/react-query';
import type { Band, ImsRules, PoStatus } from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type ItemRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  location: string | null;
  vendor: string | null;
  leadTimeDays: number;
  safetyFactor: number;
  maxQty: number | null;
  minQty: number | null;
  stock: number;
  onOrder: number;
  band: Band;
  ratePaise: string;
  valuePaise: string;
  active: boolean;
  lastMovedAt: string | null;
  lastReviewAt: string | null;
};
export type MoveRow = {
  id: string;
  at: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';
  status: 'APPLIED' | 'PENDING' | 'REJECTED';
  qty: number;
  balance: number | null;
  ratePaise: string | null;
  reason: string | null;
  note: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  refType: string | null;
  item: { id: string; code: string; name: string; unit: string };
  by: string | null;
  decidedBy: string | null;
  canDecide: boolean;
};
export type Review = {
  id: string;
  status: 'PROPOSED' | 'APPLIED' | 'SKIPPED';
  at: string;
  decidedAt: string | null;
  item: { id: string; code: string; name: string; unit: string; stock: number; leadTimeDays: number };
  avgDailyUse: number;
  redDays: number;
  purpleDays: number;
  change: 'raised' | 'lowered' | 'kept';
  safetyBefore: number;
  safetyAfter: number;
  maxBefore: number | null;
  maxAfter: number;
};
export type OwsLine = {
  item: { id: string; code: string; name: string; unit: string; vendor: string | null; leadTimeDays: number };
  stock: number;
  onOrder: number;
  maxQty: number | null;
  band: Band;
  qty: number;
  ratePaise: string;
  valuePaise: string;
};
export type Po = {
  id: string;
  number: string;
  vendor: string;
  status: PoStatus;
  expectedOn: string | null;
  note: string | null;
  fromOws: boolean;
  createdAt: string;
  sentAt: string | null;
  by: string | null;
  lines: {
    id: string;
    item: { id: string; code: string; name: string; unit: string };
    qty: number;
    receivedQty: number;
    ratePaise: string;
    amountPaise: string;
  }[];
  totalPaise: string;
};
export type Count = {
  id: string;
  status: 'OPEN' | 'COUNTED' | 'SKIPPED';
  item: { id: string; code: string; name: string; unit: string; location: string | null };
  systemQty: number | null;
  countedQty: number | null;
  differencePaise: string | null;
  countedAt: string | null;
  note: string | null;
};

const q = <T>(key: unknown[], url: string, enabled = true) =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useQuery({ queryKey: ['ims', ...key], queryFn: () => api<T>(url), retry: false, enabled });

export const useItems = (all = false) =>
  q<{ items: ItemRow[]; counts: Record<Band, number>; valuePaise: string }>(
    ['items', all],
    `/api/ims/items${all ? '?all=1' : ''}`,
  );
export const useMoves = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(
    Object.entries(params).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  return q<MoveRow[]>(['moves', s], `/api/ims/moves${s ? `?${s}` : ''}`);
};
export const useImsRules = () => q<{ rules: ImsRules; saved: boolean }>(['rules'], '/api/ims/rules');
export const useReviews = () =>
  q<{ due: Review[]; done: Review[]; canReview: boolean }>(['reviews'], '/api/ims/reviews');
export const useOws = () =>
  q<{ orderDay: string; open: boolean; opensOn: string; today: string; lines: OwsLine[] }>(
    ['ows'],
    '/api/ims/ows',
  );
export const usePos = () => q<Po[]>(['po'], '/api/ims/po');
export const useCounts = () =>
  q<{ cycle: string; nextCycle: string; counts: Count[]; done: number; canCount: boolean }>(
    ['audit'],
    '/api/ims/audit',
  );
export const useDead = () =>
  q<{
    days: number;
    valuePaise: string;
    items: {
      id: string;
      code: string;
      name: string;
      unit: string;
      location: string | null;
      stock: number;
      lastMovedAt: string | null;
      valuePaise: string;
    }[];
  }>(['dead'], '/api/ims/dead');
export const useReport = <T>(name: string, params = '') =>
  q<T>(['report', name, params], `/api/ims/reports/${name}${params}`);

export const useImsMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['ims']], success);

export const imsApi = {
  saveRules: (body: object) => api('/api/ims/rules', { method: 'PUT', body }),
  saveItem: (body: object, id?: string) =>
    api(id ? `/api/ims/items/${id}` : '/api/ims/items', { method: id ? 'PUT' : 'POST', body }),
  deleteItem: (id: string) => api(`/api/ims/items/${id}`, { method: 'DELETE' }),
  importItems: (table: string[][]) =>
    api<{ created: number; opening: number }>('/api/ims/items/import', { method: 'POST', body: { table } }),
  move: (body: object) =>
    api<{ pending: boolean; stock?: number }>('/api/ims/moves', { method: 'POST', body }),
  decide: (id: string, approve: boolean, note?: string) =>
    api<{ status: string }>(`/api/ims/moves/${id}/decide`, { method: 'POST', body: { approve, note } }),
  applyReviews: (body: object) => api<{ done: number }>('/api/ims/reviews/apply', { method: 'POST', body }),
  reviewNow: () => api<{ proposed: number }>('/api/ims/reviews/run', { method: 'POST' }),
  orderOws: (lines: { itemId: string; qty: number }[]) =>
    api<{ orders: { id: string; number: string; vendor: string }[] }>('/api/ims/ows/order', {
      method: 'POST',
      body: { lines },
    }),
  savePo: (body: object, id?: string) =>
    api<Po>(id ? `/api/ims/po/${id}` : '/api/ims/po', { method: id ? 'PUT' : 'POST', body }),
  poAction: (id: string, action: 'send' | 'receive' | 'close' | 'cancel', body: object = {}) =>
    api<Po>(`/api/ims/po/${id}/${action}`, { method: 'POST', body }),
  count: (id: string, body: object) => api(`/api/ims/audit/${id}`, { method: 'POST', body }),
};

/** 12.5 → "12.5", 3 decimals at most, Indian grouping for big numbers. */
export const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
