import { X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useFieldOptions, type FieldAt, type MasterOption } from './api';

/**
 * A "from a master" field: type to search the source (customers, items, your own masters, the values or the
 * records of another process) and pick; the field keeps the text, and `onPick` is handed the whole choice (its
 * link and its row's other values). With `allowTyped`, text that is in no list can be kept as it is.
 */
export function MasterPicker({
  source,
  value,
  onChange,
  onPick,
  label,
  at = null,
  parent,
  narrow,
  allowTyped = false,
  disabled = false,
  placeholder,
}: {
  source: string;
  value: string;
  /** Text typed and kept, or '' when the field is cleared. */
  onChange: (v: string) => void;
  /** A choice was picked (default: keep its text). */
  onPick?: (o: MasterOption) => void;
  label?: string;
  /** A field of a saved form: the server reads what it may show from the field's own settings. */
  at?: FieldAt | null;
  /** Dependent choices: the value (and link) of the field these choices depend on. */
  parent?: { value?: string; ref?: string };
  /** Narrow the list here as well (a form that is not saved yet has no field for the server to read). */
  narrow?: (o: MasterOption) => boolean;
  allowTyped?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const opts = useFieldOptions(at, source, q, parent, open && !disabled);
  const list = (opts.data ?? []).filter((o) => !narrow || narrow(o));
  const typed = q.trim();
  const canType =
    allowTyped && typed !== '' && !list.some((o) => o.value.toLowerCase() === typed.toLowerCase());
  const rows = list.length + (canType ? 1 : 0);
  const choose = (i: number) => {
    const o = list[i];
    if (o) (onPick ?? ((x: MasterOption) => onChange(x.value)))(o);
    else if (canType) onChange(typed);
    else return;
    setOpen(false);
  };
  const row = 'flex min-h-11 cursor-pointer flex-col justify-center rounded-control px-3 py-1.5 text-sm';
  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        disabled={disabled}
        className={cn(value && !open && 'pr-10')}
        value={open ? q : value}
        placeholder={placeholder ?? (value || t('masters.pick'))}
        onFocus={() => (setQ(''), setActive(0), setOpen(true))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => (setQ(e.target.value), setActive(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (rows ? (a + (e.key === 'ArrowDown' ? 1 : rows - 1)) % rows : 0));
          } else if (e.key === 'Enter' && open && rows) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {value && !open && !disabled && (
        <button
          type="button"
          aria-label={t('links.clear', { field: label ?? '' })}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => onChange('')}
        >
          <X className="size-4" />
        </button>
      )}
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-control border bg-card p-1 shadow-lg"
        >
          {opts.isPending ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</li>
          ) : opts.isError ? (
            <li role="alert" className="px-3 py-2 text-sm text-status-bad-fg">
              {t('links.cantLoad')}
            </li>
          ) : (
            <>
              {!rows && <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.noMatch')}</li>}
              {list.map((o, i) => (
                <li
                  key={o.ref ?? `${o.value}${o.sub}`}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseDown={(e) => (e.preventDefault(), choose(i))}
                  onMouseEnter={() => setActive(i)}
                  className={cn(row, (i === active || o.value === value) && 'bg-muted')}
                >
                  <div className="break-words">{o.label}</div>
                  {o.sub && <div className="text-xs text-muted-foreground">{o.sub}</div>}
                </li>
              ))}
              {canType && (
                <li
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => (e.preventDefault(), choose(list.length))}
                  onMouseEnter={() => setActive(list.length)}
                  className={cn(row, 'border-t', active === list.length && 'bg-muted')}
                >
                  {t('links.useTyped', { text: typed })}
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
