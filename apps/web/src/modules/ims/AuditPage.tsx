import { ClipboardList, Loader2, PackageX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatINR, formatLocalDate, localDate, type Me } from '@mono/shared';
import { EmptyState, ErrorState, KpiTile, PageHeader, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TabStrip } from '@/components/work';
import { useParamState } from '@/lib/work';
import { imsApi, qty, useCounts, useDead, useImsMutation, type Count } from './api';

const TABS = ['counts', 'dead'] as const;

/** Inventory → Audit (§10.1): this cycle's counts of the most valuable items, and dead stock. */
export function AuditPage({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { value: tab, set } = useParamState('tab', TABS, 'counts');
  return (
    <div className="space-y-5">
      <PageHeader title={t('nav.stockAudit')} subtitle={t('navDesc.stockAudit')} />
      <TabStrip tabs={TABS} active={tab} onChange={(k) => set({ tab: k })} label={(k) => t(`ims.tab.${k}`)} />
      {tab === 'counts' ? <Counts /> : <Dead tz={me.company.timezone} />}
    </div>
  );
}

function Counts() {
  const { t } = useTranslation();
  const q = useCounts();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <KpiTile
          label={t('ims.a.cycle')}
          value={`${d.done}/${d.counts.length}`}
          hero
          note={t('ims.a.cycleNote', { from: formatLocalDate(d.cycle), next: formatLocalDate(d.nextCycle) })}
        />
        <KpiTile
          label={t('ims.a.differences')}
          value={d.counts.filter((c) => c.differencePaise && c.differencePaise !== '0').length}
        />
      </div>
      {!d.counts.length ? (
        <EmptyState icon={ClipboardList} title={t('ims.a.none')} body={t('ims.a.noneBody')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card">
          {d.counts.map((c) => (
            <CountLine key={c.id} c={c} canCount={d.canCount} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CountLine({ c, canCount }: { c: Count; canCount: boolean }) {
  const { t } = useTranslation();
  const [v, setV] = useState('');
  const save = useImsMutation(
    (body: object) => imsApi.count(c.id, body),
    () => t('ims.a.saved'),
  );
  const n = Number(v.replace(/,/g, ''));
  const diff = c.countedQty !== null && c.systemQty !== null ? c.countedQty - c.systemQty : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
      <div className="min-w-0">
        <div className="font-medium">
          {c.item.name} <span className="font-mono text-xs text-muted-foreground">{c.item.code}</span>
        </div>
        <div className="text-xs text-muted-foreground">{c.item.location ?? t('ims.a.noLocation')}</div>
      </div>
      {c.status === 'OPEN' ? (
        canCount && (
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('ims.a.counted', { name: c.item.name })}
              placeholder={t('ims.a.howMany')}
              inputMode="decimal"
              value={v}
              onChange={(e) => setV(e.target.value)}
              className="w-28 tabular-nums"
            />
            <span className="text-xs text-muted-foreground">{c.item.unit}</span>
            <Button
              size="sm"
              disabled={!(v.trim() && n >= 0) || save.isPending}
              onClick={() => save.mutate({ countedQty: n })}
            >
              {save.isPending && <Loader2 className="animate-spin" />} {t('common.save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => save.mutate({ skip: true })}
            >
              {t('ims.a.skip')}
            </Button>
          </div>
        )
      ) : c.status === 'SKIPPED' ? (
        <StatusChip tone="neutral">{t('ims.a.skipped')}</StatusChip>
      ) : (
        <div className="flex items-center gap-2 tabular-nums">
          <span className="text-muted-foreground">
            {t('ims.a.result', {
              counted: qty(c.countedQty ?? 0),
              system: qty(c.systemQty ?? 0),
              unit: c.item.unit,
            })}
          </span>
          {diff ? (
            <StatusChip tone="warn">
              {`${diff > 0 ? '+' : ''}${qty(diff)} · ${formatINR(c.differencePaise ?? '0', { compact: true })}`}
            </StatusChip>
          ) : (
            <StatusChip tone="ok">{t('ims.a.matches')}</StatusChip>
          )}
        </div>
      )}
    </li>
  );
}

function Dead({ tz }: { tz: string }) {
  const { t } = useTranslation();
  const q = useDead();
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <KpiTile
          label={t('ims.d.value')}
          value={formatINR(d.valuePaise, { compact: true })}
          hero
          tone={d.items.length ? 'bad' : undefined}
        />
        <KpiTile label={t('ims.d.items')} value={d.items.length} note={t('ims.d.rule', { days: d.days })} />
      </div>
      {!d.items.length ? (
        <EmptyState icon={PackageX} title={t('ims.d.none')} />
      ) : (
        <ul className="divide-y rounded-card border bg-card text-sm">
          {d.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium">
                  {i.name} <span className="font-mono text-xs text-muted-foreground">{i.code}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {i.lastMovedAt
                    ? t('ims.d.last', { date: formatLocalDate(localDate(new Date(i.lastMovedAt), tz)) })
                    : t('ims.d.never')}
                  {i.location && ` · ${i.location}`}
                </div>
              </div>
              <span className="tabular-nums">
                {qty(i.stock)} {i.unit} · <b>{formatINR(i.valuePaise, { compact: true })}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
