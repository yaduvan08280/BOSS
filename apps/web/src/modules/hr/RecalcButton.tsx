import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';

/** The six months up to this one, newest first ("2026-11"). */
function recentMonths(today: string) {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** HR: work a month's attendance out again with today's rules (after a rule was changed). */
export function RecalcButton({ today }: { today: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const months = recentMonths(today);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(months[0]!);
  const run = useMutation({
    mutationFn: () =>
      api<{ days: number; changed: number }>('/api/hr/attendance/recalculate', {
        method: 'POST',
        body: { month },
      }),
    onSuccess: (r) => {
      toast.success(t('recalc.done', { days: r.days, changed: r.changed }));
      void qc.invalidateQueries({ queryKey: ['hr'] });
      void qc.invalidateQueries();
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : t('recalc.failed')),
  });
  const label = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <RefreshCcw /> {t('recalc.button')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('recalc.title')}
        description={t('recalc.hint')}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={run.isPending} onClick={() => run.mutate()}>
              {t('recalc.go', { month: label(month) })}
            </Button>
          </>
        }
      >
        <div className="pb-3">
          <Field label={t('recalc.month')}>
            <Select value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t('recalc.month')}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {label(m)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </>
  );
}
