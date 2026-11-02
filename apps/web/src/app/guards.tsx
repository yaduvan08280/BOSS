import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { canOpenSystemMaster, type Me } from '@mono/shared';
import { HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { ApiError } from '@/lib/api';
import { AppShell } from '@/layout/AppShell';
import { useApplyUserPrefs, useMe } from '@/modules/auth/session';

/** Loads the signed-in user once; everything inside the shell can rely on `me`. */
export function Authed() {
  const me = useMe();
  const location = useLocation();
  useApplyUserPrefs(me.data);
  if (me.isPending) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <PageSkeleton />
      </div>
    );
  }
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!me.data) return <ErrorState onRetry={() => void me.refetch()} />;
  return <AppShell me={me.data} />;
}

export function WithMe({ render }: { render: (me: Me) => ReactNode }) {
  const me = useMe();
  return me.data ? <>{render(me.data)}</> : null;
}

export function SystemOnly() {
  const me = useMe();
  if (me.data && !canOpenSystemMaster(me.data.user.permissions)) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Integration → Google Drive arrives in phase 10. */
export function DrivePlaceholder() {
  const { t } = useTranslation();
  return (
    <EmptyState icon={HardDrive} title={t('common.comingIn', { phase: 10 })} body={t('notify.driveSoon')} />
  );
}
