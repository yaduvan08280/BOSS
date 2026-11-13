import { useTranslation } from 'react-i18next';
import type { Place } from './api';

/** The name a place shows as: the main store is translated, a location carries its branch. */
export function usePlaceName() {
  const { t } = useTranslation();
  return (p: Pick<Place, 'id' | 'name' | 'branch'> | null | undefined) =>
    !p
      ? '—'
      : p.id === ''
        ? t('stock.mainStore')
        : p.id === '~transit'
          ? t('stock.inTransit')
          : p.branch
            ? `${p.name} · ${p.branch}`
            : p.name;
}
