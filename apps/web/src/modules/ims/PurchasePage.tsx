import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { PageHeader } from '@/components/page';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { OrdersTab } from './OrdersTab';
import { OwsTab } from './OwsTab';

const TABS = ['ows', 'orders'] as const;

/** Inventory → Purchase (OWS): the order-when-short list and the purchase orders. */
export function PurchasePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, set } = useParamState('tab', TABS, 'ows');
  const canOrder = hasPermission(me.user.permissions, 'ims.create');
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.purchase')} subtitle={t('navDesc.purchase')} />
      <TabStrip tabs={TABS} active={tab} onChange={(k) => set({ tab: k })} label={(k) => t(`ims.tab.${k}`)} />
      {tab === 'ows' && <OwsTab canOrder={canOrder} onOrdered={() => set({ tab: 'orders' })} />}
      {tab === 'orders' && <OrdersTab canOrder={canOrder} />}
    </div>
  );
}
