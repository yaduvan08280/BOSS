import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatINR } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

/** Phase 13 — stock per location: types, queries and one mutation helper for the inventory v2 screens. */
const KEY = ['stock'];
export type Place = {
  id: string;
  name: string;
  kind: string;
  branchId: string | null;
  branch: string | null;
};
export type BatchRow = {
  batchId: string;
  code: string;
  kind: string;
  expiry: string | null;
  daysLeft: number | null;
  expired: boolean;
  attrs: Record<string, unknown> | null;
  qty: number;
  qty2: number;
  barcode: string | null;
};
export type StockRow = {
  itemId: string;
  code: string;
  name: string;
  unit: string;
  tracking: string;
  secondUnit: string | null;
  locationId: string;
  location: string;
  branch: string | null;
  qty: number;
  qty2: number;
  value: number;
  whole: { unit: string; whole: number; open: number } | null;
  batches: BatchRow[];
};
export type ItemLite = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  active: boolean;
};
export type TransferLine = {
  itemId: string;
  asked: number;
  unit: string | null;
  unitQty: number;
  approved: number | null;
  dispatched: number;
  received: number;
  damaged: number;
  short: number;
  excess: number;
  rate: number;
  onTheRoad: number;
  item: { name: string; unit: string; code: string } | null;
  substitute: { name: string } | null;
};
export type Transfer = {
  id: string;
  number: string;
  kind: 'INDENT' | 'EMERGENCY' | 'DIRECT';
  status: 'REQUESTED' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED' | 'CLOSED' | 'REJECTED' | 'CANCELLED';
  from: Place | null;
  to: Place | null;
  iSupply: boolean;
  iReceive: boolean;
  note: string | null;
  reason: string | null;
  createdAt: string;
  paper: { number: string; type: string; total: number } | null;
  inTransit: boolean;
  lines: TransferLine[];
};
export type Recipe = {
  id: string;
  itemId: string;
  code: string;
  name: string;
  unit: string;
  made: string;
  version: number;
  active: boolean;
  outputQty: number;
  cost: number | null;
  sellPrice: number | null;
  foodCostPct: number | null;
  lines: {
    itemId: string;
    qty: number;
    unit: string | null;
    yieldPct: number;
    wastagePct: number;
    name: string;
    stockUnit: string;
  }[];
};
export type Production = {
  id: string;
  number: string;
  status: 'PLANNED' | 'DONE' | 'CANCELLED';
  item: { name: string; unit: string } | null;
  location: string;
  plannedQty: number;
  actualQty: number | null;
  variance: number | null;
  cost: number;
  batch: { code: string; expiry: string | null } | null;
};
export type Grn = {
  id: string;
  number: string;
  po: string | null;
  vendor: string | null;
  location: string;
  invoiceNo: string | null;
  billId: string | null;
  createdAt: string;
  lines: {
    itemId: string;
    item: string;
    stockUnit: string;
    received: number;
    rate: number;
    rejected: number;
    qtyVariance: number | null;
    rateVariance: number | null;
    returned: number;
  }[];
};
export type WasteRow = {
  id: string;
  at: string;
  item: { name: string; code: string };
  unit: string;
  unitQty: number;
  reason: string;
  note: string | null;
  value: number;
  status: 'APPLIED' | 'PENDING' | 'REJECTED';
  location: string;
  by: string | null;
  canDecide: boolean;
};
export type CountHead = {
  id: string;
  number: string;
  status: string;
  date: string;
  blind: boolean;
  location: string;
  items: number;
  counted: number;
  differ: number;
  flagged: number;
};
export type CountDetail = {
  id: string;
  number: string;
  status: 'OPEN' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  date: string;
  blind: boolean;
  location: Place;
  canDecide: boolean;
  lines: {
    itemId: string;
    code: string;
    name: string;
    unit: string;
    system: number | null;
    counted: number | null;
    diff: number | null;
    pct: number | null;
    flagged: boolean;
    value: number | null;
  }[];
};
export type PriceList = {
  id: string;
  name: string;
  partyKind: string | null;
  branchId: string | null;
  from: string;
  to: string | null;
  active: boolean;
  lines: { itemId: string; price: number; item: { name: string; code: string; unit: string } | null }[];
};
export type BoardRate = {
  key: string;
  unit: string | null;
  rate: number;
  date: string;
  history: { date: string; rate: number }[];
};

const useGet = <T>(key: unknown[], url: string, enabled = true) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled });
export const useStock = (locationId?: string) =>
  useGet<{ valuation: string; places: Place[]; rows: StockRow[] }>(
    ['rows', locationId ?? '*'],
    `/api/ims/stock${locationId === undefined ? '' : `?locationId=${encodeURIComponent(locationId)}`}`,
  );
export const useItems = () => useGet<{ items: ItemLite[] }>(['items'], '/api/ims/items');
export const useExpiry = () =>
  useGet<(BatchRow & { item: string; unit: string; location: string; batch: string })[]>(
    ['expiry'],
    '/api/ims/expiry?days=30',
  );
export const useValuation = () =>
  useGet<{
    method: string;
    total: number;
    locations: {
      locationId: string;
      location: string;
      branch: string | null;
      items: number;
      value: number;
    }[];
  }>(['value'], '/api/ims/valuation');
export const useTransfers = () => useGet<Transfer[]>(['transfers'], '/api/ims/transfers');
export const useRecipes = () => useGet<Recipe[]>(['recipes'], '/api/ims/recipes');
export const useProduction = () => useGet<Production[]>(['production'], '/api/ims/production');
export const useGrns = () => useGet<Grn[]>(['grn'], '/api/ims/grn');
export const useWaste = () =>
  useGet<{ rows: WasteRow[]; byReason: { reason: string; value: number }[] }>(['waste'], '/api/ims/wastage');
export const useCounts = () => useGet<CountHead[]>(['counts'], '/api/ims/closing');
export const useCount = (id: string | null) =>
  useGet<CountDetail>(['count', id], `/api/ims/closing/${id}`, Boolean(id));
export const usePriceLists = () => useGet<PriceList[]>(['prices'], '/api/ims/price-lists');
export const useBoard = () => useGet<BoardRate[]>(['board'], '/api/ims/rate-board');
export const usePar = (locationId: string, enabled = true) =>
  useGet<{
    rows: {
      itemId: string;
      code: string;
      name: string;
      unit: string;
      par: number;
      min: number | null;
      stock: number;
      coming: number;
      short: boolean;
      ask: number;
      source: { type: string; from?: string; vendor?: string | null };
    }[];
  }>(['par', locationId], `/api/ims/par?locationId=${encodeURIComponent(locationId)}`, enabled);

export function useStockMutation<I, O = unknown>(
  request: (input: I) => Promise<O>,
  success?: string | ((o: O) => string),
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
      void qc.invalidateQueries({ queryKey: ['ims'] });
    },
  });
}
export const post = <T = unknown>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body });
export const put = <T = unknown>(url: string, body: unknown) => api<T>(url, { method: 'PUT', body });
export const rupees = (paise: number) => formatINR(Math.round(paise));
export const qty = (n: number) => String(Math.round(n * 1000) / 1000);
export const toPaise = (typed: string) => Math.round(Number(typed || 0) * 100);
