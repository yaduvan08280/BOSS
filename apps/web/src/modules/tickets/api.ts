import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { StatusTone, TicketAction, TicketStatus } from '@mono/shared';
import { api } from '@/lib/api';

export type TicketRow = {
  id: string;
  number: number;
  title: string;
  description: string;
  raiserId: string;
  solverId: string;
  coordinatorId: string | null;
  status: TicketStatus;
  plannedFixAt: string;
  firstReplyAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  reopenCount: number;
  escalationLevel: number;
  createdAt: string;
  actions: TicketAction[];
};
export type TicketDetail = TicketRow & {
  events: {
    id: string;
    type: string;
    actorId: string | null;
    note: string | null;
    fromStatus: string | null;
    toStatus: string | null;
    fromDate: string | null;
    toDate: string | null;
    createdAt: string;
  }[];
  files: { id: string; originalName: string; mime: string; url: string; uploadedById: string }[];
  proofToResolve: boolean;
  replyDueAt: string | null;
};
export type TicketTab = 'assigned' | 'mine' | 'all';

export const TICKET_TONE: Record<TicketStatus, StatusTone> = {
  OPEN: 'neutral',
  IN_PROGRESS: 'info',
  RESOLVED: 'warn',
  CLOSED: 'ok',
  CANCELLED: 'neutral',
};

export const useTickets = (tab: TicketTab) =>
  useQuery({
    queryKey: ['tickets', tab],
    queryFn: () =>
      api<{
        tickets: TicketRow[];
        counts: { mine: number; assigned: number };
        tiles: { open: number; late: number; escalated: number; waiting: number; closedWeek: number };
        settings: { fixHours: number; proofToResolve: boolean };
      }>(`/api/tickets?tab=${tab}`),
    placeholderData: keepPreviousData,
  });

export const useTicket = (id: string | null) =>
  useQuery({
    queryKey: ['tickets', 'one', id],
    queryFn: () => api<TicketDetail>(`/api/tickets/${id}`),
    enabled: Boolean(id),
  });
