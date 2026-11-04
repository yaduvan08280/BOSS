import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, formatINR } from '@mono/shared';
import { ErrorState, KpiTile, PageSkeleton } from '@/components/page';
import { StatusChip } from '@/components/status-chip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { TabStrip } from '@/components/work';
import { qty, useReport } from './api';

type Value = { rows: { category: string; items: number; valuePaise: string }[]; totalPaise: string };
type Movement = {
  rows: {
    id: string;
    code: string;
    name: string;
    unit: string;
    in: number;
    out: number;
    adjust: number;
    inValuePaise: string;
    outValuePaise: string;
  }[];
  inPaise: string;
  outPaise: string;
};
type Turns = {
  rules: { nosTurnsBelow: number; nosTargetPct: number; turnsGrowthPct: number; stopBottomPct: number };
  items: { id: string; code: string; name: string; turns: number | null; nos: boolean; valuePaise: string }[];
  nosSharePct: number;
  nosValuePaise: string;
  turnsLast90: number | null;
  turnsPrev90: number | null;
  turnsTarget: number | null;
  offerToStop: string[];
};
type Purchase = {
  byStatus: Record<string, number>;
  vendors: { vendor: string; orders: number; orderedPaise: string; receivedPaise: string }[];
  orderedPaise: string;
  receivedPaise: string;
};

const R = ['value', 'movement', 'turns', 'purchase'] as const;
const inr = (p: string) => formatINR(p, { compact: true });

/** Stock value, movement, turns & NOS, purchase (§10.3). */
export function ReportsTab({ today }: { today: string }) {
  const { t } = useTranslation();
  const [r, setR] = useState<(typeof R)[number]>('value');
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const period = `?from=${from}&to=${to}`;
  return (
    <div className="space-y-4">
      <TabStrip tabs={R} active={r} onChange={setR} label={(k) => t(`ims.r.${k}`)} />
      {(r === 'movement' || r === 'purchase') && (
        <div className="flex flex-wrap gap-2">
          <DateInput value={from} onChange={setFrom} aria-label={t('ims.sh.from')} className="w-40" />
          <DateInput value={to} onChange={setTo} aria-label={t('ims.sh.to')} className="w-40" />
        </div>
      )}
      {r === 'value' && <ValueReport />}
      {r === 'movement' && <MovementReport period={period} />}
      {r === 'turns' && <TurnsReport />}
      {r === 'purchase' && <PurchaseReport period={period} />}
    </div>
  );
}

function Wait<T>({
  q,
  children,
}: {
  q: { isPending: boolean; isError: boolean; data?: T; refetch: () => unknown };
  children: (d: T) => React.ReactNode;
}) {
  if (q.isPending) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

function ValueReport() {
  const { t } = useTranslation();
  return (
    <Wait q={useReport<Value>('value')}>
      {(d) => (
        <Card>
          <CardHeader>
            <CardTitle>{t('ims.r.total', { value: inr(d.totalPaise) })}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {d.rows.map((x) => (
                <li key={x.category} className="flex justify-between gap-2 py-2">
                  <span>
                    {x.category}{' '}
                    <span className="text-muted-foreground">· {t('ims.r.items', { count: x.items })}</span>
                  </span>
                  <b className="tabular-nums">{inr(x.valuePaise)}</b>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </Wait>
  );
}

function MovementReport({ period }: { period: string }) {
  const { t } = useTranslation();
  return (
    <Wait q={useReport<Movement>('movement', period)}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <KpiTile label={t('ims.r.in')} value={inr(d.inPaise)} />
            <KpiTile label={t('ims.r.out')} value={inr(d.outPaise)} hero />
          </div>
          <div className="overflow-x-auto rounded-card border bg-card">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {['item', 'in', 'out', 'adjust', 'outValue'].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {t(`ims.r.col.${h}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="px-3 py-2">
                      {x.name} <span className="font-mono text-xs text-muted-foreground">{x.code}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{qty(x.in)}</td>
                    <td className="px-3 py-2 tabular-nums">{qty(x.out)}</td>
                    <td className="px-3 py-2 tabular-nums">{qty(x.adjust)}</td>
                    <td className="px-3 py-2 tabular-nums">{inr(x.outValuePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Wait>
  );
}

function TurnsReport() {
  const { t } = useTranslation();
  return (
    <Wait q={useReport<Turns>('turns')}>
      {(d) => {
        const stop = new Set(d.offerToStop);
        return (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <KpiTile
                label={t('ims.r.turns90')}
                value={d.turnsLast90 ?? '—'}
                hero
                note={
                  d.turnsTarget !== null
                    ? t('ims.r.turnsTarget', { target: d.turnsTarget, prev: d.turnsPrev90 })
                    : t('ims.r.turnsNoPrev')
                }
              />
              <KpiTile
                label={t('ims.r.nosShare')}
                value={`${d.nosSharePct}%`}
                tone={d.nosSharePct > d.rules.nosTargetPct ? 'bad' : undefined}
                note={t('ims.r.nosTarget', { pct: d.rules.nosTargetPct, value: inr(d.nosValuePaise) })}
              />
              <KpiTile
                label={t('ims.r.toStop')}
                value={stop.size}
                note={t('ims.r.toStopNote', { pct: d.rules.stopBottomPct })}
              />
            </div>
            <ul className="divide-y rounded-card border bg-card text-sm">
              {d.items.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span>
                    {x.name} <span className="font-mono text-xs text-muted-foreground">{x.code}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {stop.has(x.id) && <StatusChip tone="bad">{t('ims.r.offerStop')}</StatusChip>}
                    {x.nos && <StatusChip tone="warn">{t('ims.r.nos')}</StatusChip>}
                    <span className="text-muted-foreground tabular-nums">{inr(x.valuePaise)}</span>
                    <b className="w-20 text-right tabular-nums">
                      {x.turns === null ? '—' : t('ims.r.turnsN', { n: x.turns })}
                    </b>
                  </span>
                </li>
              ))}
            </ul>
          </>
        );
      }}
    </Wait>
  );
}

function PurchaseReport({ period }: { period: string }) {
  const { t } = useTranslation();
  return (
    <Wait q={useReport<Purchase>('purchase', period)}>
      {(d) => (
        <>
          <div className="grid grid-cols-2 gap-2">
            <KpiTile label={t('ims.r.ordered')} value={inr(d.orderedPaise)} hero />
            <KpiTile label={t('ims.r.received')} value={inr(d.receivedPaise)} />
          </div>
          <ul className="divide-y rounded-card border bg-card text-sm">
            {d.vendors.map((v) => (
              <li key={v.vendor} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                <span>
                  {v.vendor}{' '}
                  <span className="text-muted-foreground">· {t('ims.r.orders', { count: v.orders })}</span>
                </span>
                <span className="tabular-nums">
                  {inr(v.receivedPaise)} / <b>{inr(v.orderedPaise)}</b>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Wait>
  );
}
