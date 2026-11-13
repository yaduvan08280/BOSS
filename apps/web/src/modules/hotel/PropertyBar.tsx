import { useTranslation } from 'react-i18next';
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
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="w-full sm:w-64">
        <Select aria-label={t('hotel.property')} value={branchId} onChange={(e) => onChange(e.target.value)}>
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
