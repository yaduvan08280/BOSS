import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReportDefinition, ReportField, ReportInput, ReportKind, ReportSchedule } from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type ReportSource = { kind: 'flow' | 'recordType'; id: string; name: string; code: string };
export type ReportResult = {
  source: { kind: string; id: string; name: string };
  grouped: boolean;
  columns: { key: string; label: string; kind: ReportKind }[];
  rows: (string | number | null)[][];
  ids: string[] | null;
  totals: (number | null)[] | null;
  measures: string[];
  total: number;
  pending: string[];
};
export type SavedReport = {
  id: string;
  name: string;
  definition: ReportDefinition;
  sharedRoles: string[];
  schedule: ReportSchedule | null;
  mine: boolean;
  owner: string | null;
  canEdit: boolean;
  updatedAt: string;
};

export const sourceKey = (s: { kind: string; id: string }) => `${s.kind}:${s.id}`;

export const useReportSources = () =>
  useQuery({ queryKey: ['reports', 'sources'], queryFn: () => api<ReportSource[]>('/api/reports/sources') });
export const useReportFields = (source: { kind: string; id: string } | undefined) =>
  useQuery({
    queryKey: ['reports', 'fields', source ? sourceKey(source) : ''],
    queryFn: () =>
      api<{ name: string; fields: ReportField[] }>(`/api/reports/fields?source=${sourceKey(source!)}`),
    enabled: Boolean(source?.id),
    retry: false,
  });
export const useReports = () =>
  useQuery({
    queryKey: ['reports', 'list'],
    queryFn: () => api<{ reports: SavedReport[]; canCreate: boolean }>('/api/reports'),
  });
export const useReport = (id: string | undefined) =>
  useQuery({
    queryKey: ['reports', 'one', id],
    queryFn: () => api<SavedReport>(`/api/reports/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
/** The builder's live preview: runs the definition as it stands (only when it can run). */
export const usePreview = (definition: ReportDefinition | null) =>
  useQuery({
    queryKey: ['reports', 'preview', JSON.stringify(definition)],
    queryFn: () => api<ReportResult>('/api/reports/run', { method: 'POST', body: { definition } }),
    enabled: Boolean(definition),
    placeholderData: keepPreviousData,
    retry: false,
  });
export const useSavedRun = (id: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['reports', 'run', id],
    queryFn: () => api<{ name: string; result: ReportResult }>(`/api/reports/${id}/run`),
    enabled: Boolean(id) && enabled,
    retry: false,
  });

export const useReportsMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['reports']], success);

export const reportsApi = {
  create: (input: ReportInput) => api<{ id: string }>('/api/reports', { method: 'POST', body: input }),
  update: (id: string, input: ReportInput) =>
    api<{ id: string }>(`/api/reports/${id}`, { method: 'PUT', body: input }),
  remove: (id: string) => api(`/api/reports/${id}`, { method: 'DELETE' }),
  exportUrl: (id: string, format: 'xlsx' | 'pdf' | 'csv') => `/api/reports/${id}/export?format=${format}`,
};
