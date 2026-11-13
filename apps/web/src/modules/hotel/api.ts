import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { HotelRules, StayStatus } from '@mono/shared';
import { api, ApiError } from '@/lib/api';
import { useRooms } from '@/modules/hosp/api';
import { useBranches } from '@/modules/system/api';

/** Phase 17 — the hotel screens: types, queries (polled, so the desk and housekeeping see the same house) and mutations. */
const KEY = ['hotel'];
export type StayRow = {
  id: string;
  number: string;
  status: StayStatus;
  kind: string;
  arrive: string;
  depart: string;
  nights: number;
  adults: number;
  children: number;
  meal: string;
  roomTypeId: string;
  roomType: string;
  roomId: string | null;
  room: string | null;
  guest: { id: string; name: string; mobile: string; tags: string[] } | null;
  total: number;
  formCDue: boolean;
};
export type FolioLine = {
  id: string;
  day: string;
  kind: string;
  text: string;
  qty: number;
  amount: number;
  voided: boolean;
};
export type Folio = {
  id: string;
  no: number;
  name: string;
  status: 'OPEN' | 'CLOSED';
  invoice: { id: string; number: string; total: number; due: number } | null;
  lines: FolioLine[];
  charges: number;
  tax: number;
  restaurant: number;
  total: number;
  paid: number;
  due: number;
};
export type Stay = StayRow & {
  businessDate: string;
  plan: { id: string; code: string; name: string } | null;
  note: string | null;
  formC: { dueAt: string; filedAt: string | null; missing: string[] } | null;
  keys: number;
  visitors: { name: string; at: string; out: string | null }[];
  nightly: { day: string; rate: number; room: string | null; posted: boolean }[];
  folios: Folio[];
};
export type Desk = {
  businessDate: string;
  arrivals: StayRow[];
  inHouse: StayRow[];
  departures: StayRow[];
  dueOuts: StayRow[];
};
export type Plan = {
  id: string;
  code: string;
  name: string;
  meal: string;
  kind: string;
  active: boolean;
  minStay: number;
  rates: {
    roomTypeId: string;
    base: number;
    weekend?: number | null;
    extraAdult: number;
    extraChild: number;
  }[];
};
export type Quote = {
  nights: { day: string; rate: number }[];
  total: number;
  meal: string;
  problem: string | null;
  soldOutOn: string | null;
};
export type Tape = {
  businessDate: string;
  days: string[];
  types: { id: string; name: string; code: string }[];
  rooms: {
    id: string;
    number: string;
    floor: string | null;
    typeId: string;
    state: string;
    cells: { day: string; stayId: string | null; block: string | null }[];
  }[];
  stays: StayRow[];
  unassigned: string[];
};
export type HkTask = {
  id: string;
  kind: string;
  status: 'OPEN' | 'DONE' | 'INSPECTED';
  assigneeId: string | null;
  checklist: { text: string; done: boolean }[];
  note: string | null;
};
export type HkBoard = {
  businessDate: string;
  minibar: { itemId: string; name: string; price: number }[];
  counts: Record<'toClean' | 'toInspect' | 'vacantClean' | 'vacantDirty' | 'occupied' | 'outOfOrder', number>;
  rooms: {
    id: string;
    number: string;
    floor: string | null;
    type: string;
    state: string;
    guest: string | null;
    stayId: string | null;
    tasks: HkTask[];
  }[];
};
export type AuditPack = {
  day: string;
  rooms: number;
  outOfOrder: number;
  sold: number;
  occupancyPct: number;
  adr: number;
  revPar: number;
  roomRevenue: number;
  arrivals: number;
  departures: number;
  noShows: { number: string; guest: string; charge: number }[];
  revenueByOutlet: { outlet: string; bills: number; amount: number }[];
  money: { mode: string; amount: number }[];
  checks: {
    dueOuts: { number: string; room: string | null }[];
    openFoliosOfDeparted: { number: string; folio: string }[];
    unpaidRestaurantBills: number;
  };
};
export type LostItem = {
  id: string;
  item: string;
  room: string | null;
  foundOn: string;
  status: string;
  returnedTo: string | null;
};
export type RoomBlockRow = {
  id: string;
  room: string;
  kind: string;
  from: string;
  to: string;
  reason: string;
  ticket: { number: number; status: string } | null;
};

const usePoll = <T>(key: unknown[], url: string, enabled: boolean, ms: number | false = 15_000) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled, refetchInterval: ms });
const b = (branchId: string) => `branchId=${branchId}`;
export const useDesk = (branchId: string) =>
  usePoll<Desk>(['desk', branchId], `/api/hotel/desk?${b(branchId)}`, Boolean(branchId));
export const useStay = (id: string | null) =>
  usePoll<Stay>(['stay', id], `/api/hotel/stays/${id}`, Boolean(id));
export const usePlans = (branchId: string) =>
  usePoll<Plan[]>(['plans', branchId], `/api/hotel/plans?${b(branchId)}`, Boolean(branchId), false);
export const useQuote = (query: string | null) =>
  usePoll<Quote>(['quote', query], `/api/hotel/quote?${query}`, Boolean(query), false);
export const useTape = (branchId: string, days: number) =>
  usePoll<Tape>(['tape', branchId, days], `/api/hotel/tape?${b(branchId)}&days=${days}`, Boolean(branchId));
export const useBoard = (branchId: string) =>
  usePoll<HkBoard>(['board', branchId], `/api/hotel/housekeeping?${b(branchId)}`, Boolean(branchId));
export const useAudits = (branchId: string) =>
  usePoll<{ businessDate: string; audits: AuditPack[] }>(
    ['audits', branchId],
    `/api/hotel/night-audits?${b(branchId)}`,
    Boolean(branchId),
    false,
  );
export const useLost = (branchId: string) =>
  usePoll<LostItem[]>(['lost', branchId], `/api/hotel/lost-found?${b(branchId)}`, Boolean(branchId), false);
export const useRoomBlocks = (branchId: string) =>
  usePoll<RoomBlockRow[]>(
    ['blocks', branchId],
    `/api/hotel/room-blocks?${b(branchId)}`,
    Boolean(branchId),
    false,
  );
export const useHotelRules = (branchId: string) =>
  usePoll<{ rules: HotelRules; businessDate: string; name: string }>(
    ['rules', branchId],
    `/api/hotel/rules?${b(branchId)}`,
    Boolean(branchId),
    false,
  );

export function useHotelMutation<I, O = unknown>(
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

/** The properties a person can work at: branches that have rooms. The first is chosen until another is picked. */
export function useProperty() {
  const rooms = useRooms();
  const branches = useBranches();
  const [picked, setPicked] = useState('');
  const ids = [...new Set((rooms.data?.types ?? []).map((t) => t.branchId))];
  const list = ids.map((id) => ({ id, name: branches.data?.find((x) => x.id === id)?.name ?? '…' }));
  return {
    loading: rooms.isPending,
    list,
    branchId: picked || list[0]?.id || '',
    setBranchId: setPicked,
    types: (rooms.data?.types ?? []).filter((t) => t.branchId === (picked || list[0]?.id)),
    rooms: (rooms.data?.rooms ?? []).filter((r) => r.branchId === (picked || list[0]?.id)),
  };
}

/** The colour of a stay's status (the word is always shown too). */
export const STAY_TONE: Record<StayStatus, 'ok' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  BOOKED: 'info',
  CHECKED_IN: 'ok',
  CHECKED_OUT: 'neutral',
  CANCELLED: 'neutral',
  NO_SHOW: 'bad',
};
export const ROOM_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'over' | 'neutral'> = {
  VACANT_CLEAN: 'ok',
  INSPECTED: 'ok',
  VACANT_DIRTY: 'warn',
  OCCUPIED: 'info',
  OCCUPIED_DIRTY: 'over',
  OUT_OF_ORDER: 'bad',
  OUT_OF_SERVICE: 'neutral',
};
export const dmy = (day: string) => day.split('-').reverse().join('/');
