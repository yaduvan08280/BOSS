import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Card } from '@/components/ui/card';
import { rupees } from '@/modules/stock/api';
import { Seg } from '@/modules/stock/ui';
import { AgentsCard } from './AgentsCard';
import { useHealth, useLog, when } from './api';
import { ChannelCard } from './ChannelCard';
import { EinvoiceCard, GatewayCard } from './GatewayCard';
import { PayoutCard } from './PayoutCard';

type Tab = 'connections' | 'channels' | 'agents' | 'payouts' | 'log';

/** System Master → Integration → Connections (phase 19): what talks to the outside world, and whether it works. */
export function ConnectTab({ me }: { me: Me }) {
  const { t } = useTranslation();
  const health = useHealth();
  const [tab, setTab] = useState<Tab>('connections');
  const canAdmin = hasPermission(me.user.permissions, 'integrations.admin');
  if (health.isPending) return <PageSkeleton />;
  if (health.isError || !health.data) return <ErrorState onRetry={() => void health.refetch()} />;
  const h = health.data;
  const find = (kind: string) => h.connections.find((c) => c.kind === kind && c.active);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile
          hero
          label={t('connect.health')}
          value={h.ok ? t('connect.allWell') : t('connect.problems', { count: h.problems })}
        />
        <KpiTile label={t('connect.overbooked')} value={String(h.overbooked)} />
        <KpiTile
          label={t('connect.agentsOnline')}
          value={`${h.agents.filter((a) => a.online).length}/${h.agents.length}`}
          note={t('connect.printWaiting', { count: h.printWaiting })}
        />
        <KpiTile
          label={t('connect.tally')}
          value={String(h.tally.waiting)}
          note={t('connect.tallyFailed', { count: h.tally.failed })}
        />
      </div>
      {h.payments.length > 0 && (
        <Card className="space-y-1 border-status-bad-fg/40 p-3" data-testid="stuck-payments">
          <div className="text-sm font-semibold">{t('connect.stuck')}</div>
          {h.payments.map((p) => (
            <div key={p.id} className="text-xs text-muted-foreground">
              {t(`connect.purpose.${p.purpose}`)} · {rupees(p.amount)} · {p.note}
            </div>
          ))}
        </Card>
      )}
      <Seg
        value={tab}
        onChange={setTab}
        options={(['connections', 'channels', 'agents', 'payouts', 'log'] as const).map((key) => ({
          key,
          label: t(`connect.tab.${key}`),
        }))}
      />
      {tab === 'connections' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <GatewayCard connection={find('GATEWAY')} canAdmin={canAdmin} />
          <EinvoiceCard connection={find('EINVOICE')} canAdmin={canAdmin} />
        </div>
      )}
      {tab === 'channels' && (
        <ChannelCard
          connections={h.connections.filter((c) => c.kind === 'CHANNEL')}
          canAdmin={canAdmin}
          me={me}
        />
      )}
      {tab === 'agents' && <AgentsCard health={h} canAdmin={canAdmin} me={me} />}
      {tab === 'payouts' && <PayoutCard me={me} />}
      {tab === 'log' && <LogList />}
    </div>
  );
}

function LogList() {
  const { t } = useTranslation();
  const log = useLog();
  if (log.isPending) return <PageSkeleton />;
  if (!log.data?.length) return <p className="text-sm text-muted-foreground">{t('connect.noLog')}</p>;
  return (
    <ul className="space-y-2">
      {log.data.map((l) => (
        <li key={l.id}>
          <Card className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium">
                {t(`connect.dir.${l.direction}`)} · {t(`connect.what.${l.what}`, { defaultValue: l.what })}
                {l.ref ? <span className="ml-1 font-mono text-xs">{l.ref}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {when(l.at)}
                {l.error ? ` · ${l.error}` : ''}
              </div>
            </div>
            <StatusChip tone={l.status === 'OK' ? 'ok' : l.status === 'PENDING' ? 'warn' : 'bad'}>
              {t(`connect.status.${l.status}`)}
            </StatusChip>
          </Card>
        </li>
      ))}
    </ul>
  );
}
