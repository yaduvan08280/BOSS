import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';
import { listTitle, type Offer } from './offer';

/** A form field that feeds and offers a list. */
export type ListUse = { kind: 'flow' | 'master' | 'recordType'; id: string; name: string; field: string; closed: boolean };
export type ListInfo = {
  key: string;
  /** A named list several forms share (`list:<name>`), not one field's own. */
  shared: boolean;
  name: string;
  values: number;
  hidden: number;
  uses: number;
  /** Some form lets only admins add to it. */
  closed: boolean;
  usedIn: ListUse[];
};
export type ListValue = {
  id: string;
  value: string;
  uses: number;
  hidden: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};
/** How a list is called on the screen: a shared list by its name, a field's own list by the field's label. */
export const titleOf = (l: Pick<ListInfo, 'shared' | 'name'>) => (l.shared ? listTitle(l.name) : l.name);
export type ListName = { name: string; values: number; forms: number };

const enc = encodeURIComponent;

/** What a "remember what people type" field offers, filtered on the server as you type. */
export const useOffer = (key: string, q: string, enabled = true) =>
  useQuery({
    queryKey: ['lists', 'offer', key, q],
    queryFn: () => api<Offer>(`/api/lists/offer?key=${enc(key)}&q=${enc(q)}`),
    enabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

/** The company's named shared lists (for the form editor). */
export const useListNames = (enabled = true) =>
  useQuery({ queryKey: ['lists', 'names'], queryFn: () => api<ListName[]>('/api/lists/names'), enabled });

/** Masters → Lists: every list with its counts and the forms that use it. */
export const useLists = () =>
  useQuery({ queryKey: ['lists', 'all'], queryFn: () => api<ListInfo[]>('/api/lists'), retry: false });

/** Every value of one list, hidden ones too. */
export const useListValues = (key: string) =>
  useQuery({
    queryKey: ['lists', 'values', key],
    queryFn: () => api<{ key: string; values: ListValue[] }>(`/api/lists/values?key=${enc(key)}`),
    retry: false,
  });

export const useListsMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['lists']], success);

export const listsApi = {
  add: (key: string, value: string) =>
    api<{ id: string; value: string }>('/api/lists/values', { method: 'POST', body: { key, value } }),
  change: (id: string, body: { value?: string; hidden?: boolean }) =>
    api<{ id: string; value: string; hidden: boolean }>(`/api/lists/values/${id}`, { method: 'PATCH', body }),
  merge: (id: string, into: string) =>
    api<{ id: string; value: string; uses: number }>(`/api/lists/values/${id}/merge`, {
      method: 'POST',
      body: { into },
    }),
};
