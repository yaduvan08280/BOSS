import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { Me } from '@mono/shared';
import { Avatar, BrandMark } from '@/components/brand';
import { cn } from '@/lib/utils';
import { useWorkCounts } from '@/modules/workspace/useWorkCounts';
import { navAllowed, type NavSection } from './nav';

type Props = {
  me: Me;
  sections: NavSection[];
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  onSignOut: () => void;
};

/** Dark (or light) side menu. Used fixed on desktop and inside the drawer on phones. */
export function Sidebar({ me, sections, collapsed = false, onToggle, onNavigate, onSignOut }: Props) {
  const { t } = useTranslation();
  const counts = useWorkCounts().data;
  const badge: Record<string, number | undefined> = {
    delegation: counts?.delegation,
    checklists: counts?.checklists,
    helpSlips: counts?.slips,
    helpTickets: counts?.tickets,
    ea: counts?.ea,
    myWorkspace: counts?.total,
  };
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex items-center gap-3 px-4 pb-4 pt-5', collapsed && 'justify-center px-2')}>
        <BrandMark appName={me.company.appName} logoUrl={me.company.logoUrl} />
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-tight">{me.company.appName}</div>
            <div className="truncate text-[11px] uppercase tracking-[0.12em] text-sidebar-muted">
              {me.company.name}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4" aria-label={t('shell.menu')}>
        {sections.map((section) => (
          <div key={section.key} className="mt-4 first:mt-1">
            {!collapsed && (
              <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-sidebar-muted">
                {t(`section.${section.key}`)}
              </div>
            )}
            <ul className="space-y-0.5">
              {section.items
                .filter((i) => navAllowed(i, me.user.permissions))
                .map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/'}
                      onClick={onNavigate}
                      title={collapsed ? t(`nav.${item.key}`) : undefined}
                      className={({ isActive }) =>
                        cn(
                          'flex h-10 items-center gap-3 rounded-control px-3 text-sm transition-colors',
                          collapsed && 'justify-center px-0',
                          isActive
                            ? 'bg-sidebar-active font-semibold text-sidebar-active-foreground'
                            : 'hover:bg-sidebar-hover',
                        )
                      }
                    >
                      <item.icon className="size-[18px] shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{t(`nav.${item.key}`)}</span>}
                      {!collapsed && Boolean(badge[item.key]) && (
                        <span className="tabular ml-auto rounded-pill bg-sidebar-hover px-1.5 text-[11px] font-semibold">
                          {badge[item.key]}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-sidebar-border p-3', collapsed && 'px-2')}>
        <div
          className={cn(
            'flex items-center gap-3 rounded-control px-2 py-2',
            collapsed && 'justify-center px-0',
          )}
        >
          <Avatar name={me.user.name} url={me.user.avatarUrl} className="size-8" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me.user.name}</div>
              <div className="truncate text-xs text-sidebar-muted">{me.user.roleName}</div>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={onSignOut}
              className="grid size-8 place-items-center rounded-control text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
              aria-label={t('shell.signOut')}
              title={t('shell.signOut')}
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn(
              'mt-1 flex h-9 w-full items-center gap-3 rounded-control px-3 text-xs text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            {!collapsed && t('shell.collapseMenu')}
            {collapsed && <span className="sr-only">{t('shell.expandMenu')}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
