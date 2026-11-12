import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Licence } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Input } from '@/components/ui/input';

/** Licences and registrations printed on papers (FSSAI, liquor, trade …), each with its number and last day. */
export function Licences({ value, onChange }: { value: Licence[]; onChange: (v: Licence[]) => void }) {
  const { t } = useTranslation();
  const set = (i: number, patch: Partial<Licence>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{t('branches.lic.title')}</div>
      {value.map((l, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-control border p-2 sm:grid-cols-[1fr_1fr_150px_auto]"
        >
          <Input
            aria-label={t('branches.lic.name')}
            placeholder={t('branches.lic.namePh')}
            value={l.name}
            onChange={(e) => set(i, { name: e.target.value })}
          />
          <Input
            aria-label={t('branches.lic.number')}
            placeholder={t('branches.lic.number')}
            value={l.number}
            className="font-mono"
            onChange={(e) => set(i, { number: e.target.value })}
          />
          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
            <DateInput
              aria-label={t('branches.lic.validTill')}
              value={l.validTill ?? ''}
              onChange={(v) => set(i, { validTill: v || null })}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.remove')}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...value, { name: '', number: '' }])}>
        <Plus /> {t('branches.lic.add')}
      </Button>
    </div>
  );
}
