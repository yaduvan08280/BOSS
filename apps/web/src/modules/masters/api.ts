import { useQuery } from '@tanstack/react-query';
import type { FlowField, LibraryMaster } from '@mono/shared';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type MasterRows = {
  master: {
    id: string;
    name: string;
    description: string | null;
    fields: FlowField[];
    keyField: string | null;
    displayField: string | null;
    source: string;
  };
  rows: { id: string; key: string | null; label: string; data: Record<string, unknown>; updatedAt: string }[];
  total: number;
  canEdit: boolean;
};
export type MasterOption = { value: string; label: string; sub: string | null };

export const useRows = (id: string) =>
  useQuery({
    queryKey: ['masters', 'rows', id],
    queryFn: () => api<MasterRows>(`/api/masters/${id}/rows`),
    retry: false,
  });
export const useLibrary = () =>
  useQuery({
    queryKey: ['masters', 'library'],
    queryFn: () => api<(LibraryMaster & { have: boolean })[]>('/api/masters/library'),
  });
/** What a "from a master" field offers (searched on the server as you type). */
export const useMasterOptions = (source: string, q: string, enabled = true) =>
  useQuery({
    queryKey: ['masters', 'options', source, q],
    queryFn: () =>
      api<MasterOption[]>(
        `/api/masters/options?source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`,
      ),
    enabled,
    staleTime: 30_000,
  });

export const useMastersMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['masters']], success);

export const mastersApi = {
  saveRow: (master: string, data: object, id?: string) =>
    api<{ id: string; label: string }>(
      id ? `/api/masters/${master}/rows/${id}` : `/api/masters/${master}/rows`,
      { method: id ? 'PUT' : 'POST', body: data },
    ),
  deleteRow: (master: string, id: string) => api(`/api/masters/${master}/rows/${id}`, { method: 'DELETE' }),
  importRows: (master: string, table: string[][]) =>
    api<{ created: number }>(`/api/masters/${master}/import`, { method: 'POST', body: { table } }),
  importSheet: (master: string, url: string) =>
    api<{ created: number }>(`/api/masters/${master}/import-sheet`, { method: 'POST', body: { url } }),
  useLibrary: (key: string) =>
    api<{ id: string; name: string }>(`/api/masters/library/${key}`, { method: 'POST' }),
};
