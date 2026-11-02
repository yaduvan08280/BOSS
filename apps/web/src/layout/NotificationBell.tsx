import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useMarkRead, useNotifications } from '@/modules/notifications/api';
import { NotificationList } from '@/modules/notifications/NotificationList';

export function NotificationBell({ unread }: { unread: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const q = useNotifications(10);
  const read = useMarkRead();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className="relative grid size-10 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`${t('shell.notifications')}: ${unread}`}
      >
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="tabular absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">{t('shell.notifications')}</span>
          {unread > 0 && (
            <button
              onClick={() => read.mutate('all')}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="size-3.5" /> {t('notify.inbox.readAll')}
            </button>
          )}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto">
          {q.data?.items.length ? (
            <NotificationList items={q.data.items} compact onPick={() => setOpen(false)} />
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('shell.noNotifications')}
            </p>
          )}
        </div>
        <Link
          to="/notifications"
          onClick={() => setOpen(false)}
          className="block border-t px-4 py-2.5 text-center text-xs font-semibold hover:bg-muted"
        >
          {t('notify.inbox.seeAll')}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
