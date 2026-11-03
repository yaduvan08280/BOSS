import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { KpiKey, KpiState, TaskAction, TaskActionInput, TaskStatus } from '@mono/shared';
import { api, ApiError } from '@/lib/api';

export type TaskRow = {
  id: string;
  number: number;
  description: string;
  doerId: string;
  creatorId: string;
  verifierId: string | null;
  ownVerifierId: string | null;
  plannedAt: string;
  originalPlannedAt: string;
  status: TaskStatus;
  requireProof: boolean;
  revisionCount: number;
  reopenCount: number;
  acceptedAt: string | null;
  doneAt: string | null;
  doneNote: string | null;
  verifiedAt: string | null;
  coveredById: string | null;
  passCount: number;
  files: number;
  notes: number;
  actions: TaskAction[];
  createdAt: string;
};
export type TaskDetail = Omit<TaskRow, 'files' | 'notes'> & {
  events: {
    id: string;
    type: string;
    actorId: string | null;
    fromUserId: string | null;
    toUserId: string | null;
    note: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    fromDate: string | null;
    toDate: string | null;
    createdAt: string;
  }[];
  files: { id: string; mime: string; originalName: string; url: string; createdAt: string }[];
};
export type TaskQuery = {
  scope?: 'mine' | 'team' | 'all';
  tab: 'pending' | 'verification' | 'done' | 'all';
  q?: string;
  from?: string;
  to?: string;
  doerId?: string;
};
export type ScoreRow = {
  personId: string;
  name: string;
  lines: {
    kpi: KpiKey;
    benchmark: number;
    lastWeekPct: number | null;
    planned: number;
    actual: number;
    actualPct: number | null;
    nextTarget: number;
    state: KpiState;
  }[];
};
export type RygRow = {
  personId: string;
  name: string;
  total: number;
  green: number;
  yellow: number;
  red: number;
  open: number;
  pctGreen: number;
  pctYellow: number;
  pctRed: number;
};

const qs = (o: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => Boolean(e[1]))).toString();

export const useTasks = (q: TaskQuery) =>
  useQuery({
    queryKey: ['tasks', 'list', q],
    queryFn: () =>
      api<{
        scope: TaskQuery['scope'];
        counts: Record<'pending' | 'verification' | 'done', number>;
        tasks: TaskRow[];
      }>(`/api/tasks?${qs(q)}`),
    placeholderData: keepPreviousData,
  });
export const useTiles = () =>
  useQuery({
    queryKey: ['tasks', 'tiles'],
    queryFn: () =>
      api<{
        pending: number;
        overdue: number;
        toVerify: number;
        verifyLate: number;
        verifySlaMinutes: number;
        doneThisWeek: number;
        doneOnTime: number;
        score: number | null;
      }>('/api/tasks/tiles'),
  });
export const useTask = (id: string | null) =>
  useQuery({
    queryKey: ['tasks', 'one', id],
    queryFn: () => api<TaskDetail>(`/api/tasks/${id}`),
    enabled: Boolean(id),
  });
export const useScorecard = (at: string) =>
  useQuery({
    queryKey: ['tasks', 'scorecard', at],
    queryFn: () =>
      api<{ week: { start: string; end: string }; rows: ScoreRow[] }>(
        `/api/tasks/reports/scorecard?${qs({ at })}`,
      ),
  });
export const useRyg = (from: string, to: string) =>
  useQuery({
    queryKey: ['tasks', 'ryg', from, to],
    queryFn: () => api<RygRow[]>(`/api/tasks/reports/ryg?${qs({ from, to })}`),
  });

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  void qc.invalidateQueries({ queryKey: ['work-counts'] });
  void qc.invalidateQueries({ queryKey: ['me'] });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TaskActionInput }) =>
      api<TaskRow>(`/api/tasks/${id}/actions`, { method: 'POST', body: input }),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => invalidate(qc),
  });
}

export function useTaskMutation<I, O = unknown>(fn: (input: I) => Promise<O>, success?: (o: O) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (o) => success && toast.success(success(o)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => invalidate(qc),
  });
}

/** Actions that need words (or a date/person) before they happen. The rest run straight from the button. */
export const DIALOG_ACTIONS: TaskAction[] = [
  'decline',
  'moveDate',
  'addFollowUp',
  'markDone',
  'reject',
  'reopen',
  'reassign',
  'passOn',
  'cancel',
];
