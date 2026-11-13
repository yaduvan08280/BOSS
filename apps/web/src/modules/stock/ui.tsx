import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import type { ItemLite, Place } from './api';
import { usePlaceName } from './place-name';

/** A row of pill tabs. */
export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-control bg-muted p-1 sm:inline-flex"
    >
      {options.map((o) => (
        <button
          key={o.key}
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={cn(
            'h-9 shrink-0 rounded-[calc(var(--radius)*0.5)] px-3 text-sm font-medium',
            value === o.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PlaceSelect({
  value,
  places,
  onChange,
  label,
  all,
}: {
  value: string;
  places: Place[];
  onChange: (id: string) => void;
  label: string;
  /** Offer "every location" (value "*"). */
  all?: boolean;
}) {
  const { t } = useTranslation();
  const name = usePlaceName();
  return (
    <Select
      aria-label={label}
      value={value === '' ? '~main' : value}
      onChange={(e) => onChange(e.target.value === '~main' ? '' : e.target.value)}
    >
      {all && <option value="*">{t('stock.allPlaces')}</option>}
      {places
        .filter((p) => p.id !== '~transit')
        .map((p) => (
          <option key={p.id || '~main'} value={p.id || '~main'}>
            {name(p)}
          </option>
        ))}
    </Select>
  );
}
export function ItemSelect({
  value,
  items,
  onChange,
  label,
}: {
  value: string;
  items: ItemLite[];
  onChange: (id: string) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('org.choose')}</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {`${i.name} · ${i.code}`}
        </option>
      ))}
    </Select>
  );
}
