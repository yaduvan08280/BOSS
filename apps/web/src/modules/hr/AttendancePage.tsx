import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, localDate, type Me } from '@mono/shared';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Card, CardContent } from '@/components/ui/card';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { useMonth } from './api';
import { CorrectionsTab, ImportTab, TeamTab } from './AttendanceTabs';
import { MusterTab } from './MusterTab';
import { RecalcButton } from './RecalcButton';
import { MonthGrid } from './MonthGrid';
import { PunchCard } from './PunchCard';

const TABS = ['today', 'team', 'month', 'corrections', 'import'] as const;

/** HR → Attendance (CLAUDE.md §9.2): punch, my month, the team's day, the monthly muster and punch report,
 * corrections, biometric import. */
export function AttendancePage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const tz = me.company.timezone;
  const today = localDate(new Date(), tz);
  const lead = hasPermission(me.user.permissions, 'hr.approve');
  const admin = hasPermission(me.user.permissions, 'hr.admin');
  const tabs = TABS.filter((k) =>
    k === 'team' || k === 'month' ? lead || admin : k === 'import' ? admin : true,
  );
  const { value: tab, set } = useParamState('tab', tabs, 'today');
  const [month, setMonth] = useState(today.slice(0, 7));
  const q = useMonth(month);

  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.attendance')} subtitle={t('navDesc.attendance')} />
      <TabStrip
        tabs={tabs}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`hr.a.tab.${k}`)}
      />
      {tab === 'today' &&
        (q.isPending ? (
          <PageSkeleton />
        ) : q.isError ? (
          <ErrorState onRetry={() => void q.refetch()} error={q.error} />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
            <PunchCard month={q.data} tz={tz} />
            <Card className="lg:row-span-2">
              <CardContent className="pt-5">
                <MonthGrid month={month} view={q.data} tz={tz} onMonth={setMonth} />
              </CardContent>
            </Card>
          </div>
        ))}
      {tab === 'team' && <TeamTab tz={tz} today={today} />}
      {tab === 'month' && admin && (
        <div className="flex justify-end">
          <RecalcButton today={today} />
        </div>
      )}
      {tab === 'month' && <MusterTab tz={tz} today={today} />}
      {tab === 'corrections' && <CorrectionsTab tz={tz} />}
      {tab === 'import' && <ImportTab />}
    </div>
  );
}
