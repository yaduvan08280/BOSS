import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page';
import { TabStrip } from '@/components/work';
import { Select } from '@/components/ui/form';
import { useParamState } from '@/lib/work';
import { ExceptionsTab, LeagueTab } from './BranchTabs';
import { LetterTab, PulseTab, WhatIfTab } from './ExtraTabs';
import { CashFlowTab, VendorsTab } from './MoneyTabs';
import { MorningTab } from './MorningTab';
import { BusFactorTab, DelayTab, LeaksTab, PromisesTab } from './PeopleTabs';

const TABS = [
  'morning',
  'letter',
  'exceptions',
  'leaks',
  'promises',
  'delay',
  'league',
  'bus',
  'vendors',
  'cash',
  'pulse',
  'whatif',
] as const;
const SPANNED = ['exceptions', 'leaks', 'promises', 'delay', 'league', 'pulse'];
const day = (back: number) =>
  new Date(Date.now() + 5.5 * 3_600_000 - back * 86_400_000).toISOString().slice(0, 10);

/** The owner's desk: reports that look across branches, people and companies. */
export function OwnerDeskPage() {
  const { t } = useTranslation();
  const { value: tab, set } = useParamState('tab', TABS, 'morning');
  const [days, setDays] = useState('7');
  // "Today so far" counts today; the others end yesterday (full days).
  const span = days === '0' ? { from: day(0), to: day(0) } : { from: day(Number(days)), to: day(1) };
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.ownerDesk')} subtitle={t('navDesc.ownerDesk')} />
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`owner.tab.${k}`)}
      />
      {SPANNED.includes(tab) && (
        <Select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          aria-label={t('owner.span')}
          className="w-auto"
        >
          <option value="0">{t('owner.spanToday')}</option>
          <option value="7">{t('owner.spanDays', { n: 7 })}</option>
          <option value="30">{t('owner.spanDays', { n: 30 })}</option>
          <option value="90">{t('owner.spanDays', { n: 90 })}</option>
        </Select>
      )}
      {tab === 'morning' && <MorningTab />}
      {tab === 'exceptions' && <ExceptionsTab span={span} />}
      {tab === 'leaks' && <LeaksTab span={span} />}
      {tab === 'promises' && <PromisesTab span={span} />}
      {tab === 'delay' && <DelayTab span={span} />}
      {tab === 'league' && <LeagueTab span={span} />}
      {tab === 'bus' && <BusFactorTab />}
      {tab === 'vendors' && <VendorsTab />}
      {tab === 'cash' && <CashFlowTab />}
      {tab === 'letter' && <LetterTab />}
      {tab === 'whatif' && <WhatIfTab />}
      {tab === 'pulse' && <PulseTab span={span} />}
    </div>
  );
}
