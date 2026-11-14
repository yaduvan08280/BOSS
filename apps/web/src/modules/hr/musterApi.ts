import { useQuery } from '@tanstack/react-query';
import type { AttendanceStatus } from '@mono/shared';
import { api } from '@/lib/api';

export type MusterCell = {
  date: string;
  code: string;
  status: AttendanceStatus | null;
  inAt: string | null;
  outAt: string | null;
  workedMin: number;
  lateMin: number;
  overtimeMin: number;
  missedOut: boolean;
  live: boolean;
  blank: boolean;
  punches: { type: string; at: string; flagged: boolean; source: string }[];
  reasons: string[];
};
export type MusterTotals = {
  present: number;
  late: number;
  halfDays: number;
  absent: number;
  leave: number;
  weeklyOffs: number;
  holidays: number;
  noRecord: number;
  workedMin: number;
  lateMin: number;
  overtimeMin: number;
};
export type MusterPerson = {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  designation: string | null;
  branch: string | null;
  shift: string;
  cells: MusterCell[];
  totals: MusterTotals;
};
export type Muster = {
  month: string;
  company: string;
  tz: string;
  days: { date: string; weekday: number }[];
  people: MusterPerson[];
};
export type MusterFilter = { month: string; departmentId: string; branchId: string };

const qs = (f: MusterFilter, more: Record<string, string> = {}) =>
  new URLSearchParams(
    Object.entries({ month: f.month, departmentId: f.departmentId, branchId: f.branchId, ...more }).filter(
      ([, v]) => v,
    ),
  ).toString();

export const useMuster = (f: MusterFilter) =>
  useQuery({
    queryKey: ['hr', 'muster', f.month, f.departmentId, f.branchId],
    queryFn: () => api<Muster>(`/api/hr/attendance/muster?${qs(f)}`),
    retry: false,
  });

/** A download link: the browser saves what the server sends (Excel, CSV or PDF). */
export const musterExport = (f: MusterFilter, kind: 'muster' | 'punches', format: 'xlsx' | 'csv' | 'pdf') =>
  `/api/hr/attendance/muster/export?${qs(f, { kind, format })}`;

/** The colour of a muster code: same fixed status colours as everywhere else. */
export function codeTone(c: MusterCell): string {
  if (c.blank || !c.code) return '';
  if (c.code.includes('/P')) return 'bg-status-ok-bg text-status-ok-fg';
  switch (c.status) {
    case 'PRESENT':
      return 'bg-status-ok-bg text-status-ok-fg';
    case 'LATE':
      return 'bg-status-warn-bg text-status-warn-fg';
    case 'HALF_DAY':
      return 'bg-status-over-bg text-status-over-fg';
    case 'ABSENT':
      return 'bg-status-bad-bg text-status-bad-fg';
    case 'ON_LEAVE':
      return 'bg-status-info-bg text-status-info-fg';
    case 'HOLIDAY':
    case 'WEEKLY_OFF':
      return 'bg-status-neutral-bg text-status-neutral-fg';
    default:
      return 'text-muted-foreground';
  }
}

export const hm = (min: number) =>
  min ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : '—';
