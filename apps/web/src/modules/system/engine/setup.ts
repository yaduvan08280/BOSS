/**
 * "Set up this process" for every process that is not one of the five engine modules (decision 239). Nothing here
 * is a new store: each field is a rule the company already has (HR rules, stock rules, the CRM set-up, a property's
 * hotel rules …), read and saved through that area's own API, so the server already runs by it. The Business Engine
 * only gathers, per process, the rules that change that process, next to its chart.
 */
import { api } from '@/lib/api';
import type { ScopeKind, SourceId } from './setup-fields';
export * from './setup-fields';

type Rules = Record<string, unknown>;

type Source = {
  scope?: ScopeKind;
  read: (scopeId: string) => Promise<Rules>;
  /** Saves the changed paths (`next` is the whole rule set with them applied). */
  save: (next: Rules, changed: string[], scopeId: string) => Promise<unknown>;
  /** Query keys of the area's own screens, refreshed after a save. */
  keys: string[][];
  /** The area's full settings screen, where there is one. */
  more?: string;
};

/** The top-level parts of the rules that changed: most areas save a whole part at a time. */
const tops = (changed: string[]) => [...new Set(changed.map((p) => p.split('.')[0]!))];
const pickTops = (next: Rules, changed: string[]) =>
  Object.fromEntries(tops(changed).map((k) => [k, next[k]]));
const put = (url: string, body: unknown) => api(url, { method: 'PUT', body });

/** Which CRM set-up page holds each part (the API takes one page at a time). */
const CRM_PAGE: Record<string, string> = {
  seats: 'seats',
  split: 'split',
  customers: 'customerRules',
  nbd: 'nbd',
};

export const SOURCES: Record<SourceId, Source> = {
  hr: {
    read: async () => (await api<{ rules: Rules }>('/api/hr/rules')).rules,
    // The HR rules are saved whole (they keep their own history of changes).
    save: (next) => put('/api/hr/rules', next),
    keys: [['hr']],
    more: '/system/hr-rules',
  },
  ims: {
    read: async () => (await api<{ rules: Rules }>('/api/ims/rules')).rules,
    save: (next, changed) => put('/api/ims/rules', pickTops(next, changed)),
    keys: [['ims']],
    more: '/system/inventory',
  },
  crm: {
    read: async () => (await api<{ config: Rules }>('/api/crm/setup')).config,
    save: async (next, changed) => {
      for (const top of tops(changed))
        await put('/api/crm/setup', { page: CRM_PAGE[top], patch: { [top]: next[top] } });
    },
    keys: [['crm']],
    more: '/crm/setup',
  },
  hosp: {
    read: async () => (await api<{ rules: Rules }>('/api/hosp/settings')).rules,
    save: (next, changed) => put('/api/hosp/settings', { rules: pickTops(next, changed) }),
    keys: [['hosp']],
    more: '/system/hospitality',
  },
  hotel: {
    scope: 'property',
    read: async (id) => (await api<{ rules: Rules }>(`/api/hotel/rules?branchId=${id}`)).rules,
    save: (next, changed, id) => put(`/api/hotel/rules?branchId=${id}`, pickTops(next, changed)),
    keys: [['hotel']],
  },
  branch: {
    scope: 'branch',
    read: async (id) => (await api<{ rules: Rules }>(`/api/hosp/branch-rules?branchId=${id}`)).rules,
    save: (next, changed, id) => put(`/api/hosp/branch-rules?branchId=${id}`, pickTops(next, changed)),
    keys: [['banquet']],
  },
  booking: {
    scope: 'outlet',
    read: async (id) => (await api<{ booking: Rules }>(`/api/reservations/outlets/${id}/book`)).booking,
    save: (next, changed, id) => put(`/api/reservations/outlets/${id}/rules`, pickTops(next, changed)),
    keys: [['reservations']],
    more: '/hosp/reservations',
  },
};
