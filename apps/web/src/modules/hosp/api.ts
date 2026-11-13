import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { HospRules, OutletCharges, TimeWindow } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

/** Phase 14 — hospitality set-up and menu: types, queries and one mutation helper. */
const KEY = ['hosp'];
export type Station = { id: string; name: string; kind: string; printerId: string | null; display: boolean };
export type Outlet = {
  id: string;
  name: string;
  kind: string;
  branchId: string;
  branch: string;
  locationId: string;
  priceListId: string | null;
  openMin: number;
  closeMin: number;
  charges: OutletCharges;
  billPrinterId: string | null;
  active: boolean;
  stations: Station[];
  routes: { category: string; stationId: string }[];
  floors: { id: string; name: string }[];
  tables: number;
};
export type Table = {
  id: string;
  name: string;
  seats: number;
  shape: string;
  x: number;
  y: number;
  section: string | null;
  combinable: boolean;
  stewardIds: string[];
};
export type Floor = { id: string; name: string; tables: Table[] };
export type RoomType = {
  id: string;
  branchId: string;
  name: string;
  code: string;
  occupancy: number;
  maxOccupancy: number;
  beds: string | null;
  amenities: string[];
  tariff: number | null;
  taxCode: string | null;
  rooms: number;
};
export type Room = {
  id: string;
  branchId: string;
  typeId: string;
  number: string;
  floor: string | null;
  features: string[];
  connectsTo: string[];
};
export type Printer = {
  id: string;
  name: string;
  kind: string;
  connection: string;
  address: string | null;
  branchId: string | null;
};
export type Variant = { key: string; name: string; price: number; itemId?: string | null; factor: number };
export type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  nameHi: string | null;
  code: string | null;
  itemId: string | null;
  diet: 'VEG' | 'NONVEG' | 'EGG';
  allergens: string[];
  spice: number;
  hsn: string | null;
  taxCode: string | null;
  price: number;
  variants: Variant[];
  modifierGroupIds: string[];
  combo: { menuItemId: string; qty: number }[];
  windows: TimeWindow[];
  outletIds: string[];
  active: boolean;
  off: boolean;
  offReason: string | null;
  prices: {
    variantKey: string;
    outletId: string | null;
    label: string | null;
    window: TimeWindow | null;
    price: number;
  }[];
};
export type ModGroup = {
  id: string;
  name: string;
  min: number;
  max: number;
  options: {
    key: string;
    name: string;
    price: number;
    itemId?: string | null;
    qty?: number | null;
    unit?: string | null;
  }[];
};
export type MenuSetup = {
  categories: { id: string; name: string; nameHi: string | null; sort: number; items: number }[];
  items: MenuItem[];
  groups: ModGroup[];
};

const useGet = <T>(key: unknown[], url: string, enabled = true) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled });
export const useHosp = () =>
  useGet<{ enabled: boolean; rules: HospRules; canAdmin: boolean }>(['settings'], '/api/hosp/settings');
export const useOutlets = () => useGet<Outlet[]>(['outlets'], '/api/hosp/outlets');
export const usePlan = (outletId: string) =>
  useGet<Floor[]>(['plan', outletId], `/api/hosp/outlets/${outletId}/plan`, Boolean(outletId));
export const useRooms = () => useGet<{ types: RoomType[]; rooms: Room[] }>(['rooms'], '/api/hosp/rooms');
export const usePrinters = () => useGet<Printer[]>(['printers'], '/api/hosp/printers');
export const useMenu = () => useGet<MenuSetup>(['menu'], '/api/hosp/menu');

export function useHospMutation<I, O = unknown>(
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
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
export const send = <T = unknown>(method: 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) =>
  api<T>(url, { method, ...(body === undefined ? {} : { body }) });
/** Minutes from midnight ↔ "HH:mm". */
export const hhmm = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMin = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  return m ? Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2])) : 0;
};
