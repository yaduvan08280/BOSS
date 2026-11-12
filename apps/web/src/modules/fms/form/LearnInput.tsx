import { ChevronDown, List, PencilLine, X } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listKeyOf, type FlowField } from '@mono/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useOffer } from '@/modules/lists/api';
import { mayWrite, offerRows } from '@/modules/lists/offer';
import type { FormOwner, InputProps } from './ctx';

/**
 * A text field that remembers what people type (§2.1): a dropdown of the values already entered, most used
 * first, with "Write…" as the last option. Without an owner (a form that is not saved anywhere yet) there is no
 * list to ask for, so it is a plain text box.
 */
export function LearnInput({ field, value, ctx }: InputProps) {
  const str = typeof value === 'string' ? value : '';
  const set = (v: string) => ctx.set(field.key, v);
  if (!ctx.owner) return <Input value={str} onChange={(e) => set(e.target.value)} />;
  return <LearnPicker field={field} value={str} owner={ctx.owner} onChange={set} />;
}

const row = 'flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-sm';
const note = 'px-3 py-2.5 text-sm text-muted-foreground';

function LearnPicker({
  field,
  value,
  owner,
  onChange,
}: {
  field: FlowField;
  value: string;
  owner: FormOwner;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // null = not chosen yet: an empty list starts as a text box, a list with values as the dropdown.
  const [writing, setWriting] = useState<boolean | null>(null);
  const listId = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const offer = useOffer(listKeyOf(owner, field), open ? q.trim() : '');
  const canWrite = mayWrite(field, offer.data);
  const total = offer.data?.total ?? 0;

  if (writing ?? (offer.isSuccess && total === 0 && canWrite))
    return (
      <div className="space-y-1">
        <div className="flex gap-2">
          <Input
            // Only when the person chose "Write…" — a form that opens on an empty list must not grab the cursor.
            autoFocus={writing === true}
            value={value}
            placeholder={t('lists.writePh')}
            // Once typing has begun it stays a text box, even if the list gets its first value meanwhile.
            onChange={(e) => (setWriting(true), onChange(e.target.value))}
          />
          {total > 0 && (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="size-11 shrink-0 sm:size-10"
              aria-label={t('lists.backToList')}
              title={t('lists.backToList')}
              onClick={() => setWriting(false)}
            >
              <List />
            </Button>
          )}
        </div>
        <span className="block text-xs text-muted-foreground">{t('lists.writeHint')}</span>
      </div>
    );

  const rows = offerRows(offer.data, q, canWrite);
  const count = rows.values.length + (rows.write ? 1 : 0);
  const close = () => (setOpen(false), setQ(''));
  const pick = (v: string) => (onChange(v), close());
  const write = () => {
    if (rows.write?.text) onChange(rows.write.text);
    setWriting(true);
    close();
  };
  const choose = (i: number) => {
    const v = rows.values[i];
    if (v) pick(v.value);
    else if (rows.write && i === rows.values.length) write();
  };
  const move = (by: number) => {
    const next = Math.min(Math.max(active + by, 0), count - 1);
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <Popover.Root open={open} onOpenChange={(o) => !o && close()}>
      <Popover.Anchor asChild>
        <div ref={anchor} className="relative">
          <Input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="pr-20"
            value={open ? q : value}
            placeholder={value || t(canWrite ? 'lists.pick' : 'lists.pickOnly')}
            onFocus={() => (setQ(''), setActive(0), setOpen(true))}
            // Already focused (a value was just picked): a tap opens the list again.
            onClick={() => setOpen(true)}
            onBlur={close}
            onChange={(e) => (setQ(e.target.value), setActive(0), setOpen(true))}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (open) move(e.key === 'ArrowDown' ? 1 : -1);
                else setOpen(true);
              } else if (e.key === 'Enter' && open) {
                e.preventDefault();
                choose(active);
              }
            }}
          />
          <div className="absolute inset-y-0 right-0 flex items-center">
            {value && !open && (
              <button
                type="button"
                aria-label={t('lists.clear')}
                className="flex h-full w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={(e) => (e.preventDefault(), onChange(''))}
              >
                <X className="size-4" />
              </button>
            )}
            <ChevronDown className="pointer-events-none mr-3 size-4 text-muted-foreground" aria-hidden />
          </div>
        </div>
      </Popover.Anchor>
      {/* In a portal, so a dialog's scroll area never cuts the list off. */}
      <Popover.Portal>
        <Popover.Content
          id={listId}
          role="listbox"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          // The cursor stays in the box: typing filters, and a tap on a row must not blur it first.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => anchor.current?.contains(e.target as Node) && e.preventDefault()}
          className="z-[60] flex max-h-[min(50vh,320px)] w-[var(--radix-popover-trigger-width)] min-w-56 flex-col overflow-hidden rounded-control border bg-card p-1 shadow-lg"
        >
          <div role="presentation" className="min-h-0 flex-1 overflow-y-auto">
            {offer.isPending && <p className={note}>{t('common.loading')}</p>}
            {offer.isError && <p className={cn(note, 'text-status-bad-fg')}>{t('lists.loadFailed')}</p>}
            {rows.values.map((v, i) => (
              <div
                key={v.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={v.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(v.value)}
                className={cn(row, i === active && 'bg-muted', v.value === value && 'font-medium')}
              >
                <span className="min-w-0 break-words">{v.value}</span>
              </div>
            ))}
            {offer.isSuccess && !rows.values.length && q.trim() && (
              <p className={note}>{t('common.noMatch')}</p>
            )}
          </div>
          {/* Below the scrolling values, so the last choice is always in sight. */}
          {rows.values.length > 0 && <div role="separator" className="my-1 shrink-0 border-t" />}
          {rows.write ? (
            <div
              id={`${listId}-${rows.values.length}`}
              role="option"
              aria-selected={false}
              onMouseEnter={() => setActive(rows.values.length)}
              onClick={write}
              className={cn(row, 'shrink-0 font-medium', active === rows.values.length && 'bg-muted')}
            >
              <PencilLine className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 break-words">
                {rows.write.text ? t('lists.writeThis', { value: rows.write.text }) : t('lists.write')}
              </span>
            </div>
          ) : (
            offer.isSuccess && <p className={cn(note, 'shrink-0 text-xs')}>{t('lists.adminsOnly')}</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
