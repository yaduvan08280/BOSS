import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/form';
import type { ExtrasProps } from './types';

/**
 * Item lines (§2.4): picked from the item master, or typed by hand as well. A field made before phase 11 has no
 * setting and keeps accepting typed lines, so it shows as "on" until someone switches it off.
 */
export function ItemsExtras({ field, onChange }: ExtrasProps) {
  const { t } = useTranslation();
  if (field.type !== 'items') return null;
  return (
    <div className="space-y-0.5">
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={field.freeItems !== false}
          onChange={(e) => onChange({ freeItems: e.target.checked })}
        />
        {t('stockSteps.extras.free')}
      </label>
      <p className="text-xs text-muted-foreground">{t('stockSteps.extras.freeHint')}</p>
    </div>
  );
}
