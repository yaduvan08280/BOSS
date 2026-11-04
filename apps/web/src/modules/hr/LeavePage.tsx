import { useTranslation } from 'react-i18next';
import { localDate, type Me } from '@mono/shared';
import { PageHeader } from '@/components/page';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { useLeaveLists } from './api';
import { ApplyLeave } from './ApplyLeave';
import { HolidaysTab } from './HolidaysTab';
import { ApproveTab, BuddyTab, MineTab } from './LeaveLists';

const TABS = ['apply', 'mine', 'approve', 'buddy', 'holidays'] as const;

/** HR → Leave (CLAUDE.md §9.2): apply with Buddies, my leave and balances, approvals, Buddy requests, holidays. */
export function LeavePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const today = localDate(new Date(), tz);
  const lists = useLeaveLists();
  const { value: tab, set } = useParamState('tab', TABS, 'apply');
  const counts = {
    approve: lists.data?.toDecide.length,
    buddy: lists.data?.asks.filter((a) => a.status === 'ASKED').length,
  };
  const tabs = TABS.filter((k) => k !== 'approve' || (counts.approve ?? 0) > 0 || tab === 'approve');
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.leave')} subtitle={t('navDesc.leave')} />
      <TabStrip
        tabs={tabs}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`hr.l.tab.${k}`)}
        counts={counts}
      />
      {tab === 'apply' && <ApplyLeave me={me} today={today} onDone={() => set({ tab: 'mine' })} />}
      {tab === 'mine' && <MineTab me={me} today={today} />}
      {tab === 'approve' && <ApproveTab me={me} />}
      {tab === 'buddy' && <BuddyTab tz={tz} />}
      {tab === 'holidays' && <HolidaysTab me={me} />}
    </div>
  );
}
