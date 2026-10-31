import { useQueryClient } from '@tanstack/react-query';
import { Bell, LifeBuoy, ListChecks, Menu, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, type Language, type Me, type ThemeMode } from '@mono/shared';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { UserMenu } from './UserMenu';

type Props = {
  me: Me;
  title: string;
  subtitle?: string;
  inSystem: boolean;
  onOpenMenu: () => void;
  onLanguage: (lang: Language) => void;
  onTheme: (mode: ThemeMode) => void;
  onAssistant: () => void;
  onSignOut: () => void;
};

function Counter({
  icon: Icon,
  count,
  label,
  to,
}: {
  icon: typeof Bell;
  count: number;
  label: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="relative grid size-10 place-items-center rounded-control text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={`${label}: ${count}`}
      title={label}
    >
      <Icon className="size-[18px]" />
      {count > 0 && (
        <span className="tabular absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-pill bg-accent px-1 text-[10px] font-bold text-accent-foreground">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export function WorkspaceSwitch({ inSystem, className }: { inSystem: boolean; className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tab = (active: boolean) =>
    cn(
      'h-8 rounded-[calc(var(--radius)*0.5)] px-3 text-[13px] font-medium transition-colors',
      active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <div role="tablist" className={cn('inline-flex rounded-control bg-muted p-1', className)}>
      <button role="tab" aria-selected={!inSystem} className={tab(!inSystem)} onClick={() => navigate('/')}>
        {t('shell.myWorkspace')}
      </button>
      <button
        role="tab"
        aria-selected={inSystem}
        className={tab(inSystem)}
        onClick={() => navigate('/system')}
      >
        {t('shell.systemMaster')}
      </button>
    </div>
  );
}

export function TopBar({ me, title, subtitle, inSystem, onOpenMenu, ...menu }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const showSwitch = canOpenSystemMaster(me.user.permissions);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
      <div className="flex h-16 items-center gap-2 px-4 lg:gap-3 lg:px-8">
        <button
          onClick={onOpenMenu}
          className="-ml-2 grid size-10 place-items-center rounded-control hover:bg-muted lg:hidden"
          aria-label={t('shell.menu')}
        >
          <Menu className="size-5" />
        </button>
        <BrandMark appName={me.company.appName} logoUrl={me.company.logoUrl} className="size-8 lg:hidden" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-tight lg:text-base">{title}</div>
          {subtitle && (
            <div className="hidden truncate text-xs text-muted-foreground sm:block">{subtitle}</div>
          )}
        </div>
        {showSwitch && <WorkspaceSwitch inSystem={inSystem} className="hidden md:inline-flex" />}
        <div className="flex items-center">
          <Button asChild variant="ghost" size="icon" className="hidden text-muted-foreground sm:inline-flex">
            <Link to="/support" aria-label={t('shell.support')} title={t('shell.support')}>
              <LifeBuoy className="size-[18px]" />
            </Link>
          </Button>
          <span className="hidden sm:contents">
            <Counter
              icon={ListChecks}
              count={me.counters.pendingWork}
              label={t('shell.pendingWork')}
              to="/workspace"
            />
          </span>
          <Counter
            icon={Bell}
            count={me.counters.unreadNotifications}
            label={t('shell.notifications')}
            to="/workspace"
          />
          <Button
            variant="ghost"
            size="icon"
            className="hidden text-muted-foreground sm:inline-flex"
            onClick={() => void qc.invalidateQueries()}
            aria-label={t('shell.refresh')}
            title={t('shell.refresh')}
          >
            <RefreshCw className="size-[18px]" />
          </Button>
          <div className="ml-1">
            <UserMenu me={me} {...menu} />
          </div>
        </div>
      </div>
    </header>
  );
}
