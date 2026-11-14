import { useMutation } from '@tanstack/react-query';
import { Eye, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HrRules } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { api } from '@/lib/api';

type Preview = {
  from: string;
  days: number;
  changed: number;
  people: number;
  examples: { name: string; date: string; from: string; to: string }[];
  closedMonths: string[];
};
const dmy = (day: string) => day.split('-').reverse().join('/');

/**
 * When a changed rule starts: from today (days already recorded stay as they are), or from a date — then the
 * recorded days from that date are worked out again. "See what would change" tries it without saving.
 */
export function RuleStart({
  rules,
  from,
  onFrom,
}: {
  rules: HrRules;
  /** '' = from today. */
  from: string;
  onFrom: (v: string) => void;
}) {
  const { t } = useTranslation();
  const preview = useMutation({
    mutationFn: () =>
      api<Preview>(`/api/hr/rules/preview${from ? `?from=${from}` : ''}`, { method: 'POST', body: rules }),
  });
  const p = preview.data;
  return (
    <fieldset className="space-y-2 rounded-card border bg-card p-4 text-sm">
      <legend className="px-1 font-semibold">{t('ruleStart.title')}</legend>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="rule-start"
          className="mt-1 size-4 accent-[var(--primary)]"
          checked={!from}
          onChange={() => (onFrom(''), preview.reset())}
        />
        <span>
          <span className="font-medium">{t('ruleStart.now')}</span>
          <span className="block text-xs text-muted-foreground">{t('ruleStart.nowHint')}</span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="radio"
          name="rule-start"
          className="mt-1 size-4 accent-[var(--primary)]"
          checked={!!from}
          onChange={() => (onFrom(new Date().toISOString().slice(0, 8) + '01'), preview.reset())}
        />
        <span>
          <span className="font-medium">{t('ruleStart.dated')}</span>
          <span className="block text-xs text-muted-foreground">{t('ruleStart.datedHint')}</span>
        </span>
      </label>
      {from && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <DateInput
            value={from}
            onChange={(v) => (onFrom(v), preview.reset())}
            aria-label={t('ruleStart.date')}
            className="w-40"
          />
          <Button size="sm" disabled={preview.isPending} onClick={() => preview.mutate()}>
            {preview.isPending ? <Loader2 className="animate-spin" /> : <Eye />} {t('ruleStart.see')}
          </Button>
        </div>
      )}
      {from && p && (
        <div className="ml-6 rounded-control bg-muted p-3">
          <div className="font-medium">
            {p.changed
              ? t('ruleStart.would', { days: p.changed, people: p.people, from: dmy(p.from) })
              : t('ruleStart.nothing', { days: p.days })}
          </div>
          {p.examples.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
              {p.examples.map((e, i) => (
                <li key={i}>
                  {e.name} · {dmy(e.date)} · {t(`hr.status.${e.from}`, e.from)} →{' '}
                  {t(`hr.status.${e.to}`, e.to)}
                </li>
              ))}
            </ul>
          )}
          {p.closedMonths.length > 0 && (
            <p className="mt-1.5 text-xs text-status-warn-fg">
              {t('ruleStart.closed', {
                months: p.closedMonths.map((m) => `${m.slice(5)}/${m.slice(0, 4)}`).join(', '),
              })}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
