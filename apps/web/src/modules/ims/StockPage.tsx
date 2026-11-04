import { useTranslation } from 'react-i18next';
import { hasPermission, localDate, type Me } from '@mono/shared';
import { PageHeader } from '@/components/page';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { ItemsTab } from './ItemsTab';
import { ReportsTab } from './ReportsTab';
import { ApprovalsTab, SheetTab } from './SheetTab';
import { StockToday } from './StockToday';

const TABS = ['today', 'sheet', 'approvals', 'items', 'reports'] as const;

/** Inventory → Stock: stock today, the IMS sheet, adjustments to approve, the item master, reports. */
export function StockPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const perms = me.user.permissions;
  const { value: tab, set } = useParamState('tab', TABS, 'today');
  const today = localDate(new Date(), tz);
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.stock')} subtitle={t('navDesc.stock')} />
      <TabStrip tabs={TABS} active={tab} onChange={(k) => set({ tab: k })} label={(k) => t(`ims.tab.${k}`)} />
      {tab === 'today' && (
        <StockToday
          canMove={hasPermission(perms, 'ims.create')}
          canAdjust={hasPermission(perms, 'ims.create')}
        />
      )}
      {tab === 'sheet' && <SheetTab tz={tz} today={today} />}
      {tab === 'approvals' && <ApprovalsTab tz={tz} />}
      {tab === 'items' && <ItemsTab canEdit={hasPermission(perms, 'ims.edit')} />}
      {tab === 'reports' && <ReportsTab today={today} />}
    </div>
  );
}
