import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseRef } from '@mono/shared';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/** An item of the item master as the `items` choice source gives it (rate in rupees). */
export type ItemOption = {
  id: string;
  name: string;
  code: string;
  unit: string;
  rate: number;
  stock: number;
};
type Option = {
  label: string;
  sub: string | null;
  ref?: string;
  columns?: { code?: string; unit?: string; rate?: number; stock?: number };
};

const useItems = (q: string, enabled: boolean) =>
  useQuery({
    queryKey: ['masters', 'options', 'items', q],
    queryFn: async () =>
      (await api<Option[]>(`/api/masters/options?source=items&q=${encodeURIComponent(q)}`)).flatMap(
        (o): ItemOption[] => {
          const id = parseRef(o.ref)?.id;
          const c = o.columns ?? {};
          return id
            ? [
                {
                  ...{ id, name: o.label, code: c.code ?? '', unit: c.unit ?? '' },
                  ...{ rate: Number(c.rate) || 0, stock: Number(c.stock) || 0 },
                },
              ]
            : [];
        },
      ),
    enabled,
    staleTime: 15_000,
  });

/**
 * One line's item (L14): type a code or a name, pick the item. `free` also lets the text stand as typed — the
 * last choice, "Write … as typed" — for forms that allow items outside the master.
 */
export function ItemPicker({
  value,
  picked,
  free,
  label,
  onPick,
  onTyped,
}: {
  value: string;
  /** The line holds an item of the master (not typed text). */
  picked: boolean;
  free: boolean;
  label: string;
  onPick: (item: ItemOption) => void;
  onTyped: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const items = useItems(q.trim(), open);
  const list = items.data ?? [];
  const typed = q.trim();
  // In a short dialog the list would be cut off: bring it into view when it opens and when its choices arrive.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!open || !el) return;
    let box = el.parentElement;
    while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    const over = box ? el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom : 0;
    if (box && over > 0) box.scrollTop += over + 8;
  }, [open, list.length]);
  const choose = (i: ItemOption) => (onPick(i), setOpen(false));
  const write = () => (onTyped(typed), setOpen(false));
  return (
    <div className="relative min-w-0">
      <Input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? q : value}
        placeholder={value || t('stockSteps.line.pick')}
        onFocus={() => (setQ(picked ? '' : value), setOpen(true))}
        // Close a moment after focus leaves (a click on a choice lands first) — but not if focus came straight back.
        onBlur={(e) => {
          const input = e.currentTarget;
          setTimeout(() => document.activeElement !== input && setOpen(false), 150);
        }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (list[0]) choose(list[0]);
          else if (free && typed) write();
        }}
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-56 overflow-auto rounded-control border bg-card p-1 shadow-lg"
        >
          {items.isPending ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{t('common.loading')}</li>
          ) : (
            list.map((o) => (
              <li
                key={o.id}
                role="option"
                aria-selected={picked && o.name === value}
                onMouseDown={(e) => (e.preventDefault(), choose(o))}
                className={cn(
                  'cursor-pointer rounded-control px-3 py-2 text-sm hover:bg-muted',
                  picked && o.name === value && 'bg-muted',
                )}
              >
                <div>{o.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{o.code}</span> ·{' '}
                  {t('stockSteps.line.inStock', { n: o.stock.toLocaleString('en-IN'), unit: o.unit })}
                </div>
              </li>
            ))
          )}
          {!items.isPending && !list.length && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {free ? t('common.noMatch') : t('stockSteps.line.onlyList')}
            </li>
          )}
          {free && typed && !list.some((o) => o.name.toLowerCase() === typed.toLowerCase()) && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => (e.preventDefault(), write())}
              className="cursor-pointer rounded-control border-t px-3 py-2 text-sm hover:bg-muted"
            >
              {t('stockSteps.line.useTyped', { text: typed })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
