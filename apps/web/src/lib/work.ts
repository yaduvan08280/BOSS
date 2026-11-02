import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ModuleKeyWithSettings, ModuleSettings } from '@mono/shared';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/when';

/** Query-string state (tab, open record) so links and the back button work. */
export function useParamState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [params, setParams] = useSearchParams();
  const value = (allowed.includes(params.get(key) as T) ? params.get(key) : fallback) as T;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  return { value, params, set };
}

/** A mutation with the usual toasts, refreshing the given queries plus the menu counters. */
export function useWorkMutation<I, O = unknown>(
  fn: (input: I) => Promise<O>,
  keys: QueryKey[],
  success?: (o: O) => string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (o) => success && toast.success(success(o)),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Something went wrong'),
    onSettled: () => {
      for (const k of [...keys, ['work-counts'], ['me']]) void qc.invalidateQueries({ queryKey: k });
    },
  });
}

/** POST an action to `/api/<base>/<id>/actions`. */
export function useActionMutation<I>(base: string, key: string) {
  return useWorkMutation(
    ({ id, input }: { id: string; input: I }) =>
      api(`/api/${base}/${id}/actions`, { method: 'POST', body: input }),
    [[key]],
  );
}

/** "in 2h" or "2h late", for anything with a time limit. */
export function useDueLabel() {
  const { t } = useTranslation();
  return (iso: string | Date) => {
    const r = relative(iso);
    return r.late ? t('work.lateBy', { d: r.text }) : t('work.dueIn', { d: r.text });
  };
}

/** A module's settings from the flow designer (defaults when the company never changed them). */
export function useModuleSettings<K extends ModuleKeyWithSettings>(module: K) {
  return useQuery({
    queryKey: ['engine', 'settings', module],
    queryFn: () => api<ModuleSettings<K>>(`/api/work/settings/${module}`),
    staleTime: 60_000,
  });
}
