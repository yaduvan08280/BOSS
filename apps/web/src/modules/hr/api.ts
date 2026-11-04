import { useQuery } from '@tanstack/react-query';
import type { AttendanceStatus, HrRules, WorkPattern } from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type AttendanceDayRow = {
  date: string;
  status: AttendanceStatus;
  inAt: string | null;
  outAt: string | null;
  workedMin: number;
  lateMin: number;
  overtimeMin: number;
  missedOut: boolean;
  compOff: boolean;
  reasons: string[];
};
export type MonthView = {
  person: {
    id: string;
    name: string;
    shift: { start: number; end: number };
    pattern?: WorkPattern;
    weeklyHours?: number | null;
  };
  days: AttendanceDayRow[];
  today: {
    date: string;
    status: AttendanceStatus;
    inAt: string | null;
    outAt: string | null;
    workedMinutes: number;
    lateMinutes: number;
    reasons: string[];
    final: boolean;
  } | null;
  punches: {
    id: string;
    type: 'IN' | 'OUT';
    at: string;
    flagged: boolean;
    flagReason: string | null;
    source: string;
  }[];
  corrections: { used: number; limit: number };
  selfie: boolean;
};
export type TeamRow = {
  id: string;
  name: string;
  code: string | null;
  department: string | null;
  status: AttendanceStatus;
  inAt: string | null;
  outAt: string | null;
  lateMin: number;
  settled: boolean;
  flags: { type: string; at: string; flagReason: string | null }[];
};
export type Correction = {
  id: string;
  userId: string;
  date: string;
  inAt: string | null;
  outAt: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string | null;
  createdAt: string;
};
export type LeaveType = {
  id: string;
  code: string;
  name: string;
  yearlyQuota: string;
  carryForward: string;
  paid: boolean;
  active: boolean;
};
export type Balance = {
  leaveTypeId: string;
  code: string;
  name: string;
  paid: boolean;
  allotted: number;
  carried: number;
  used: number;
  pending: number;
  available: number;
};
export type Suggestion = { id: string; name: string; designation: string | null };
export type PreviewItem = {
  key: string;
  entityType: string;
  entityId: string;
  title: string;
  due: string | null;
  suggestions: Suggestion[];
};
export type LeavePreview = {
  days: number;
  needsBuddy: boolean;
  rule: 'block' | 'warn' | 'off';
  items: PreviewItem[];
};
export type BuddyRow = {
  id: string;
  buddyId: string;
  status: 'ASKED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
  items: { key: string; title: string }[];
  note: string | null;
};
export type LeaveRow = {
  id: string;
  number: number;
  userId: string;
  type: string;
  from: string;
  to: string;
  half: 'FIRST' | 'SECOND' | null;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  approvedWithoutCover: boolean;
  decisionNote: string | null;
  buddies: BuddyRow[];
  uncovered: { key: string; title: string }[];
  createdAt: string;
};
export type BuddyAsk = {
  id: string;
  userId: string;
  status: BuddyRow['status'];
  items: { key: string; title: string }[];
  from: string;
  to: string;
  dueAt: string;
  note: string | null;
  leaveRequestId: string | null;
};
export type CoverItem = {
  key: string;
  entityType: string;
  title: string;
  due: string | null;
  state: 'covered' | 'accepted' | 'asked' | 'none';
  buddy: { id: string; name: string } | null;
  suggestions: Suggestion[];
};
export type CoverBoard = {
  date: string;
  away: {
    person: { id: string; name: string; department: string | null };
    reason: 'leave' | 'absent';
    leave: { id: string; type: string; from: string; to: string; half: string | null } | null;
    items: CoverItem[];
  }[];
  counts: { away: number; work: number; uncovered: number };
};
export type HrCalendar = {
  holidays: {
    id: string;
    date: string;
    name: string;
    type: string;
    halfDay: boolean;
    branchId: string | null;
  }[];
  weeklyOffs: { weekday: number; kind: 'WORKING' | 'HALF' | 'OFF'; branchId: string | null }[];
  branches: { id: string; name: string }[];
};

const KEYS = [['hr']];
export const useHrMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, KEYS, success);

export const useHrRules = () =>
  useQuery({
    queryKey: ['hr', 'rules'],
    queryFn: () => api<{ rules: HrRules; saved: boolean }>('/api/hr/rules'),
  });
export const useMonth = (month: string, userId?: string) =>
  useQuery({
    queryKey: ['hr', 'month', month, userId ?? 'me'],
    queryFn: () =>
      api<MonthView>(`/api/hr/attendance/month?month=${month}${userId ? `&userId=${userId}` : ''}`),
  });
export const useTeamDay = (date: string, enabled = true) =>
  useQuery({
    queryKey: ['hr', 'team', date],
    queryFn: () => api<{ date: string; rows: TeamRow[] }>(`/api/hr/attendance/team?date=${date}`),
    enabled,
    retry: false,
  });
export const useCorrections = () =>
  useQuery({
    queryKey: ['hr', 'corrections'],
    queryFn: () => api<{ mine: Correction[]; toDecide: Correction[] }>('/api/hr/corrections'),
  });
export const useLeaveTypes = () =>
  useQuery({ queryKey: ['hr', 'types'], queryFn: () => api<LeaveType[]>('/api/hr/leave/types') });
export const useBalances = (date: string) =>
  useQuery({
    queryKey: ['hr', 'balances', date],
    queryFn: () => api<{ year: number; balances: Balance[] }>(`/api/hr/leave/balances?date=${date}`),
  });
export const useLeavePreview = (from: string, to: string, half: string) =>
  useQuery({
    queryKey: ['hr', 'preview', from, to, half],
    queryFn: () =>
      api<LeavePreview>(`/api/hr/leave/preview?from=${from}&to=${to}${half ? `&half=${half}` : ''}`),
    enabled: Boolean(from && to && to >= from),
  });
export const useLeaveLists = () =>
  useQuery({
    queryKey: ['hr', 'leave'],
    queryFn: () => api<{ mine: LeaveRow[]; toDecide: LeaveRow[]; asks: BuddyAsk[] }>('/api/hr/leave'),
  });
export const useCoverBoard = (date: string) =>
  useQuery({
    queryKey: ['hr', 'cover', date],
    queryFn: () => api<CoverBoard>(`/api/hr/cover?date=${date}`),
    retry: false,
  });
export const useHrCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: ['hr', 'calendar', from, to],
    queryFn: () => api<HrCalendar>(`/api/hr/calendar?from=${from}&to=${to}`),
  });

export const hrApi = {
  saveRules: (rules: HrRules) => api('/api/hr/rules', { method: 'PUT', body: rules }),
  punch: (body: object) =>
    api<{ date: string; day: { status: AttendanceStatus } }>('/api/hr/punch', { method: 'POST', body }),
  correction: (body: object) => api('/api/hr/corrections', { method: 'POST', body }),
  decideCorrection: (id: string, approve: boolean, note?: string) =>
    api(`/api/hr/corrections/${id}/decide`, { method: 'POST', body: { approve, note } }),
  importPunches: (csv: string) =>
    api<{ added: number; skipped: number; unknownCodes: string[]; badLines: number[] }>(
      '/api/hr/attendance/import',
      {
        method: 'POST',
        body: { csv },
      },
    ),
  applyLeave: (body: object) =>
    api<{ id: string; status: string }>('/api/hr/leave', { method: 'POST', body }),
  decideLeave: (id: string, approve: boolean, note?: string) =>
    api<{ withoutCover: boolean }>(`/api/hr/leave/${id}/decide`, { method: 'POST', body: { approve, note } }),
  cancelLeave: (id: string) => api(`/api/hr/leave/${id}/cancel`, { method: 'POST' }),
  askBuddy: (id: string, keys: string[], buddyId: string) =>
    api(`/api/hr/leave/${id}/buddy`, { method: 'POST', body: { keys, buddyId } }),
  answerBuddy: (id: string, accept: boolean, note?: string) =>
    api(`/api/hr/buddy/${id}/answer`, { method: 'POST', body: { accept, note } }),
  cover: (body: { userId: string; keys: string[]; buddyId: string; date: string }) =>
    api<{ covered: number }>('/api/hr/cover', { method: 'POST', body }),
  saveHoliday: (body: object, id?: string) =>
    api(id ? `/api/hr/holidays/${id}` : '/api/hr/holidays', { method: id ? 'PUT' : 'POST', body }),
  deleteHoliday: (id: string) => api(`/api/hr/holidays/${id}`, { method: 'DELETE' }),
  saveWeeklyOffs: (body: object) => api('/api/hr/weekly-offs', { method: 'PUT', body }),
};

/** Status → chip tone and short label key. */
export const STATUS_TONE: Record<AttendanceStatus, 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'over'> = {
  PRESENT: 'ok',
  LATE: 'warn',
  HALF_DAY: 'over',
  ABSENT: 'bad',
  ON_LEAVE: 'info',
  HOLIDAY: 'neutral',
  WEEKLY_OFF: 'neutral',
};

/** 150 → "2.5 h", 30 → "30 min" */
export const hm = (min: number) => (min >= 60 ? `${Math.round((min / 60) * 10) / 10} h` : `${min} min`);
