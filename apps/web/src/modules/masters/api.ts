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
  rows: {
    id: string;
    key: string | null;
    label: string;
    data: Record<string, unknown>;
    branchId: string | null;
    updatedAt: string;
  }[];
  total: number;
  canEdit: boolean;
};
/** One choice: the text kept, the link to its row (when it is a row) and the row's other values (auto-fill). */
export type MasterOption = {
  value: string;
  label: string;
  sub: string | null;
  ref?: string;
  columns?: Record<string, unknown>;
};
/** A field of a saved form: the server reads what the field may show from the field itself. */
export type FieldAt = { owner: string; field: string; step?: string; record?: string };
export type SourceColumn = { key: string; label: string };
export type ResolvedLink = { label: string; to: string | null };

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
const query = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

/** What a "from a master" source offers (searched on the server as you type). */
export const useMasterOptions = (source: string, q: string, enabled = true) =>
  useQuery({
    queryKey: ['masters', 'options', source, q],
    queryFn: () => api<MasterOption[]>(`/api/masters/options?${query({ source, q })}`),
    enabled,
    staleTime: 30_000,
  });
/**
 * The choices of one field of a saved form (`at`), else of a whole source. `parent` is the value of the field
 * the choices depend on: it only narrows what the field's own settings allow.
 */
export const useFieldOptions = (
  at: FieldAt | null,
  source: string,
  q: string,
  parent: { value?: string; ref?: string } = {},
  enabled = true,
) =>
  useQuery({
    queryKey: ['masters', 'options', at ?? source, q, parent.value ?? '', parent.ref ?? ''],
    queryFn: () =>
      api<MasterOption[]>(
        `/api/masters/options?${query(at ? { ...at, q, parent: parent.value, parentRef: parent.ref } : { source, q })}`,
      ),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
/** The columns a source's rows carry (the editor's auto-fill and "depends on" pickers). */
export const useSourceColumns = (source: string | undefined) =>
  useQuery({
    queryKey: ['masters', 'columns', source],
    queryFn: () => api<SourceColumn[]>(`/api/masters/columns?${query({ source })}`),
    enabled: Boolean(source),
    staleTime: 60_000,
    retry: false,
  });
/** Links kept on saved values → each one's name today and where it opens. Asked once for a whole record. */
export const useLinks = (refs: string[]) => {
  const sorted = [...new Set(refs)].sort();
  return useQuery({
    queryKey: ['masters', 'links', sorted],
    queryFn: () =>
      api<Record<string, ResolvedLink>>('/api/masters/links', { method: 'POST', body: { refs: sorted } }),
    enabled: sorted.length > 0,
    staleTime: 30_000,
  });
};

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
