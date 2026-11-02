import { BellOff, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useMarkRead, useNotifications } from './api';
import { NotificationList } from './NotificationList';

export function NotificationsPage() {
  const { t } = useTranslation();
  const q = useNotifications(100);
  const read = useMarkRead();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('shell.notifications')}
        subtitle={q.data ? t('notify.inbox.unread', { count: q.data.unread }) : undefined}
        actions={
          q.data?.unread ? (
            <Button onClick={() => read.mutate('all')}>
              <CheckCheck /> {t('notify.inbox.readAll')}
            </Button>
          ) : undefined
        }
      />
      {q.isPending ? (
        <PageSkeleton />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon={BellOff} title={t('shell.noNotifications')} body={t('notify.inbox.emptyBody')} />
      ) : (
        <Card className="overflow-hidden">
          <NotificationList items={q.data.items} />
        </Card>
      )}
    </div>
  );
}
