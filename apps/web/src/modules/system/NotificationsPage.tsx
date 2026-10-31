import { BellOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, PageHeader } from '@/components/page';

export function NotificationsPage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t('shell.notifications')} />
      <EmptyState
        icon={BellOff}
        title={t('shell.noNotifications')}
        body={t('common.comingIn', { phase: 2 })}
      />
    </>
  );
}
