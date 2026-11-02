import { useQuery } from '@tanstack/react-query';
import type { EaAction, EaSettings, EaStage, StatusTone } from '@mono/shared';
import { api } from '@/lib/api';

export type EaItem = {
  id: string;
  number: number;
  ownerId: string;
  createdById: string;
  text: string;
  note: string | null;
  stage: EaStage;
  kind: 'task' | 'meeting' | 'call' | 'review' | null;
  scheduledDate: string | null;
  slotStart: number | null;
  slotMinutes: number | null;
  waitingOn: string | null;
  taskId: string | null;
  source: string;
  stageChangedAt: string;
  createdAt: string;
  task: { id: string; number: number; status: string } | null;
  actions: EaAction[];
};
export type EaBoard = {
  ownerId: string;
  owners: { id: string; name: string }[];
  settings: EaSettings;
  counts: Record<EaStage, number>;
  items: EaItem[];
};

export const EA_TONE: Record<EaStage, StatusTone> = {
  CAPTURED: 'warn',
  INFORMATION: 'neutral',
  SOMEDAY: 'neutral',
  WAITING: 'over',
  SCHEDULED: 'info',
  DELEGATED: 'info',
  DONE: 'ok',
  CLOSED: 'neutral',
};

/** Dropping a card on a column = this action (schedule and delegate ask for details first). */
export const DROP_ACTION: Partial<Record<EaStage, EaAction>> = {
  INFORMATION: 'toInformation',
  SOMEDAY: 'toSomeday',
  WAITING: 'toWaiting',
  SCHEDULED: 'schedule',
  DELEGATED: 'delegate',
  DONE: 'done',
};

export const useEaBoard = (ownerId: string | null) =>
  useQuery({
    queryKey: ['ea', 'board', ownerId],
    queryFn: () => api<EaBoard>(`/api/ea/board${ownerId ? `?ownerId=${ownerId}` : ''}`),
  });
