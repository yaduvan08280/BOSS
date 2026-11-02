import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export const WORK_COUNTS_KEY = ['work-counts'] as const;
export const useWorkCounts = () =>
  useQuery({
    queryKey: WORK_COUNTS_KEY,
    queryFn: () => api<{ delegation: number; checklists: number; total: number }>('/api/work/counts'),
    staleTime: 20_000,
  });
