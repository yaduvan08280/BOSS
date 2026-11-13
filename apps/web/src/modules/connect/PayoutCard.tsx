import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hasPermission, type Me } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { rupees } from '@/modules/stock/api';
import { dmy, send, useAggregators, useConnectMutation, when, type Payout } from './api';

/** Delivery aggregators: what waits for a payout, and importing a payout file (look first, then record). */
export function PayoutCard({ me }: { me: Me }) {
  const { t } = useTranslation();
  const report = useAggregators();
  const [aggregator, setAggregator] = useState('ZOMATO');
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [result, setResult] = useState<Payout | null>(null);
  const canImport = hasPermission(me.user.permissions, 'hosp.edit');
  const run = useConnectMutation(
    (dryRun: boolean) =>
      send<Payout>('/api/connect/payouts', { aggregator, csv: file!.csv, fileName: file!.name, dryRun }),
    (r) => {
      setResult(r);
      return r.id ? t('connect.imported', { count: r.summary.matched }) : undefined;
    },
  );
  const s = result?.summary;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-4" data-testid="payout-card">
        <div>
          <h3 className="font-semibold">{t('connect.payout')}</h3>
          <p className="text-xs text-muted-foreground">{t('connect.payoutHint')}</p>
        </div>
        <Field label={t('connect.aggregator')}>
          <Select
            aria-label={t('connect.aggregator')}
            value={aggregator}
            onChange={(e) => {
              setAggregator(e.target.value);
              setResult(null);
            }}
          >
            <option value="ZOMATO">Zomato</option>
            <option value="SWIGGY">Swiggy</option>
            <option value="OTHER">{t('connect.otherPartner')}</option>
          </Select>
        </Field>
        <Field label={t('connect.file')}>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t('connect.file')}
            className="block w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setResult(null);
              if (!f) return setFile(null);
              void f.text().then((csv) => setFile({ name: f.name, csv }));
            }}
          />
        </Field>
        {canImport && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!file || run.isPending} onClick={() => run.mutate(true)}>
              {t('connect.check')}
            </Button>
            <Button
              disabled={!file || run.isPending || !s || s.matched === 0}
              onClick={() => run.mutate(false)}
            >
              {t('connect.import')}
            </Button>
          </div>
        )}
        {s && result && (
          <div className="space-y-1 rounded-control border p-3 text-sm" data-testid="payout-result">
            <div className="font-medium">{result.id ? t('connect.recorded') : t('connect.looked')}</div>
            <div>
              {t('connect.matched', { count: s.matched, net: rupees(s.net), kept: rupees(s.deductions) })}
            </div>
            {s.diff !== 0 && (
              <div className="text-status-bad-fg">{t('connect.diff', { amount: rupees(s.diff) })}</div>
            )}
            {result.unknown.length > 0 && (
              <div>{t('connect.unknown', { refs: result.unknown.map((u) => u.ref).join(', ') })}</div>
            )}
            {result.unpaid.length > 0 && (
              <div>{t('connect.unpaid', { refs: result.unpaid.map((u) => u.ref).join(', ') })}</div>
            )}
            {s.again > 0 && <div>{t('connect.again', { count: s.again })}</div>}
          </div>
        )}
      </Card>
      <Card className="space-y-3 p-4" data-testid="waiting-card">
        <h3 className="font-semibold">{t('connect.waitingPayout')}</h3>
        {(report.data?.sides ?? []).map((side) => (
          <div key={side.aggregator} className="space-y-1 text-sm">
            <div className="font-medium">
              {side.name} · {rupees(side.waitingAmount)}
            </div>
            {side.waiting.map((o) => (
              <div key={o.id} className="text-xs text-muted-foreground">
                <span className="font-mono">{o.ref}</span> · {dmy(o.businessDay)} · {rupees(o.billed)}
              </div>
            ))}
          </div>
        ))}
        {(report.data?.sides.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">{t('connect.noOrders')}</p>
        )}
        {(report.data?.imports ?? []).length > 0 && (
          <div className="border-t pt-2 text-xs text-muted-foreground">
            {report.data!.imports.map((i) => (
              <div key={i.id}>
                {when(i.createdAt)} · {i.aggregator} · {i.fileName ?? '—'}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
