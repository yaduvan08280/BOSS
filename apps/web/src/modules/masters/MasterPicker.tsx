import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useMasterOptions } from './api';

/**
 * A "from a master" field: type to search the master (customers, items, people, vendors or your own) and pick a
 * row; the field keeps the row's text. Typing something not in the master is allowed and shown as such.
 */
export function MasterPicker({
  source,
  value,
  onChange,
  label,
}: {
  source: string;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const opts = useMasterOptions(source, q, open);
  const list = opts.data ?? [];
  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? q : value}
        placeholder={value || t('masters.pick')}
        onFocus={() => (setQ(''), setOpen(true))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault();
            onChange(list[0].value);
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-control border bg-card p-1 shadow-lg"
        >
          {opts.isPending ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</li>
          ) : !list.length ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.noMatch')}</li>
          ) : (
            list.map((o) => (
              <li
                key={`${o.value}${o.sub}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => (e.preventDefault(), onChange(o.value), setOpen(false))}
                className={cn(
                  'cursor-pointer rounded-control px-3 py-2 text-sm hover:bg-muted',
                  o.value === value && 'bg-muted',
                )}
              >
                <div>{o.label}</div>
                {o.sub && <div className="text-xs text-muted-foreground">{o.sub}</div>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
