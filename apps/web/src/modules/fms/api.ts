import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { FlowDefinition, FlowField, FlowIssue, FlowStep, StatusTone } from '@mono/shared';
import { api } from '@/lib/api';

export type FlowListItem = {
  id: string;
  code: string;
  name: string;
  runName: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  version: number;
  dirty: boolean;
  departmentIds: string[];
  coordinatorId: string | null;
  solverId: string | null;
  videoUrl: string | null;
  steps: number;
  doers: string[];
  readiness: { score: number; of: number; checks: Record<string, boolean> };
  running: number;
  late: number;
  updatedAt: string;
};
export type FlowDetail = {
  id: string;
  code: string;
  name: string;
  runName: string;
  description: string | null;
  status: FlowListItem['status'];
  version: number;
  dirty: boolean;
  departmentIds: string[];
  coordinatorId: string | null;
  coordinatorBackupId: string | null;
  solverId: string | null;
  solverBackupId: string | null;
  videoUrl: string | null;
  publicEnabled: boolean;
  publicToken: string | null;
  definition: FlowDefinition;
  issues: FlowIssue[];
  readiness: { score: number; of: number; checks: Record<string, boolean> };
  stats: { steps: number; people: number; days: number };
  versions: { id: string; version: number; publishedAt: string }[];
  kpis: KpiCard[];
};
export type KpiCard = {
  id: string;
  label: string;
  source: string;
  aggregation: string;
  period: string;
  value?: number | null;
  previous?: number | null;
};
export type StepRow = {
  id: string;
  recordId: string;
  stepKey: string;
  stepName: string;
  type: FlowStep['type'];
  position: number;
  doerId: string | null;
  originalDoerId: string | null;
  plannedAt: string;
  startedAt: string;
  doneAt: string | null;
  status: 'OPEN' | 'DONE' | 'SKIPPED';
  data: Record<string, unknown>;
  decision: string | null;
  note: string | null;
};
export type RecordRow = {
  id: string;
  number: number;
  title: string;
  status: 'RUNNING' | 'ON_HOLD' | 'CLOSED' | 'CANCELLED';
  startedAt: string;
  closedAt: string | null;
  startedById: string | null;
  holdReason: string | null;
  steps: StepRow[];
  of: number;
  lateMs?: number;
};
export type RecordDetail = RecordRow & {
  data: Record<string, unknown>;
  source: string;
  version: number;
  flow: { id: string; name: string; runName: string; coordinatorId: string | null; solverId: string | null };
  definition: FlowDefinition;
  events: {
    id: string;
    type: string;
    stepKey: string | null;
    actorId: string | null;
    note: string | null;
    createdAt: string;
    data: unknown;
  }[];
  documents: {
    id: string;
    number: string;
    date: string;
    total: number | null;
    status: string;
    type: { name: string };
  }[];
  files: { id: string; entityId: string; originalName: string; mime: string; url: string }[];
  can: { manage: boolean; doSteps: string[] };
};

export const RECORD_TONE: Record<RecordRow['status'], StatusTone> = {
  RUNNING: 'info',
  ON_HOLD: 'warn',
  CLOSED: 'ok',
  CANCELLED: 'neutral',
};

export const useFlows = () =>
  useQuery({ queryKey: ['fms', 'flows'], queryFn: () => api<FlowListItem[]>('/api/fms/flows') });
export const useFlow = (id: string | undefined) =>
  useQuery({
    queryKey: ['fms', 'flow', id],
    queryFn: () => api<FlowDetail>(`/api/fms/flows/${id}`),
    enabled: Boolean(id),
  });
export const useLive = (flowId: string | null, tab: string) =>
  useQuery({
    queryKey: ['fms', 'live', flowId, tab],
    queryFn: () =>
      api<{
        flows: { id: string; code: string; name: string; runName: string }[];
        flow: { id: string; name: string; runName: string } | null;
        stages: { key: string; name: string; type: string; count: number; late: number }[];
        tiles: Record<'running' | 'late' | 'dueToday' | 'onHold' | 'closed', number> | null;
        records: RecordRow[];
      }>(`/api/fms/live?tab=${tab}${flowId ? `&flowId=${flowId}` : ''}`),
    placeholderData: keepPreviousData,
  });
export const useRecord = (id: string | null) =>
  useQuery({
    queryKey: ['fms', 'record', id],
    queryFn: () => api<RecordDetail>(`/api/fms/records/${id}`),
    enabled: Boolean(id),
  });
export const useMyFms = () =>
  useQuery({
    queryKey: ['fms', 'my'],
    queryFn: () =>
      api<{
        steps: (StepRow & {
          late: boolean;
          record: {
            id: string;
            number: number;
            title: string;
            status: string;
            flow: { name: string; runName: string };
          };
        })[];
        owned: (RecordRow & { flow: { name: string } })[];
        flows: { id: string; name: string; runName: string; running: number }[];
      }>('/api/fms/my'),
  });
export const useStartForm = (flowId: string | null) =>
  useQuery({
    queryKey: ['fms', 'startform', flowId],
    queryFn: () =>
      api<{ name: string; runName: string; fields: FlowField[] }>(`/api/fms/flows/${flowId}/start-form`),
    enabled: Boolean(flowId),
  });
