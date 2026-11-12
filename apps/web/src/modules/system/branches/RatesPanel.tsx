import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Coins } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, PageSkeleton } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { put, useOrgMutation } from '../api';
import { useStructure } from './api';

type Rate = { currency: string; month: string; rate: number };

/**
 * Exchange rates (decision 11): one rate per currency per month, typed by an accountant — rupees for one unit.
 * Group totals (payroll for the whole company, group reports) are shown in rupees with them.
 */
export function RatesPanel() {
  const { t, i18n } = useTranslation();
  const structure = useStructure();
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const rates = useQuery({
    queryKey: ['org', 'rates', y],
    queryFn: () => api<Rate[]>(`/api/branches/rates?year=${y}`),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useOrgMutation(
    (currency: string) => put('/api/branches/rates', { currency, month, rate: Number(draft[currency] || 0) }),
    { success: t('org.saved') },
  );
  const shift = (by: number) => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    setDraft({});
  };
  if (structure.isPending || rates.isPending) return <PageSkeleton />;
  if (structure.isError || rates.isError) return <ErrorState onRetry={() => void rates.refetch()} />;
  const currencies = [...new Set(structure.data.entities.map((e) => e.currency))].filter((c) => c !== 'INR');
  const label = new Intl.DateTimeFormat(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  if (!currencies.length)
    return <EmptyState icon={Coins} title={t('rates.emptyTitle')} body={t('rates.emptyBody')} />;
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">{t('rates.intro')}</p>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.prevMonth')} onClick={() => shift(-1)}>
          <ChevronLeft />
        </Button>
        <div className="min-w-36 text-center text-sm font-semibold">{label}</div>
        <Button size="icon-sm" variant="ghost" aria-label={t('hr.a.nextMonth')} onClick={() => shift(1)}>
          <ChevronRight />
        </Button>
      </div>
      <ul className="space-y-2">
        {currencies.map((c) => {
          const saved = rates.data.find((r) => r.currency === c && r.month === month)?.rate;
          const value = draft[c] ?? (saved !== undefined ? String(saved) : '');
          return (
            <li key={c}>
              <Card className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold">{c}</div>
                  <div className="text-xs text-muted-foreground">
                    {saved !== undefined ? t('rates.saved', { c, rate: saved }) : t('rates.none')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">₹</span>
                  <Input
                    aria-label={t('rates.rateFor', { c })}
                    inputMode="decimal"
                    className="w-28 tabular-nums"
                    value={value}
                    onChange={(e) => setDraft({ ...draft, [c]: e.target.value })}
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={draft[c] === undefined || Number.isNaN(Number(draft[c])) || save.isPending}
                    onClick={() => save.mutate(c, { onSuccess: () => setDraft({}) })}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
