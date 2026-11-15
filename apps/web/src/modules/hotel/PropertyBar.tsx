import { useTranslation } from 'react-i18next';
import { usePropertyScope } from './scope-ctx';
import { Select } from '@/components/ui/form';
import { dmy } from './api';

/** Which property, and its business date (it moves only with the night audit). */
export function PropertyBar({
  list,
  branchId,
  onChange,
  businessDate,
}: {
  list: { id: string; name: string }[];
  branchId: string;
  onChange: (id: string) => void;
  businessDate?: string;
}) {
  const { t } = useTranslation();
  const scope = usePropertyScope();
  // One of several stacked properties: its name is the heading, not a picker.
  if (scope?.fixed)
    return (
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-semibold">{scope.fixed.name}</h2>
        {businessDate && (
          <span className="text-sm text-muted-foreground">
            {t('hotel.businessDate', { date: dmy(businessDate) })}
          </span>
        )}
      </div>
    );
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="w-full sm:w-64">
        <Select aria-label={t('hotel.property')} value={branchId} onChange={(e) => onChange(e.target.value)}>
          {scope && list.length > 1 && <option value="">{t('hotelAll.all')}</option>}
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      {businessDate && (
        <span className="text-sm text-muted-foreground">
          {t('hotel.businessDate', { date: dmy(businessDate) })}
        </span>
      )}
    </div>
  );
}
