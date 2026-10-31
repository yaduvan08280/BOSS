import { ArrowUp, Check, Clock, Hourglass, Play, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { StatusTone } from '@mono/shared';
import { cn } from '@/lib/utils';

const ICONS: Record<StatusTone, LucideIcon> = {
  ok: Check,
  warn: Clock,
  bad: TriangleAlert,
  over: ArrowUp,
  info: Play,
  neutral: Hourglass,
};

const TONES: Record<StatusTone, string> = {
  ok: 'bg-status-ok-bg text-status-ok-fg',
  warn: 'bg-status-warn-bg text-status-warn-fg',
  bad: 'bg-status-bad-bg text-status-bad-fg',
  over: 'bg-status-over-bg text-status-over-fg',
  info: 'bg-status-info-bg text-status-info-fg',
  neutral: 'bg-status-neutral-bg text-status-neutral-fg',
};

/** Fixed status colours + an icon, so status never depends on colour alone. */
export function StatusChip({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: string;
  className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-pill px-2.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {children}
    </span>
  );
}
