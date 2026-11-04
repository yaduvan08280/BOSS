import { useTranslation } from 'react-i18next';
import { localDate, type Me } from '@mono/shared';
import { PageHeader } from '@/components/page';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { LeaveQuotas } from './LeaveQuotas';
import { PayMonth } from './PayMonth';
import { PayPeople } from './PayPeople';
import { PayRulesTab } from './PayRulesTab';

const TABS = ['month', 'people', 'rules', 'quotas'] as const;

/** HR → Payroll: gross pay from attendance, how each person works and is paid, the pay rules, leave a year. */
export function PayrollPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const { value: tab, set } = useParamState('tab', TABS, 'month');
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.payroll')} subtitle={t('navDesc.payroll')} />
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`hr.p.tab.${k}`)}
      />
      {tab === 'month' && <PayMonth today={localDate(new Date(), tz)} tz={tz} />}
      {tab === 'people' && <PayPeople />}
      {tab === 'rules' && <PayRulesTab />}
      {tab === 'quotas' && <LeaveQuotas />}
    </div>
  );
}
