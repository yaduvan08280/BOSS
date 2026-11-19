import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@mono/shared';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useMe } from '@/modules/auth/session';

type Health = {
  status: 'ok' | 'warn' | 'fail';
  version: string;
  startedAt: string;
  checks: { key: string; state: 'ok' | 'warn' | 'fail'; message: string }[];
};
const TONE = { ok: 'ok', warn: 'warn', fail: 'bad' } as const;

/** System Master → Errors: what the server says about itself (the same checks as /api/health/ready), in words. */
export function HealthCard() {
  const { t } = useTranslation();
  const tz = useMe().data?.company.timezone;
  const q = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api<Health>('/api/system/health'),
    refetchInterval: 60_000,
  });
  if (q.isPending) return <div className="h-24 animate-pulse rounded-card bg-muted" />;
  // Not open to this person, or the server did not answer: the errors list below still has its own message.
  if (q.isError) return null;
  const h = q.data;
  return (
    <section
      className="@container rounded-card border border-border bg-card p-4"
      aria-label={t('health.title')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold">{t('health.title')}</h2>
        <StatusChip tone={TONE[h.status]}>{t(`health.state.${h.status}`)}</StatusChip>
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('health.again')}
          disabled={q.isFetching}
          onClick={() => void q.refetch()}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-2 @2xl:grid-cols-2">
        {h.checks.map((c) => (
          <li key={c.key} className="flex min-w-0 items-start gap-2 text-sm">
            <StatusChip tone={TONE[c.state]} className="shrink-0">
              {t(`health.state.${c.state}`)}
            </StatusChip>
            <span className="min-w-0">
              <span className="font-medium">{t(`health.keys.${c.key}`, { defaultValue: c.key })}</span>
              <span className="text-muted-foreground"> — {c.message}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {t('health.foot', { version: h.version, since: formatDateTime(h.startedAt, tz) })}
      </p>
    </section>
  );
}
