import { Hammer } from 'lucide-react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, PageHeader } from '@/components/page';
import { findNavItem } from '@/layout/nav';

/** Screens that are on the menu but belong to a later phase. */
export function PlaceholderPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const item = findNavItem(pathname);
  if (!item) return null;
  return (
    <>
      <PageHeader title={t(`nav.${item.key}`)} subtitle={t(`navDesc.${item.key}`)} />
      <EmptyState
        icon={item.icon ?? Hammer}
        title={t('common.comingIn', { phase: item.phase })}
        body={t('common.comingBody', { phase: item.phase })}
      />
    </>
  );
}
