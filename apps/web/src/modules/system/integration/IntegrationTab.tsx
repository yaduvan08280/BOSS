import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const SUBTABS = [
  { key: 'whatsapp', path: '/system/integration', end: true },
  { key: 'templates', path: '/system/integration/templates' },
  { key: 'telegram', path: '/system/integration/telegram' },
  { key: 'channels', path: '/system/integration/channels' },
  { key: 'rules', path: '/system/integration/rules' },
  { key: 'reminders', path: '/system/integration/reminders' },
  { key: 'drive', path: '/system/integration/drive' },
];

/** System Master → Integration (CLAUDE.md §7.2). */
export function IntegrationTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        {SUBTABS.map((s) => (
          <NavLink
            key={s.key}
            to={s.path}
            end={s.end}
            className={({ isActive }) =>
              cn(
                'h-9 shrink-0 content-center rounded-pill border px-4 text-sm font-medium',
                isActive
                  ? 'border-ink bg-ink text-ink-foreground'
                  : 'bg-card text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t(`notify.tab.${s.key}`)}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
