import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/form';
import { SYSTEM_NAV } from '@/layout/nav';
import { cn } from '@/lib/utils';
import { useSummary } from './api';
import { HeaderCards } from './HeaderCards';

const BADGE_FOR: Record<string, string> = { departments: 'departments', users: 'users', roles: 'roles' };

/** System Master: header cards on top, a tab per setup area underneath (CLAUDE.md §4). */
export function SystemMasterLayout() {
  const { t } = useTranslation();
  const summary = useSummary();
  const tabs = SYSTEM_NAV.flatMap((s) => s.items).filter((i) => i.key !== 'uiKit');
  return (
    <div className="space-y-5">
      <h1 className="sr-only">{t('system.title')}</h1>
      <HeaderCards summary={summary.data} />
      <nav
        className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
        aria-label={t('system.title')}
      >
        <div className="flex w-max gap-1 border-b">
          {tabs.map((tab) => {
            const count = BADGE_FOR[tab.key] ? summary.data?.counts[BADGE_FOR[tab.key]!] : undefined;
            return (
              <NavLink
                key={tab.key}
                to={tab.path}
                className={({ isActive }) =>
                  cn(
                    '-mb-px flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {t(`nav.${tab.key}`)}
                {count !== undefined && <Badge>{count}</Badge>}
              </NavLink>
            );
          })}
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
