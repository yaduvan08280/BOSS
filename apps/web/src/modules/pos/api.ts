import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';

/** Phase 15 — the POS screens: types, queries (polled, so every device sees the floor and tickets live) and mutations. */
const KEY = ['pos'];
export type TableState = 'FREE' | 'SEATED' | 'ORDERED' | 'BILLED' | 'PAID';
export type OrderBrief = {
  id: string;
  number: number;
  type: string;
  status: string;
  covers: number;
  guestName: string | null;
  openedAt: string;
  items: number;
  total: number;
};
export type FloorView = {
  outlet: { id: string; name: string };
  businessDay: string;
  floors: {
    id: string;
    name: string;
    tables: {
      id: string;
      name: string;
      seats: number;
      shape: string;
      state: TableState;
      order: OrderBrief | null;
    }[];
  }[];
  others: OrderBrief[];
};
export type OrderItem = {
  id: string;
  name: string;
  variantName: string | null;
  qty: number;
  price: number;
  modifiers: { name: string; price: number }[];
  note: string | null;
  course: string | null;
  seat: number | null;
  status: 'HELD' | 'FIRED' | 'READY' | 'SERVED' | 'VOID';
  voidAsked: boolean;
  stockNote: string | null;
};
export type Order = {
  id: string;
  number: number;
  type: string;
  status: 'OPEN' | 'BILLED' | 'PAID' | 'CANCELLED';
  tableIds: string[];
  covers: number;
  total: number;
  roomNo: string | null;
  items: OrderItem[];
};
export type LiveItem = {
  id: string;
  name: string;
  nameHi: string | null;
  diet: string;
  price: number;
  label: string | null;
  available: boolean;
  out: 'off' | 'stock' | null;
  outReason: string | null;
  variants: { key: string; name: string; price: number; out: boolean }[];
  modifierGroups: {
    id: string;
    name: string;
    min: number;
    max: number;
    options: { key: string; name: string; price: number }[];
  }[];
};
export type LiveMenu = { categories: { id: string; name: string; items: LiveItem[] }[] };
export type Check = {
  pending?: boolean;
  approvalId?: string;
  id: string;
  orderId: string;
  checkNo: number;
  number: string;
  status: 'OPEN' | 'PAID' | 'CANCELLED';
  total: number;
  taxable: number;
  tax: number;
  taxes: { name: string; amount: number }[];
  roundOff: number;
  serviceCharge: number;
  discount: { amount: number } | null;
  ncReason: string | null;
  parts: number[] | null;
  payments: { mode: string; kind: string; amount: number; reference: string | null }[];
  due: number;
  printed: number;
  upi: string | null;
  cancelReason: string | null;
  orderStatus?: string;
};
export type Ticket = {
  id: string;
  number: number;
  status: 'NEW' | 'READY' | 'BUMPED';
  station: string | null;
  order: { number: number; type: string; table: string } | null;
  firedAt: string;
  minutes: number;
  tone: 'ok' | 'warn' | 'bad';
  items: { id: string; name: string; qty: number; note: string | null; status: string; mods: string[] }[];
};
export type Kds = {
  stations: { id: string; name: string }[];
  tickets: Ticket[];
  allDay: { name: string; qty: number }[];
};
export type Approval = {
  id: string;
  kind: 'VOID' | 'DISCOUNT' | 'CANCEL_BILL';
  ask: Record<string, unknown>;
  askedBy: string;
  canDecide: boolean;
};
export type ZReport = {
  businessDay: string;
  orders: number;
  covers: number;
  open: number;
  bills: number;
  sales: number;
  tax: number;
  serviceCharge: number;
  discounts: number;
  noCharge: number;
  voids: { count: number; value: number };
  byMode: { modeId: string; mode: string; kind: string; amount: number | null; count: number }[];
  cash: number | null;
  unpaid: number;
  tips: { steward: string; amount: number }[];
  closed: { at: string; counted: number; report: { difference: number; cash: number } } | null;
  denominations: number[];
  canClose: boolean;
};

const usePoll = <T>(key: unknown[], url: string, enabled: boolean, ms: number | false = 5000) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled, refetchInterval: ms });
export const useFloor = (outletId: string) =>
  usePoll<FloorView>(['floor', outletId], `/api/pos/outlets/${outletId}/floor`, Boolean(outletId));
export const useOrder = (id: string | null) =>
  usePoll<Order>(['order', id], `/api/pos/orders/${id}`, Boolean(id));
export const useLiveMenu = (outletId: string) =>
  usePoll<LiveMenu>(['menu', outletId], `/api/hosp/outlets/${outletId}/menu`, Boolean(outletId), 30_000);
export const useKds = (outletId: string, stationId: string, show: 'open' | 'bumped') =>
  usePoll<Kds>(
    ['kds', outletId, stationId, show],
    `/api/pos/outlets/${outletId}/kds?show=${show}${stationId ? `&stationId=${stationId}` : ''}`,
    Boolean(outletId),
  );
export const useChecks = (outletId: string) =>
  usePoll<Check[]>(['checks', outletId], `/api/pos/outlets/${outletId}/checks`, Boolean(outletId), 15_000);
export const useApprovals = (outletId: string) =>
  usePoll<Approval[]>(
    ['approvals', outletId],
    `/api/pos/outlets/${outletId}/approvals`,
    Boolean(outletId),
    10_000,
  );
export const useDay = (outletId: string) =>
  usePoll<ZReport>(['day', outletId], `/api/pos/outlets/${outletId}/day`, Boolean(outletId), false);

export function usePosMutation<I, O = unknown>(
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
export const post = <T = unknown>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body });
