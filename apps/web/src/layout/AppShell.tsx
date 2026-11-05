import { Bot, Plus } from 'lucide-react';
import { useState, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { InstallBanner } from './InstallBanner';
import { PageSkeleton } from '@/components/page';
import { useTranslation } from 'react-i18next';
import { canOpenSystemMaster, type Me } from '@mono/shared';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn, safeStorage } from '@/lib/utils';
import { useLiveEvents, useLogout, useUpdatePreferences } from '@/modules/auth/session';
import { ChangePasswordCard } from '@/modules/account/AccountPage';
import { CommandPalette } from '@/modules/search/CommandPalette';
import { BottomTabs } from './BottomTabs';
import { findNavItem, SYSTEM_NAV, WORKSPACE_NAV } from './nav';
import { Sidebar } from './Sidebar';
import { TopBar, WorkspaceSwitch } from './TopBar';

const COLLAPSE_KEY = 'mono.menuCollapsed';

export function AppShell({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => safeStorage.get(COLLAPSE_KEY) === '1');
  const [drawer, setDrawer] = useState(false);
  const [assistant, setAssistant] = useState(false);
  const [capture, setCapture] = useState(false);
  const logout = useLogout();
  const prefs = useUpdatePreferences();
  useLiveEvents(true);

  const inSystem = pathname.startsWith('/system') || pathname.startsWith('/dev');
  const sections = inSystem && canOpenSystemMaster(me.user.permissions) ? SYSTEM_NAV : WORKSPACE_NAV;
  const item = findNavItem(pathname);
  const title = item ? t(`nav.${item.key}`) : inSystem ? t('system.title') : t(`nav.home`);
  const subtitle = item ? t(`navDesc.${item.key}`) : inSystem ? t('system.subtitle') : undefined;

  const toggle = () => {
    setCollapsed((c) => {
      safeStorage.set(COLLAPSE_KEY, c ? '0' : '1');
      return !c;
    });
  };
  const signOut = () => logout.mutate();
  const menuProps = {
    onLanguage: (lang: 'en' | 'hi') => prefs.mutate({ lang }),
    onTheme: (themeMode: 'light' | 'dark' | 'system') => prefs.mutate({ themeMode }),
    onAssistant: () => setAssistant(true),
    onSignOut: signOut,
  };

  return (
    <div className="min-h-dvh">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border transition-[width] duration-200 lg:block',
          collapsed ? 'w-[76px]' : 'w-64',
        )}
      >
        <Sidebar me={me} sections={sections} collapsed={collapsed} onToggle={toggle} onSignOut={signOut} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" title={t('shell.menu')} hideTitle className="border-0 bg-sidebar">
          {canOpenSystemMaster(me.user.permissions) && (
            <div className="px-4 pt-3">
              <WorkspaceSwitch inSystem={inSystem} className="w-full [&>button]:flex-1" />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <Sidebar me={me} sections={sections} onNavigate={() => setDrawer(false)} onSignOut={signOut} />
          </div>
        </SheetContent>
      </Sheet>

      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-[76px]' : 'lg:pl-64')}>
        <TopBar
          me={me}
          title={title}
          subtitle={subtitle}
          inSystem={inSystem}
          onOpenMenu={() => setDrawer(true)}
          {...menuProps}
        />
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-28 pt-5 sm:pt-6 lg:px-8 lg:pb-12">
          {me.user.mustChangePassword ? (
            <div className="mx-auto max-w-md space-y-4 pt-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{t('auth.firstLoginTitle')}</h1>
                <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.firstLoginBody')}</p>
              </div>
              <ChangePasswordCard />
            </div>
          ) : (
            <Suspense fallback={<PageSkeleton />}>
              <InstallBanner appName={me.company.appName} />
              <Outlet />
            </Suspense>
          )}
        </main>
        <CommandPalette me={me} />
      </div>

      <button
        onClick={() => setAssistant(true)}
        className="fixed bottom-24 right-4 z-30 grid size-12 place-items-center rounded-full bg-ink text-ink-foreground shadow-xl transition-transform hover:scale-105 active:scale-95 lg:bottom-6 lg:right-6 lg:size-14"
        aria-label={t('shell.assistant')}
        title={t('shell.assistant')}
      >
        <Bot className="size-5 lg:size-6" />
      </button>

      <BottomTabs
        onCapture={() => setCapture(true)}
        onMenu={() => setDrawer(true)}
        alerts={me.counters.unreadNotifications}
      />

      <Sheet open={assistant} onOpenChange={setAssistant}>
        <SheetContent side="right" title={t('shell.assistant')}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="grid size-16 place-items-center rounded-card bg-accent-soft text-accent-soft-foreground">
              <Bot className="size-7" />
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">{t('shell.assistantSoon')}</p>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={capture} onOpenChange={setCapture}>
        <SheetContent side="bottom" title={t('shell.capture')}>
          <div className="flex items-center gap-3 p-5 pb-8 text-sm text-muted-foreground">
            <Plus className="size-5 shrink-0" />
            {t('shell.captureSoon')}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
