import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Frequency } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

export type Master = {
  id: string;
  code: string;
  name: string;
  departmentId: string | null;
  branchId: string | null;
  items: { key: string; text: string; requirePhoto: boolean; requireVoice: boolean; requireValue: boolean }[];
  frequency: Frequency;
  dueTime: string;
  windowHours: number;
  doerIds: string[];
  verifierId: string | null;
  skipHolidays: boolean;
  startDate: string;
  active: boolean;
};
export type Run = {
  id: string;
  masterId: string;
  doerId: string;
  /** A Buddy does the run while its owner is away */
  coveredById: string | null;
  verifierId: string | null;
  plannedAt: string;
  windowEndsAt: string;
  status: 'OPEN' | 'PENDING_VERIFY' | 'DONE' | 'MISSED';
  itemsTotal: number;
  itemsDone: number;
  note: string | null;
  submittedAt: string | null;
  master: { name: string; code: string; departmentId: string | null };
};
export type RunDetail = Run & {
  items: {
    id: string;
    text: string;
    requirePhoto: boolean;
    requireVoice: boolean;
    requireValue: boolean;
    done: boolean;
    value: string | null;
    note: string | null;
    attachmentId: string | null;
  }[];
  files: { id: string; mime: string; url: string }[];
  roles: string[];
  proofRequired: boolean;
};
export type Tiles = {
  all: number;
  dueToday: number;
  doneToday: number;
  overdue: number;
  toVerify: number;
  missed: number;
};

export const useRuns = (scope: 'mine' | 'all') =>
  useQuery({
    queryKey: ['checklists', 'runs', scope],
    queryFn: () =>
      api<{ runs: Run[]; tiles: Tiles; canManage: boolean }>(`/api/checklists/runs?scope=${scope}`),
  });
export const useRun = (id: string | null) =>
  useQuery({
    queryKey: ['checklists', 'run', id],
    queryFn: () => api<RunDetail>(`/api/checklists/runs/${id}`),
    enabled: Boolean(id),
  });
export const useMasters = () =>
  useQuery({ queryKey: ['checklists', 'masters'], queryFn: () => api<Master[]>('/api/checklists/masters') });
export const useMasterChanges = () =>
  useQuery({
    queryKey: ['checklists', 'changes'],
    queryFn: () =>
      api<
        {
          id: string;
          action: string;
          actorName: string | null;
          before: unknown;
          after: unknown;
          createdAt: string;
          entityId: string;
        }[]
      >('/api/checklists/master-changes'),
  });

export function useChecklistMutation<I, O = unknown>(fn: (i: I) => Promise<O>, success?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => success && toast.success(success),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['checklists'] });
      void qc.invalidateQueries({ queryKey: ['work-counts'] });
    },
  });
}
