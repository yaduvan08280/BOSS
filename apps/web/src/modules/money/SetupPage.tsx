import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatLocalDate } from '@mono/shared';
import { ErrorState, PageHeader, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useModes, useMoneyMutation, useParties, useTaxRates, useToday } from './api';

const PARTS = ['rates', 'modes', 'vendors', 'tally'] as const;
const MODE_KINDS = ['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT'] as const;

/** Money set-up for the accounts admin: tax rates by date, payment modes, vendor matching, the Tally map. */
export function MoneySetupPage() {
  const { t } = useTranslation();
  const [part, setPart] = useState<(typeof PARTS)[number]>('rates');
  return (
    <div>
      <PageHeader title={t('money.setup.title')} subtitle={t('money.setup.subtitle')} />
      <div
        role="tablist"
        className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-control bg-muted p-1 sm:inline-flex"
      >
        {PARTS.map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={part === p}
            onClick={() => setPart(p)}
            className={cn(
              'h-9 shrink-0 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium',
              part === p ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {t(`money.setup.${p}`)}
          </button>
        ))}
      </div>
      {part === 'rates' ? (
        <Rates />
      ) : part === 'modes' ? (
        <Modes />
      ) : part === 'vendors' ? (
        <Vendors />
      ) : (
        <Tally />
      )}
    </div>
  );
}

function Rates() {
  const { t } = useTranslation();
  const q = useTaxRates();
  const [d, setD] = useState({ code: '', percent: '', from: useToday() });
  const save = useMoneyMutation(
    () =>
      api('/api/money/tax-rates', {
        method: 'PUT',
        body: { code: d.code, name: `${d.code} ${d.percent}%`, percent: Number(d.percent), from: d.from },
      }),
    t('org.saved'),
  );
  const del = useMoneyMutation(
    (id: string) => api(`/api/money/tax-rates/${id}`, { method: 'DELETE' }),
    t('org.deleted'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">{t('money.rates.intro')}</p>
      <Card className="grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[1fr_100px_150px_auto]">
        <Field label={t('money.rates.code')}>
          <Input
            value={d.code}
            placeholder="GST5"
            className="font-mono"
            onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label={t('money.rates.percent')}>
          <Input
            inputMode="decimal"
            value={d.percent}
            onChange={(e) => setD({ ...d, percent: e.target.value })}
          />
        </Field>
        <Field label={t('money.rates.from')}>
          <DateInput
            value={d.from}
            onChange={(from) => setD({ ...d, from })}
            aria-label={t('money.rates.from')}
          />
        </Field>
        <Button
          variant="primary"
          disabled={
            !/^[A-Z0-9_-]{1,20}$/.test(d.code) ||
            d.percent === '' ||
            Number.isNaN(Number(d.percent)) ||
            save.isPending
          }
          onClick={() => save.mutate(undefined, { onSuccess: () => setD({ ...d, code: '', percent: '' }) })}
        >
          <Plus /> {t('money.rates.add')}
        </Button>
      </Card>
      <ul className="space-y-2">
        {q.data.map((r) => (
          <li key={r.id}>
            <Card className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <span className="font-mono font-medium">{r.code}</span>{' '}
                <span className="tabular">{r.slabs?.length ? t('money.rates.bySlab') : `${r.percent}%`}</span>
                <div className="text-xs text-muted-foreground">
                  {t('money.rates.since', { date: formatLocalDate(r.from) })}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('org.delete')}
                onClick={() => del.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Modes() {
  const { t } = useTranslation();
  const q = useModes();
  const [d, setD] = useState<{ name: string; kind: (typeof MODE_KINDS)[number] }>({ name: '', kind: 'CASH' });
  const save = useMoneyMutation(() => api('/api/money/modes', { method: 'POST', body: d }), t('org.saved'));
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="max-w-xl space-y-3">
      <Card className="grid grid-cols-2 items-end gap-2 p-3 sm:grid-cols-[1fr_140px_auto]">
        <Field label={t('org.name')}>
          <Input
            value={d.name}
            placeholder={t('money.modes.namePh')}
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </Field>
        <Field label={t('money.modes.kind')}>
          <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as typeof d.kind })}>
            {MODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`money.modes.k.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="primary"
          disabled={!d.name.trim() || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setD({ ...d, name: '' }) })}
        >
          <Plus /> {t('money.modes.add')}
        </Button>
      </Card>
      <ul className="space-y-2">
        {q.data.map((m) => (
          <li key={m.id}>
            <Card className="flex items-center justify-between p-3 text-sm">
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground">{t(`money.modes.k.${m.kind}`)}</span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Typed = {
  name: string;
  items: number;
  orders: number;
  partyId: string | null;
  suggestion: { id: string; name: string } | null;
};
function Vendors() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['money', 'vendors'], queryFn: () => api<Typed[]>('/api/money/vendors') });
  const parties = useParties();
  const match = useMoneyMutation(
    (body: { name: string; partyId?: string | null }) =>
      api('/api/money/vendors/match', { method: 'POST', body }),
    t('org.saved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  const name = new Map((parties.data ?? []).map((p) => [p.id, p.name]));
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">{t('money.vendors.intro')}</p>
      {q.data.length === 0 && <p className="text-sm text-muted-foreground">{t('money.vendors.none')}</p>}
      <ul className="space-y-2">
        {q.data.map((v) => (
          <li key={v.name}>
            <Card className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-40">
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('money.vendors.usedOn', { items: v.items, orders: v.orders })}
                </div>
              </div>
              {v.partyId ? (
                <span className="text-sm text-status-ok-fg">
                  {t('money.vendors.is', { name: name.get(v.partyId) ?? '?' })}
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {v.suggestion && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => match.mutate({ name: v.name, partyId: v.suggestion!.id })}
                    >
                      {t('money.vendors.sameAs', { name: v.suggestion.name })}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => match.mutate({ name: v.name })}>
                    {t('money.vendors.makeNew')}
                  </Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

type MapRow = { head: string; ledger: string | null };
function Tally() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['money', 'tally'], queryFn: () => api<MapRow[]>('/api/money/tally/map') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMoneyMutation(
    () =>
      api('/api/money/tally/map', {
        method: 'PUT',
        body: { rows: Object.entries(draft).map(([head, ledger]) => ({ head, ledger: ledger || null })) },
      }),
    t('org.saved'),
  );
  if (q.isPending) return <PageSkeleton />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} error={q.error} />;
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">{t('money.tally.intro')}</p>
      {q.data.length === 0 && <p className="text-sm text-muted-foreground">{t('money.tally.none')}</p>}
      <ul className="space-y-2">
        {q.data.map((r) => (
          <li key={r.head}>
            <Card className="grid grid-cols-1 items-center gap-2 p-3 sm:grid-cols-2">
              <span className="font-mono text-sm">{r.head}</span>
              <Input
                aria-label={t('money.tally.ledgerFor', { head: r.head })}
                placeholder={t('money.tally.ledger')}
                value={draft[r.head] ?? r.ledger ?? ''}
                onChange={(e) => setDraft({ ...draft, [r.head]: e.target.value })}
              />
            </Card>
          </li>
        ))}
      </ul>
      {q.data.length > 0 && (
        <Button
          variant="primary"
          disabled={!Object.keys(draft).length || save.isPending}
          onClick={() => save.mutate(undefined, { onSuccess: () => setDraft({}) })}
        >
          {t('common.save')}
        </Button>
      )}
    </div>
  );
}
