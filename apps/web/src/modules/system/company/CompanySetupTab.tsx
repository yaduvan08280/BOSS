import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const SUBTABS = [
  { key: 'profile', path: '/system/company', end: true },
  { key: 'shifts', path: '/system/company/shifts' },
  { key: 'branches', path: '/system/company/branches' },
  { key: 'designations', path: '/system/company/designations' },
];

export function CompanySetupTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
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
            {t(`org.company.${s.key}`)}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
