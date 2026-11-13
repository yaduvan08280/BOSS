import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState, PageSkeleton } from '@/components/page';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/form';
import { Seg } from '@/modules/stock/ui';
import { send, useHosp, useHospMutation } from './api';
import { FloorsPanel } from './FloorsPanel';
import { OutletsPanel } from './OutletsPanel';
import { PrintersPanel } from './PrintersPanel';
import { RoomsPanel } from './RoomsPanel';
import { RulesPanel } from './RulesPanel';

const PARTS = ['outlets', 'floors', 'rooms', 'printers', 'rules'] as const;

/** System Master → Hospitality (phase 14): switch the module on, then set up outlets, floors, rooms, printers and rules. */
export function HospitalitySetupTab() {
  const { t } = useTranslation();
  const q = useHosp();
  const [part, setPart] = useState<(typeof PARTS)[number]>('outlets');
  const toggle = useHospMutation(
    (enabled: boolean) => send('PUT', '/api/hosp/settings', { enabled }),
    t('org.saved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-5">
      <Card className="flex items-center justify-between gap-4 p-4">
        <div>
          <div className="font-medium">{t('hosp.switch.title')}</div>
          <p className="text-sm text-muted-foreground">{t('hosp.switch.body')}</p>
        </div>
        <Switch
          aria-label={t('hosp.switch.title')}
          checked={q.data.enabled}
          disabled={!q.data.canAdmin || toggle.isPending}
          onCheckedChange={(v) => toggle.mutate(v)}
        />
      </Card>
      {q.data.enabled && (
        <>
          <Seg
            value={part}
            onChange={setPart}
            options={PARTS.map((k) => ({ key: k, label: t(`hosp.part.${k}`) }))}
          />
          {part === 'outlets' && <OutletsPanel />}
          {part === 'floors' && <FloorsPanel />}
          {part === 'rooms' && <RoomsPanel />}
          {part === 'printers' && <PrintersPanel />}
          {part === 'rules' && <RulesPanel rules={q.data.rules} />}
        </>
      )}
    </div>
  );
}
