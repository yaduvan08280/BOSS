import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Card, Skeleton } from './ui/card';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** KPI tile. `hero` = the one ink card per screen for the number that matters most. */
export function KpiTile({
  label,
  value,
  unit,
  note,
  hero,
  tone,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  hero?: boolean;
  tone?: 'bad';
  icon?: LucideIcon;
}) {
  return (
    <div
      className={cn(
        'flex min-h-24 flex-col justify-between rounded-card border p-3.5 sm:min-h-28 sm:p-5',
        hero ? 'border-ink bg-ink text-ink-foreground' : 'bg-card',
      )}
    >
      <div
        className={cn('flex items-center gap-1.5 text-[13px]', hero ? 'opacity-75' : 'text-muted-foreground')}
      >
        {Icon && <Icon className="size-3.5" aria-hidden />}
        {label}
      </div>
      <div className="mt-2">
        <span
          className={cn(
            'tabular text-2xl font-semibold tracking-tight sm:text-3xl',
            tone === 'bad' && 'text-status-bad',
          )}
        >
          {value}
        </span>
        {unit && (
          <span className={cn('ml-1 text-sm', hero ? 'opacity-70' : 'text-muted-foreground')}>{unit}</span>
        )}
      </div>
      {note && (
        <div className={cn('mt-1 text-xs', hero ? 'opacity-70' : 'text-muted-foreground')}>{note}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
      <div className="mb-4 grid size-14 place-items-center rounded-card bg-accent-soft text-accent-soft-foreground">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {body && <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </Card>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={CircleAlert}
      title={t('common.somethingWrong')}
      body={t('common.somethingWrongBody')}
      action={onRetry && <Button onClick={onRetry}>{t('common.retry')}</Button>}
    />
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy className="space-y-5">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}
