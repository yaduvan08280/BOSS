import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { Language, LoginInput, Me, ThemeMode } from '@mono/shared';
import { toast } from 'sonner';
import { api, ApiError, refreshSession } from '@/lib/api';
import { applyWords, setLanguage } from '@/lib/i18n';
import { applyTheme } from '@/lib/theme';

export const ME_KEY = ['me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<Me>('/api/auth/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

/** Keep <html> theme + language in step with the signed-in user and their company. */
export function useApplyUserPrefs(me: Me | undefined) {
  useEffect(() => {
    if (!me) return;
    applyTheme(me.company.theme, me.user.themeMode);
    applyWords(me.company.words ?? {});
    void setLanguage(me.user.lang);
    document.title = me.company.appName;
    if (me.user.themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(me.company.theme, 'system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [me]);
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<{ ok: true }>('/api/auth/login', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    onSettled: () => {
      qc.clear();
      window.location.assign('/login');
    },
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: { lang?: Language; themeMode?: ThemeMode }) =>
      api<{ ok: true }>('/api/auth/me/preferences', { method: 'PATCH', body: prefs }),
    onMutate: (prefs) => {
      qc.setQueryData<Me>(ME_KEY, (old) => (old ? { ...old, user: { ...old.user, ...prefs } } : old));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
}

/**
 * Live events over SSE. EventSource can't refresh an expired cookie by itself,
 * so on error we refresh the session and reconnect with backoff.
 */
export function useLiveEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000;
    let stopped = false;
    const connect = () => {
      source = new EventSource('/api/events');
      source.addEventListener('ready', () => {
        delay = 2000;
      });
      source.addEventListener('domain', (e) => {
        void qc.invalidateQueries({ queryKey: ME_KEY });
        void qc.invalidateQueries({ queryKey: ['work-counts'] });
        // Live boards: tasks and checklists refresh when anything changes on them.
        const name = (JSON.parse((e as MessageEvent).data) as { name?: string }).name ?? '';
        if (name.startsWith('delegation.') || name.startsWith('task.'))
          void qc.invalidateQueries({ queryKey: ['tasks'] });
        if (name.startsWith('checklist.')) void qc.invalidateQueries({ queryKey: ['checklists'] });
        if (name.startsWith('slip.')) void qc.invalidateQueries({ queryKey: ['slips'] });
        if (name.startsWith('ticket.')) void qc.invalidateQueries({ queryKey: ['tickets'] });
        if (name.startsWith('ea.')) void qc.invalidateQueries({ queryKey: ['ea'] });
        if (name === 'settings.changed') void qc.invalidateQueries({ queryKey: ['engine'] });
      });
      source.addEventListener('notification', () => {
        void qc.invalidateQueries({ queryKey: ME_KEY });
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        // Show the newest one as a toast. One slot only: a busy hour must not bury the screen
        // (and the taps meant for it) under a stack of toasts; the bell keeps the full list.
        void api<{ items: { title: string; body: string | null }[] }>('/api/notifications?limit=1')
          .then(
            (r) =>
              r.items[0] &&
              toast(r.items[0].title, {
                id: 'live-notification',
                description: r.items[0].body ?? undefined,
                duration: 5000,
              }),
          )
          .catch(() => undefined);
      });
      source.onerror = () => {
        source?.close();
        if (stopped) return;
        timer = setTimeout(async () => {
          await refreshSession();
          if (!stopped) connect();
        }, delay);
        delay = Math.min(delay * 2, 60_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [enabled, qc]);
}
