import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  RecordAccess,
  RecordDefinition,
  RecordIcon,
  RecordMenu,
  RecordPermissions,
  RecordTypeInput,
  RecordTypePatch,
  RecordTypeStatus,
  RecordViewConfig,
} from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type RecordTypeView = {
  id: string;
  name: string;
  pluralName: string;
  code: string | null;
  prefix: string;
  description: string | null;
  status: RecordTypeStatus;
  definition: RecordDefinition;
  menu: RecordMenu;
  access: RecordAccess;
  /** Only for the people who set the type up. */
  permissions?: RecordPermissions;
  updatedAt: string;
  records?: number;
};
export type MenuEntry = { id: string; name: string; section: string; icon: RecordIcon; path: string };
export type RecordRow = {
  id: string;
  code: string;
  title: string;
  status: string;
  createdAt: string;
  createdBy: string | null;
  data: Record<string, unknown>;
};
export type RecordList = {
  columns: string[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<string, number>;
  rows: RecordRow[];
};
export type SavedView = {
  id: string;
  name: string;
  shared: boolean;
  mine: boolean;
  config: RecordViewConfig;
};
export type RecordFile = {
  id: string;
  url: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
  inField: boolean;
};
export type RecordEventRow = {
  id: string;
  type: 'created' | 'changed' | 'status' | 'note' | 'file' | 'file_removed' | 'flow_started' | 'deleted';
  at: string;
  by: string | null;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  data: {
    fields?: string[];
    files?: string[];
    label?: string;
    from?: string;
    to?: string;
    imported?: boolean;
    /** `flow_started`: the process a move started, and its record. */
    flow?: string;
    number?: number;
    fmsRecordId?: string;
  } | null;
};
export type RecordDetail = {
  type: RecordTypeView;
  record: {
    id: string;
    code: string;
    title: string;
    status: string;
    data: Record<string, unknown>;
    lines: Record<string, Record<string, unknown>[]>;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  };
  moves: { action: string; label: string; to: string; noteRequired: boolean }[];
  can: { edit: boolean; files: boolean; delete: boolean };
  events: RecordEventRow[];
  files: RecordFile[];
};
export type ListParams = RecordViewConfig & { page?: number; pageSize?: number };

/** The list's query string: lists are comma-separated, the field filters travel as JSON. */
export function listQuery(p: ListParams, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (p.q?.trim()) q.set('q', p.q.trim());
  if (p.status?.length) q.set('status', p.status.join(','));
  if (p.from) q.set('from', p.from);
  if (p.to) q.set('to', p.to);
  if (p.filters?.length) q.set('filters', JSON.stringify(p.filters));
  if (p.sort) q.set('sort', p.sort);
  if (p.dir) q.set('dir', p.dir);
  if (p.columns?.length) q.set('columns', p.columns.join(','));
  if (p.page) q.set('page', String(p.page));
  if (p.pageSize) q.set('pageSize', String(p.pageSize));
  return q.toString();
}

export const useRecordMenu = () =>
  useQuery({
    queryKey: ['records', 'menu'],
    queryFn: () => api<MenuEntry[]>('/api/records/menu'),
    staleTime: 60_000,
  });
export const useRecordTypes = () =>
  useQuery({
    queryKey: ['records', 'types'],
    queryFn: () => api<{ types: RecordTypeView[]; canAdmin: boolean }>('/api/records/types'),
  });
export const useRecordType = (id: string, enabled = true) =>
  useQuery({
    queryKey: ['records', 'type', id],
    queryFn: () => api<RecordTypeView>(`/api/records/types/${id}`),
    enabled: enabled && Boolean(id),
    retry: false,
  });
export const useRecordList = (typeId: string, params: ListParams) =>
  useQuery({
    queryKey: ['records', 'list', typeId, params],
    queryFn: () => api<RecordList>(`/api/records/types/${typeId}/records?${listQuery(params)}`),
    placeholderData: keepPreviousData,
    retry: false,
  });
export const useRecordViews = (typeId: string) =>
  useQuery({
    queryKey: ['records', 'views', typeId],
    queryFn: () => api<SavedView[]>(`/api/records/types/${typeId}/views`),
  });
export const useRecord = (id: string) =>
  useQuery({
    queryKey: ['records', 'entry', id],
    queryFn: () => api<RecordDetail>(`/api/records/entries/${id}`),
    retry: false,
  });

/** A published process a move may start, with its start form (type editor → Statuses & moves). */
export type StartableFlow = {
  id: string;
  code: string;
  name: string;
  startFields: { key: string; label: string; type: string; required: boolean; master: string | null }[];
};
export const useStartableFlows = () =>
  useQuery({
    queryKey: ['records', 'flows'],
    queryFn: () => api<StartableFlow[]>('/api/records/flows'),
    retry: false,
  });

/** A change to records or types: the usual toasts, and every records query (lists, menu, drawer) refreshed. */
export const useRecordsMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['records']], success);

type Body = { data: Record<string, unknown>; lines?: Record<string, unknown[]>; branchId?: string | null };
const post = <T>(url: string, body?: unknown) => api<T>(url, { method: 'POST', body: body ?? {} });

export const recordsApi = {
  createType: (input: RecordTypeInput) => post<{ id: string }>('/api/records/types', input),
  updateType: (id: string, patch: RecordTypePatch) =>
    api<{ id: string }>(`/api/records/types/${id}`, { method: 'PATCH', body: patch }),
  archiveType: (id: string) => post(`/api/records/types/${id}/archive`),
  restoreType: (id: string) => post(`/api/records/types/${id}/restore`),
  deleteType: (id: string) => api(`/api/records/types/${id}`, { method: 'DELETE' }),
  create: (typeId: string, body: Body) =>
    post<{ id: string; code: string }>(`/api/records/types/${typeId}/records`, body),
  update: (id: string, body: Body) =>
    api<{ id: string; code: string; changed: string[] }>(`/api/records/entries/${id}`, {
      method: 'PATCH',
      body,
    }),
  move: (id: string, action: string, note?: string) =>
    post<{ status: string }>(`/api/records/entries/${id}/move`, { action, note: note || undefined }),
  note: (id: string, note: string) => post(`/api/records/entries/${id}/notes`, { note }),
  remove: (id: string) => api(`/api/records/entries/${id}`, { method: 'DELETE' }),
  addFiles: (id: string, ids: string[]) => post(`/api/records/entries/${id}/files`, { ids }),
  removeFile: (id: string, fileId: string) =>
    api(`/api/records/entries/${id}/files/${fileId}`, { method: 'DELETE' }),
  importTable: (typeId: string, table: string[][]) =>
    post<{ created: number; from: string; to: string }>(`/api/records/types/${typeId}/import`, { table }),
  saveView: (
    typeId: string,
    input: { name: string; shared: boolean; config: RecordViewConfig },
    id?: string,
  ) =>
    api<SavedView>(`/api/records/types/${typeId}/views${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      body: input,
    }),
  deleteView: (typeId: string, id: string) =>
    api(`/api/records/types/${typeId}/views/${id}`, { method: 'DELETE' }),
};

/** Download the current list (the same filters as the screen) as CSV or Excel. */
export async function downloadExport(
  typeId: string,
  params: ListParams,
  format: 'csv' | 'xlsx',
  all: boolean,
) {
  const { page: _p, pageSize: _s, ...rest } = params;
  const res = await fetch(
    `/api/records/types/${typeId}/export?${listQuery(rest, { format, ...(all ? { all: '1' } : {}) })}`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? 'Export failed');
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `records.${format}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
