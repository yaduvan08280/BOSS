import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OrgDepartment, OrgPerson, SystemSummary } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

export type Shift = {
  id: string;
  name: string;
  start: string;
  end: string;
  weekdays: number[];
  isDefault: boolean;
  overnight: boolean;
  people: number;
};
export type Branch = {
  id: string;
  name: string;
  code: string | null;
  parentId: string | null;
  city: string | null;
  state: string | null;
  isDefault: boolean;
  people: number;
};
export type Designation = { id: string; name: string; color: string | null; people: number };
export type Role = {
  id: string;
  name: string;
  key: string | null;
  permissions: string[];
  people: number;
  builtIn: boolean;
};
export type Contact = { id: string; role: string; name: string; phone: string | null; email: string | null };
export type CompanyProfile = {
  id: string;
  name: string;
  legalName: string | null;
  city: string | null;
  state: string | null;
  ownerName: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  cin: string | null;
  gstin: string | null;
  pan: string | null;
};

const ORG = ['org'] as const;
export const keys = {
  summary: ['summary'] as const,
  company: [...ORG, 'company'] as const,
  shifts: [...ORG, 'shifts'] as const,
  branches: [...ORG, 'branches'] as const,
  designations: [...ORG, 'designations'] as const,
  departments: [...ORG, 'departments'] as const,
  users: [...ORG, 'users'] as const,
  roles: [...ORG, 'roles'] as const,
};

export const useSummary = () =>
  useQuery({ queryKey: keys.summary, queryFn: () => api<SystemSummary>('/api/system/summary') });
export const useCompany = () =>
  useQuery({
    queryKey: keys.company,
    queryFn: () =>
      api<{ profile: CompanyProfile; contacts: Contact[]; gstProvider: string | null }>('/api/org/company'),
  });
export const useShifts = () =>
  useQuery({ queryKey: keys.shifts, queryFn: () => api<Shift[]>('/api/org/shifts') });
export const useBranches = () =>
  useQuery({ queryKey: keys.branches, queryFn: () => api<Branch[]>('/api/org/branches') });
export const useDesignations = () =>
  useQuery({ queryKey: keys.designations, queryFn: () => api<Designation[]>('/api/org/designations') });
export const useDepartments = () =>
  useQuery({ queryKey: keys.departments, queryFn: () => api<OrgDepartment[]>('/api/org/departments') });
export const useUsers = () =>
  useQuery({ queryKey: keys.users, queryFn: () => api<OrgPerson[]>('/api/org/users') });
export const useRoles = () =>
  useQuery({
    queryKey: keys.roles,
    queryFn: () => api<{ roles: Role[]; modules: string[]; actions: string[] }>('/api/org/roles'),
  });

export function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong';
}

/**
 * Any org change: call the API, then refresh everything org-related and the header cards.
 * Errors show as a toast unless the caller handles them.
 */
export function useOrgMutation<I, O = unknown>(
  request: (input: I) => Promise<O>,
  opts: { success?: string | ((out: O) => string | undefined); silentError?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (out) => {
      const msg = typeof opts.success === 'function' ? opts.success(out) : opts.success;
      if (msg) toast.success(msg);
    },
    onError: (err) => {
      if (!opts.silentError) toast.error(errorMessage(err));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ORG });
      void qc.invalidateQueries({ queryKey: keys.summary });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export const post = <O>(url: string, body?: unknown) => api<O>(url, { method: 'POST', body: body ?? {} });
export const patch = <O>(url: string, body: unknown) => api<O>(url, { method: 'PATCH', body });
export const put = <O>(url: string, body: unknown) => api<O>(url, { method: 'PUT', body });
export const del = <O>(url: string) => api<O>(url, { method: 'DELETE' });
