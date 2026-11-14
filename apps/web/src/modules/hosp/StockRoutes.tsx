import { useTranslation } from 'react-i18next';
import { Field, Select } from '@/components/ui/form';
import { useMenu } from './api';

export type StockRoute = { category: string; locationId: string };

/**
 * Menu categories that take their stock from another location of the branch — the bar's drinks from the bar
 * while food comes from the kitchen. A category left on "Same as the outlet" uses the outlet's own location.
 */
export function StockRoutes({
  places,
  value,
  onChange,
}: {
  places: { id: string; name: string }[];
  value: StockRoute[];
  onChange: (v: StockRoute[]) => void;
}) {
  const { t } = useTranslation();
  const categories = useMenu().data?.categories ?? [];
  if (!categories.length || !places.length) return null;
  const set = (category: string, locationId: string) =>
    onChange([
      ...value.filter((r) => r.category !== category),
      ...(locationId ? [{ category, locationId }] : []),
    ]);
  return (
    <Field label={t('stockRoutes.title')} hint={t('stockRoutes.hint')} className="sm:col-span-2">
      <ul className="divide-y rounded-control border">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="min-w-0 truncate text-sm">{c.name}</span>
            <Select
              value={value.find((r) => r.category === c.name)?.locationId ?? ''}
              onChange={(e) => set(c.name, e.target.value)}
              aria-label={t('stockRoutes.from', { category: c.name })}
              className="h-9 w-44 shrink-0 sm:h-9"
            >
              <option value="">{t('stockRoutes.same')}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
    </Field>
  );
}
