import { Loader2, Save } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImsRules } from '@mono/shared';
import { ErrorState, PageSkeleton } from '@/components/page';
import { PeoplePicker } from '@/components/people-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { Chips, NumberChoice, Question, YesNo } from '@/modules/hr/ui';
import { useUsers } from '@/modules/system/api';
import { imsApi, useImsMutation, useImsRules } from './api';

const TABS = ['max', 'ows', 'turns', 'audit', 'people'] as const;
type Tab = (typeof TABS)[number];

/** System Master → Inventory (§10.1–10.2): the four rule sets with their defaults, and who does what. */
export function InventorySetup() {
  const q = useImsRules();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return <Setup key={JSON.stringify(q.data.rules)} saved={q.data.rules} />;
}

function Setup({ saved }: { saved: ImsRules }) {
  const { t } = useTranslation();
  const { value: tab, set } = useParamState('tab', TABS, 'max');
  const [rules, setRules] = useState(saved);
  const save = useImsMutation(
    (k: Tab) => imsApi.saveRules({ [k]: rules[k] }),
    () => t('ims.set.saved'),
  );
  const up = <K extends Tab>(k: K, x: Partial<ImsRules[K]>) =>
    setRules({ ...rules, [k]: { ...rules[k], ...x } });
  const changed = JSON.stringify(rules[tab]) !== JSON.stringify(saved[tab]);
  const days = t('hr.w.days');
  return (
    <div className="space-y-4">
      <TabStrip
        tabs={TABS}
        active={tab}
        onChange={(k) => set({ tab: k })}
        label={(k) => t(`ims.set.tab.${k}`)}
      />
      <Card>
        <CardContent className="pt-2">
          {tab === 'max' && (
            <>
              <p className="pt-3 text-sm text-muted-foreground">{t('ims.set.formula')}</p>
              <Question label={t('ims.set.useDays')}>
                <NumberChoice
                  label={t('ims.set.useDays')}
                  value={rules.max.useDays}
                  presets={[90, 120, 180]}
                  unit={days}
                  step={10}
                  min={7}
                  max={365}
                  onChange={(useDays) => up('max', { useDays })}
                />
              </Question>
              <Question label={t('ims.set.reviewEvery')}>
                <NumberChoice
                  label={t('ims.set.reviewEvery')}
                  value={rules.max.reviewEveryDays}
                  presets={[7, 15, 30]}
                  unit={days}
                  min={1}
                  max={180}
                  onChange={(reviewEveryDays) => up('max', { reviewEveryDays })}
                />
              </Question>
              <Question label={t('ims.set.raise')} hint={t('ims.set.raiseHint')}>
                <NumberChoice
                  label={t('ims.set.raise')}
                  value={rules.max.raiseAfterRedDays}
                  presets={[2, 3, 5]}
                  unit={days}
                  min={1}
                  max={90}
                  onChange={(raiseAfterRedDays) => up('max', { raiseAfterRedDays })}
                />
              </Question>
              <Question label={t('ims.set.lower')} hint={t('ims.set.lowerHint')}>
                <NumberChoice
                  label={t('ims.set.lower')}
                  value={rules.max.lowerWhenPurplePct}
                  presets={[30, 50, 70]}
                  unit="%"
                  step={5}
                  min={1}
                  max={100}
                  onChange={(lowerWhenPurplePct) => up('max', { lowerWhenPurplePct })}
                />
              </Question>
              <Question label={t('ims.set.step')}>
                <NumberChoice
                  label={t('ims.set.step')}
                  value={rules.max.safetyStep}
                  presets={[0.1, 0.25, 0.5]}
                  unit=""
                  step={0.05}
                  min={0.05}
                  max={2}
                  onChange={(safetyStep) => up('max', { safetyStep })}
                />
              </Question>
              <Question label={t('ims.set.lowest')}>
                <NumberChoice
                  label={t('ims.set.lowest')}
                  value={rules.max.lowestSafety}
                  presets={[1, 1.25, 1.5]}
                  unit=""
                  step={0.25}
                  min={0.5}
                  max={5}
                  onChange={(lowestSafety) => up('max', { lowestSafety })}
                />
              </Question>
            </>
          )}
          {tab === 'ows' && (
            <>
              <Question label={t('ims.set.orderDay')} hint={t('ims.set.orderDayHint')}>
                <Chips
                  label={t('ims.set.orderDay')}
                  value={rules.ows.orderWeekday}
                  onChange={(orderWeekday) => up('ows', { orderWeekday })}
                  options={['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({
                    value: i + 1,
                    label: t(`hr.day.${d}`),
                  }))}
                />
              </Question>
              <Question label={t('ims.set.ahead')} hint={t('ims.set.aheadHint')}>
                <NumberChoice
                  label={t('ims.set.ahead')}
                  value={rules.ows.daysAhead}
                  presets={[0, 1, 2]}
                  unit={days}
                  min={0}
                  max={6}
                  onChange={(daysAhead) => up('ows', { daysAhead })}
                />
              </Question>
              <p className="py-3 text-sm text-muted-foreground">{t('ims.set.owsQty')}</p>
            </>
          )}
          {tab === 'turns' && (
            <>
              <Question label={t('ims.set.nos')} hint={t('ims.set.nosHint')}>
                <NumberChoice
                  label={t('ims.set.nos')}
                  value={rules.turns.nosTurnsBelow}
                  presets={[6, 10, 12]}
                  unit={t('ims.set.turns')}
                  min={0.5}
                  max={100}
                  onChange={(nosTurnsBelow) => up('turns', { nosTurnsBelow })}
                />
              </Question>
              <Question label={t('ims.set.nosTarget')}>
                <NumberChoice
                  label={t('ims.set.nosTarget')}
                  value={rules.turns.nosTargetPct}
                  presets={[30, 50]}
                  unit="%"
                  step={5}
                  max={100}
                  onChange={(nosTargetPct) => up('turns', { nosTargetPct })}
                />
              </Question>
              <Question label={t('ims.set.growth')}>
                <NumberChoice
                  label={t('ims.set.growth')}
                  value={rules.turns.turnsGrowthPct}
                  presets={[10, 26, 50]}
                  unit="%"
                  max={200}
                  onChange={(turnsGrowthPct) => up('turns', { turnsGrowthPct })}
                />
              </Question>
              <Question label={t('ims.set.bottom')}>
                <NumberChoice
                  label={t('ims.set.bottom')}
                  value={rules.turns.stopBottomPct}
                  presets={[10, 20, 30]}
                  unit="%"
                  step={5}
                  min={1}
                  max={100}
                  onChange={(stopBottomPct) => up('turns', { stopBottomPct })}
                />
              </Question>
            </>
          )}
          {tab === 'audit' && (
            <>
              <Question label={t('ims.set.top')}>
                <NumberChoice
                  label={t('ims.set.top')}
                  value={rules.audit.topByValue}
                  presets={[25, 50, 100]}
                  unit={t('ims.set.itemsUnit')}
                  step={5}
                  min={1}
                  max={1000}
                  onChange={(topByValue) => up('audit', { topByValue })}
                />
              </Question>
              <Question label={t('ims.set.cycle')}>
                <NumberChoice
                  label={t('ims.set.cycle')}
                  value={rules.audit.cycleDays}
                  presets={[30, 60, 90]}
                  unit={days}
                  step={5}
                  min={7}
                  max={365}
                  onChange={(cycleDays) => up('audit', { cycleDays })}
                />
              </Question>
              <Question label={t('ims.set.dead')}>
                <NumberChoice
                  label={t('ims.set.dead')}
                  value={rules.audit.deadAfterDays}
                  presets={[180, 365]}
                  unit={days}
                  step={15}
                  min={30}
                  max={1095}
                  onChange={(deadAfterDays) => up('audit', { deadAfterDays })}
                />
              </Question>
            </>
          )}
          {tab === 'people' && <People rules={rules} up={(x) => up('people', x)} />}
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button disabled={!changed || save.isPending} onClick={() => save.mutate(tab)}>
          {save.isPending ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

function People({ rules, up }: { rules: ImsRules; up: (x: Partial<ImsRules['people']>) => void }) {
  const { t } = useTranslation();
  const users = useUsers();
  const people = users.data ?? [];
  const p = rules.people;
  const role = (key: 'storeKeeperIds' | 'purchaseIds' | 'reviewerIds' | 'auditIds' | 'approverIds') => (
    <Question label={t(`ims.set.role.${key}`)} hint={t(`ims.set.roleHint.${key}`)}>
      <PeoplePicker
        ids={p[key]}
        people={people}
        onChange={(ids) => up({ [key]: ids })}
        label={t(`ims.set.role.${key}`)}
      />
    </Question>
  );
  return (
    <>
      {role('storeKeeperIds')}
      {role('purchaseIds')}
      {role('reviewerIds')}
      {role('auditIds')}
      {role('approverIds')}
      <Question label={t('ims.set.anyOne')} hint={t('ims.set.anyOneHint')}>
        <YesNo label={t('ims.set.anyOne')} value={p.anyOne} onChange={(anyOne) => up({ anyOne })} />
      </Question>
      <Question label={t('ims.set.neverOwn')}>
        <YesNo label={t('ims.set.neverOwn')} value={p.neverOwn} onChange={(neverOwn) => up({ neverOwn })} />
      </Question>
      <Question label={t('ims.set.ownerAlways')}>
        <YesNo
          label={t('ims.set.ownerAlways')}
          value={p.ownerAlways}
          onChange={(ownerAlways) => up({ ownerAlways })}
        />
      </Question>
    </>
  );
}
