import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useWorkMutation } from '@/lib/work';

export type ApiKeyRow = {
  id: string;
  name: string;
  masked: string;
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};
export type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  active: boolean;
  createdAt: string;
  sent: number;
  failed: number;
  pending: number;
};
export type Delivery = {
  id: string;
  event: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  tries: number;
  responseCode: number | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  nextAt: string;
};
export type PlatformInfo = {
  apiUrl: string;
  docsUrl: string;
  openapiUrl: string;
  events: { event: string; module: string }[];
};
export type WebhookInput = { url: string; events: string[]; description?: string | null; active: boolean };

export const usePlatformInfo = () =>
  useQuery({ queryKey: ['platform', 'info'], queryFn: () => api<PlatformInfo>('/api/platform/info') });
export const useApiKeys = () =>
  useQuery({ queryKey: ['platform', 'keys'], queryFn: () => api<ApiKeyRow[]>('/api/platform/keys') });
export const useWebhooks = () =>
  useQuery({
    queryKey: ['platform', 'webhooks'],
    queryFn: () => api<WebhookRow[]>('/api/platform/webhooks'),
  });
export const useDeliveries = (id: string) =>
  useQuery({
    queryKey: ['platform', 'deliveries', id],
    queryFn: () => api<Delivery[]>(`/api/platform/webhooks/${id}/deliveries`),
  });

export const usePlatformMutation = <I, O = unknown>(fn: (i: I) => Promise<O>, success?: (o: O) => string) =>
  useWorkMutation(fn, [['platform']], success);

export const platformApi = {
  createKey: (name: string) =>
    api<{ id: string; name: string; key: string }>('/api/platform/keys', { method: 'POST', body: { name } }),
  revokeKey: (id: string) => api(`/api/platform/keys/${id}`, { method: 'DELETE' }),
  saveWebhook: (input: WebhookInput, id?: string) =>
    api<{ id: string; secret: string | null }>(
      id ? `/api/platform/webhooks/${id}` : '/api/platform/webhooks',
      {
        method: id ? 'PUT' : 'POST',
        body: input,
      },
    ),
  deleteWebhook: (id: string) => api(`/api/platform/webhooks/${id}`, { method: 'DELETE' }),
  testWebhook: (id: string) =>
    api<{ ok: boolean; status: number | null; error: string | null }>(`/api/platform/webhooks/${id}/test`, {
      method: 'POST',
    }),
  rotateSecret: (id: string) =>
    api<{ id: string; secret: string }>(`/api/platform/webhooks/${id}/secret`, { method: 'POST' }),
};
