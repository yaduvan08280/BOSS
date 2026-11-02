import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SlipAction, SlipStatus, StatusTone } from '@mono/shared';
import { api } from '@/lib/api';

export type SlipRow = {
  id: string;
  number: number;
  problem: string;
  raiserId: string;
  receiverId: string;
  approverId: string;
  accountableId: string;
  status: SlipStatus;
  taskId: string | null;
  chosenSolutionId: string | null;
  ownSolution: string | null;
  decisionNote: string | null;
  returnCount: number;
  stepSince: string;
  decidedAt: string | null;
  createdAt: string;
  solutions: { id: string; text: string }[];
  waitingOn: { userId: string; dueAt: string } | null;
  actions: SlipAction[];
};
export type SlipDetail = SlipRow & {
  events: {
    id: string;
    type: string;
    actorId: string | null;
    note: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: string;
  }[];
  files: { id: string; originalName: string; mime: string; url: string }[];
  task: { id: string; number: number; status: string; doerId: string } | null;
  solutionsRequired: number;
  delegateWithinHours: number;
};
export type SlipTab = 'inbox' | 'mine' | 'all';

export const SLIP_TONE: Record<SlipStatus, StatusTone> = {
  SUBMITTED: 'info',
  RETURNED: 'warn',
  WITH_APPROVER: 'info',
  APPROVED: 'ok',
  REJECTED: 'bad',
  CLOSED: 'ok',
  WITHDRAWN: 'neutral',
};

export const useSlips = (tab: SlipTab) =>
  useQuery({
    queryKey: ['slips', tab],
    queryFn: () =>
      api<{
        slips: SlipRow[];
        counts: { mine: number; inbox: number };
        tiles: { open: number; withMe: number; late: number; approved: number; rejected: number };
        settings: { solutionsRequired: number };
      }>(`/api/slips?tab=${tab}`),
    placeholderData: keepPreviousData,
  });

export const useSlip = (id: string | null) =>
  useQuery({
    queryKey: ['slips', 'one', id],
    queryFn: () => api<SlipDetail>(`/api/slips/${id}`),
    enabled: Boolean(id),
  });
