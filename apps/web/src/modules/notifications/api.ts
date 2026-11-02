import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type InAppNotification = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  tone: string | null;
  readAt: string | null;
  createdAt: string;
};
export const NOTIFICATIONS_KEY = ['notifications'] as const;

export const useNotifications = (limit = 30) =>
  useQuery({
    queryKey: [...NOTIFICATIONS_KEY, limit],
    queryFn: () => api<{ items: InAppNotification[]; unread: number }>(`/api/notifications?limit=${limit}`),
  });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api(id === 'all' ? '/api/notifications/read-all' : `/api/notifications/${id}/read`, { method: 'POST' }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
