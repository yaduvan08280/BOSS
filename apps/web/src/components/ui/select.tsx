import { Check, ChevronDown, Search } from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  Children,
  isValidElement,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { rankOptions, type PickOption } from '@/lib/pick';

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };

/** Plain text of an option's children (names, " · ", designations…). */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

function optionsOf(children: ReactNode): PickOption[] {
  const out: PickOption[] = [];
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    if (c.type === 'option') {
      const p = (c as ReactElement<OptionProps>).props;
      const label = textOf(p.children);
      out.push({ value: String(p.value ?? label), label, disabled: p.disabled });
    } else {
      out.push(...optionsOf((c as ReactElement<{ children?: ReactNode }>).props.children));
    }
  });
  return out;
}

const SEARCH_FROM = 7;

/**
 * Drop-in for a native <select> (same `value`, `onChange(e)` and <option> children), but you can type
 * to filter: every word must match, best matches first. Long lists get a search box; short ones still
 * jump to what you type. Works the same on phones and desktops.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  name,
  id,
  'aria-label': ariaLabel,
}: {
  value?: string | number | readonly string[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const options = useMemo(() => optionsOf(children), [children]);
  const current = String(value ?? '');
  const selected = options.find((o) => o.value === current);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const shown = rankOptions(query, options);
  const searchable = options.length >= SEARCH_FROM;

  const choose = (o: PickOption | undefined) => {
    if (!o || o.disabled) return;
    onChange?.({
      target: { value: o.value },
      currentTarget: { value: o.value },
    } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
  };
  const show = (o: boolean, q = '') => {
    setOpen(o);
    setQuery(q);
    const at = rankOptions(q, options);
    setActive(Math.max(0, q ? 0 : at.findIndex((x) => x.value === current)));
  };
  const move = (by: number) => {
    const next = Math.min(Math.max(active + by, 0), shown.length - 1);
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? move(1) : show(true)),
      ArrowUp: () => move(-1),
      // Enter, Home and End act on the open list; on the closed field Enter just opens it (button default).
      ...(open
        ? {
            Enter: () => choose(shown[active]),
            Home: () => setActive(0),
            End: () => setActive(shown.length - 1),
          }
        : {}),
    };
    const run = keys[e.key];
    if (!run) return;
    e.preventDefault();
    run();
  };
  // Typing on the closed field opens it with that letter already in the search.
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      show(true, e.key);
    } else onKey(e);
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => show(o)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          onKeyDown={onTriggerKey}
          className={cn(
            'flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-control border border-input bg-card px-3 text-left text-base outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:opacity-50 sm:h-10 sm:text-sm',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? options[0]?.label ?? ''}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      {name && <input type="hidden" name={name} value={current} />}
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            if (!searchable && !query) {
              e.preventDefault();
              listRef.current?.focus();
            }
          }}
          className="z-[60] flex max-h-[min(60vh,360px)] w-[var(--radix-popover-trigger-width)] min-w-56 flex-col overflow-hidden rounded-control border bg-card shadow-lg"
        >
          {(searchable || query) && (
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                role="searchbox"
                aria-label={t('common.typeToFilter')}
                placeholder={t('common.typeToFilter')}
                onChange={(e) => (setQuery(e.target.value), setActive(0))}
                onKeyDown={onKey}
                className="h-10 w-full bg-transparent text-base outline-none sm:text-sm"
              />
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onKey}
            className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
          >
            {shown.map((o, i) => (
              <li
                key={`${o.value}-${i}`}
                role="option"
                aria-selected={o.value === current}
                aria-disabled={o.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-[calc(var(--radius)*0.5)] px-2.5 py-2 text-sm',
                  i === active && 'bg-muted',
                  o.disabled && 'cursor-default opacity-40',
                )}
              >
                <span className="min-w-0 break-words">{o.label}</span>
                {o.value === current && <Check className="size-4 shrink-0 text-primary" />}
              </li>
            ))}
            {!shown.length && (
              <li className="px-2.5 py-3 text-sm text-muted-foreground">{t('common.noMatch')}</li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
