import { Bell, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { formatShortDateTime } from '@mono/shared';
import { cn } from '@/lib/utils';
import { useMarkRead, type InAppNotification } from './api';

/** One list for the bell dropdown and the notifications page. Opening an item marks it read. */
export function NotificationList({
  items,
  onPick,
  compact,
}: {
  items: InAppNotification[];
  onPick?: () => void;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const read = useMarkRead();
  return (
    <ul className="divide-y">
      {items.map((n) => (
        <li key={n.id}>
          <button
            onClick={() => {
              if (!n.readAt) read.mutate(n.id);
              onPick?.();
              if (n.link) navigate(n.link.startsWith('http') ? new URL(n.link).pathname : n.link);
            }}
            className={cn(
              'flex w-full gap-3 px-4 text-left hover:bg-muted/60',
              compact ? 'py-2.5' : 'py-3.5',
            )}
          >
            <span
              className={cn(
                'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
                n.tone === 'warn'
                  ? 'bg-status-warn-bg text-status-warn-fg'
                  : 'bg-accent-soft text-accent-soft-foreground',
              )}
            >
              {n.tone === 'warn' ? <TriangleAlert className="size-4" /> : <Bell className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block text-sm', !n.readAt && 'font-semibold')}>{n.title}</span>
              {n.body && (
                <span className={cn('block text-xs text-muted-foreground', compact && 'line-clamp-2')}>
                  {n.body}
                </span>
              )}
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {formatShortDateTime(n.createdAt)}
              </span>
            </span>
            {!n.readAt && (
              <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label="unread" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
