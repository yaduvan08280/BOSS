import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Booking, ReservationStatus, WaitlistStatus } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

/** Phase 16 — reservations, the waitlist and guests: types, queries (polled, so every host sees the same book) and mutations. */
const KEY = ['reservations'];
export type Deposit = { amount: number; state: 'DUE' | 'PAID' | 'USED' | 'KEPT' | 'REFUND_DUE' | 'REFUNDED' };
export type Res = {
  id: string;
  number: string;
  day: string;
  startMin: number;
  time: string;
  durationMin: number;
  partySize: number;
  tableIds: string[];
  tables: string[];
  status: ReservationStatus;
  source: string;
  occasion: string | null;
  requests: string | null;
  note: string | null;
  deposit: Deposit | null;
  orderId: string | null;
  guest: {
    id: string;
    name: string;
    mobile: string;
    allergies: string | null;
    preferences: string | null;
    tags: string[];
  } | null;
};
export type Book = {
  outlet: { id: string; name: string };
  day: string;
  today: string;
  booking: Booking;
  bookingToken: string | null;
  tables: { id: string; name: string; seats: number; combinable: boolean }[];
  counts: { bookings: number; covers: number; toConfirm: number; noShows: number };
  reservations: Res[];
};
export type Slots = {
  durationMin: number;
  deposit: number;
  slots: { startMin: number; time: string; free: boolean; tableIds: string[] | null }[];
};
export type Wait = {
  id: string;
  name: string;
  mobile: string | null;
  partySize: number;
  quotedMin: number | null;
  waitedMin: number;
  status: WaitlistStatus;
  note: string | null;
};
export type Waitlist = { waiting: Wait[]; earlier: Wait[] };
export type Consent = {
  marketing: boolean;
  source: string;
  at: string;
  byId: string | null;
  note?: string | null;
};
export type GuestRow = {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  birthday: string | null;
  anniversary: string | null;
  allergies: string | null;
  preferences: string | null;
  notes: string | null;
  tags: string[];
  consent: Consent | null;
  visits: number;
  lastVisit: string | null;
};
export type GuestProfile = Omit<GuestRow, 'visits' | 'lastVisit'> & {
  consentLog: Consent[];
  history: {
    visits: number;
    spend: number;
    average: number;
    lastVisit: string | null;
    favourites: { name: string; qty: number }[];
    noShows: number;
    cancelled: number;
  };
  recent: { orderId: string; day: string; outlet: string; covers: number; spend: number }[];
  upcoming: { id: string; number: string; when: string; outlet: string; size: number; status: string }[];
};

const usePoll = <T>(key: unknown[], url: string, enabled: boolean, ms: number | false = 10_000) =>
  useQuery({ queryKey: [...KEY, ...key], queryFn: () => api<T>(url), enabled, refetchInterval: ms });
export const useBook = (outletId: string, day: string) =>
  usePoll<Book>(
    ['book', outletId, day],
    `/api/reservations/outlets/${outletId}/book${day ? `?day=${day}` : ''}`,
    Boolean(outletId),
  );
export const useSlots = (outletId: string, day: string, size: number, except?: string) =>
  usePoll<Slots>(
    ['slots', outletId, day, size, except],
    `/api/reservations/outlets/${outletId}/availability?day=${day}&size=${size}${except ? `&except=${except}` : ''}`,
    Boolean(outletId && day && size > 0),
    false,
  );
export const useWaitlist = (outletId: string) =>
  usePoll<Waitlist>(
    ['waitlist', outletId],
    `/api/reservations/outlets/${outletId}/waitlist`,
    Boolean(outletId),
  );
export const useQuote = (outletId: string, size: number) =>
  usePoll<{ minutes: number | null }>(
    ['quote', outletId, size],
    `/api/reservations/outlets/${outletId}/quote?size=${size}`,
    Boolean(outletId && size > 0),
    false,
  );
export const useGuests = (query: string) =>
  usePoll<{ tags: string[]; guests: GuestRow[] }>(['guests', query], `/api/guests${query}`, true, false);
export const useGuest = (id: string | null) =>
  usePoll<GuestProfile>(['guest', id], `/api/guests/${id}`, Boolean(id), false);

export function useResMutation<I, O = unknown>(
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
      void qc.invalidateQueries({ queryKey: ['pos'] });
    },
  });
}
export const send = <T = unknown>(url: string, body: unknown = {}, method = 'POST') =>
  api<T>(url, { method, body });

/** The colour of a booking's status (the word is always shown too). */
export const STATUS_TONE: Record<ReservationStatus, 'ok' | 'warn' | 'bad' | 'over' | 'info' | 'neutral'> = {
  REQUESTED: 'warn',
  CONFIRMED: 'info',
  REMINDED: 'info',
  ARRIVED: 'over',
  SEATED: 'ok',
  FINISHED: 'neutral',
  CANCELLED: 'neutral',
  NO_SHOW: 'bad',
};
