import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { daysOf, type Span } from '@/lib/days';

/**
 * A screen that reads one day at a time, shown over several days: one request per day (at most `cap`), each
 * cached on its own, so a day that was already open is not fetched again when the span grows.
 */
export function useDays<T>(
  key: unknown[],
  span: Span,
  url: (day: string) => string,
  cap = 31,
  enabled = true,
) {
  const days = daysOf(span, cap);
  const results = useQueries({
    queries: days.map((day) => ({
      queryKey: [...key, day],
      queryFn: () => api<T>(url(day)),
      retry: false,
      enabled,
    })),
  });
  const first = results.find((r) => r.isError);
  return {
    days: days.map((day, i) => ({ day, data: results[i]?.data })),
    isPending: results.some((r) => r.isPending),
    error: first?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
    capped: daysOf(span, cap + 1).length > cap,
  };
}
