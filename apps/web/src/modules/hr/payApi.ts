import { useQuery } from '@tanstack/react-query';
import {
  formatMoney,
  type EmployeeTerms,
  type PayBasis,
  type PayResult,
  type PayRules,
  type WorkPattern,
} from '@mono/shared';
import { api } from '@/lib/api';

export type TermsRow = {
  user: {
    id: string;
    code: string | null;
    name: string;
    department: string | null;
    designation: string | null;
    shift: string | null;
  };
  saved: boolean;
  terms: EmployeeTerms;
};
export type PayLine = PayResult & {
  user: {
    id: string;
    code: string | null;
    name: string;
    department: string | null;
    designation: string | null;
  };
  ratePaise: number;
  pattern: WorkPattern;
  warnings: ('noRate' | 'noAttendance' | 'unsettled' | 'unrecorded' | 'belowMinimum')[];
  /** The gross shared over the branches worked at this month (phase 12). */
  byBranch?: { branchId: string | null; days: number; paise: number }[];
  currency?: string;
};
export type PaySheet = {
  month: string;
  asOf: string;
  closed: { at: string; by: string | null } | null;
  lines: PayLine[];
  totalPaise: number;
  /** The currency of the total (phase 12): the entity's own, or INR for the whole company. */
  currency?: string;
  /** Currencies with no exchange rate typed for the month: their pay is not in a rupee total. */
  missingRates?: string[];
};
export type Quota = {
  leaveTypeId: string;
  scope: 'designation' | 'person';
  refId: string;
  yearlyQuota: number;
};

/** `?entityId=…` for one legal entity's payroll; nothing for the whole company. */
const forEntity = (entityId: string) => (entityId ? `?entityId=${entityId}` : '');
export const usePaySheet = (month: string, entityId = '') =>
  useQuery({
    queryKey: ['hr', 'pay', month, entityId],
    queryFn: () => api<PaySheet>(`/api/hr/payroll/${month}${forEntity(entityId)}`),
    retry: false,
  });
export const useTerms = () =>
  useQuery({ queryKey: ['hr', 'terms'], queryFn: () => api<TermsRow[]>('/api/hr/terms'), retry: false });
export const usePayRules = () =>
  useQuery({
    queryKey: ['hr', 'payRules'],
    queryFn: () => api<{ rules: PayRules; saved: boolean }>('/api/hr/pay-rules'),
    retry: false,
  });
export const useQuotas = () =>
  useQuery({ queryKey: ['hr', 'quotas'], queryFn: () => api<Quota[]>('/api/hr/leave-quotas'), retry: false });

export const payApi = {
  saveTerms: (userId: string, body: EmployeeTerms) => api(`/api/hr/terms/${userId}`, { method: 'PUT', body }),
  saveRules: (rules: PayRules) => api('/api/hr/pay-rules', { method: 'PUT', body: rules }),
  saveQuotas: (leaveTypeId: string, quotas: Omit<Quota, 'leaveTypeId'>[]) =>
    api(`/api/hr/leave-quotas/${leaveTypeId}`, { method: 'PUT', body: { quotas } }),
  close: (month: string, entityId = '') =>
    api<PaySheet>(`/api/hr/payroll/${month}/close${forEntity(entityId)}`, { method: 'POST' }),
  reopen: (month: string, reason: string, entityId = '') =>
    api<PaySheet>(`/api/hr/payroll/${month}/reopen${forEntity(entityId)}`, {
      method: 'POST',
      body: { reason },
    }),
};

export const inr = (paise: number, currency = 'INR') => formatMoney(Math.round(paise), currency);

/** ₹ from paise for inputs (whole rupees and paise as typed). */
export const rupees = (paise: number) => Math.round(paise) / 100;
export const BASES: PayBasis[] = ['monthly', 'daily', 'hourly'];

/** One CSV of the month: a row a person, a column a line of pay (Excel opens it as it is). */
export function payCsv(sheet: PaySheet, label: (key: string) => string): string {
  const keys = [...new Set(sheet.lines.flatMap((l) => l.lines.map((x) => x.key)))];
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [
    label('code'),
    label('name'),
    label('department'),
    label('basis'),
    label('rate'),
    label('present'),
    label('absent'),
    label('paidLeave'),
    label('offDaysWorked'),
    label('overtimeHours'),
    ...keys.map(label),
    label('gross'),
  ];
  const rows = sheet.lines.map((l) => [
    l.user.code,
    l.user.name,
    l.user.department,
    label(l.basis),
    rupees(l.ratePaise),
    l.counts.present,
    l.counts.absent,
    l.counts.paidLeave,
    l.counts.offDaysWorked,
    l.counts.overtimeHours,
    ...keys.map((k) => rupees(l.lines.find((x) => x.key === k)?.amountPaise ?? 0)),
    rupees(l.grossPaise),
  ]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
