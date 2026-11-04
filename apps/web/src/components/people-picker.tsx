import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OrgPerson } from '@mono/shared';
import { Select } from '@/components/ui/form';
import { personLabel } from '@/lib/people';

/** People chips with a type-to-filter picker to add more. */
export function PeoplePicker({
  ids,
  people,
  onChange,
  label,
}: {
  ids: string[];
  people: OrgPerson[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const name = new Map(people.map((p) => [p.id, p.name]));
  return (
    <div className="space-y-2">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-pill bg-muted py-1 pl-3 pr-1 text-sm"
            >
              {name.get(id) ?? '?'}
              <button
                type="button"
                aria-label={t('common.remove')}
                className="grid size-5 place-items-center rounded-full hover:bg-card"
                onClick={() => onChange(ids.filter((x) => x !== id))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Select
        aria-label={label}
        value=""
        onChange={(e) => e.target.value && onChange([...ids, e.target.value])}
      >
        <option value="">{t('fms.b.addPerson')}</option>
        {people
          .filter((p) => p.status === 'ACTIVE' && !ids.includes(p.id))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {personLabel(p)}
            </option>
          ))}
      </Select>
    </div>
  );
}
