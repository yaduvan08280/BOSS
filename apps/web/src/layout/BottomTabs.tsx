import { Bell, House, Inbox, Menu, Plus } from 'lucide-react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Phone-only tab bar: Home · My work · + Capture · Alerts · Menu. */
export function BottomTabs({
  onCapture,
  onMenu,
  alerts,
}: {
  onCapture: () => void;
  onMenu: () => void;
  alerts: number;
}) {
  const { t } = useTranslation();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
      isActive ? 'text-foreground' : 'text-muted-foreground',
    );
  return (
    <nav
      aria-label={t('shell.menu')}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 pb-safe backdrop-blur-md lg:hidden"
    >
      <div className="flex h-16 items-stretch px-2">
        <NavLink to="/" end className={tab}>
          <House className="size-5" />
          {t('shell.home')}
        </NavLink>
        <NavLink to="/workspace" className={tab}>
          <Inbox className="size-5" />
          {t('shell.myWork')}
        </NavLink>
        <div className="flex flex-1 items-center justify-center">
          <button
            onClick={onCapture}
            className="-mt-6 grid size-14 place-items-center rounded-full bg-accent text-accent-foreground shadow-lg ring-4 ring-background active:scale-95"
            aria-label={t('shell.capture')}
          >
            <Plus className="size-6" />
          </button>
        </div>
        <NavLink to="/notifications" className={tab}>
          <span className="relative">
            <Bell className="size-5" />
            {alerts > 0 && (
              <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-accent ring-2 ring-card" />
            )}
          </span>
          {t('shell.alerts')}
        </NavLink>
        <button onClick={onMenu} className={tab({ isActive: false })}>
          <Menu className="size-5" />
          {t('shell.menu')}
        </button>
      </div>
    </nav>
  );
}
