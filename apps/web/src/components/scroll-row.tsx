import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/**
 * A row that scrolls sideways when it does not fit: swipe on a phone; with a mouse, the wheel, or the
 * arrows that appear at an edge while there is more that way. The current tab is brought into view.
 */
export function ScrollRow({
  children,
  className,
  label,
  watch,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  /** Changes when the current item changes (a path, a tab key), so it is scrolled into view. */
  watch?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(el);
    if (el.firstElementChild) watcher.observe(el.firstElementChild);
    // A mouse wheel moves the row sideways (only while it has somewhere to go).
    const wheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      watcher.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, [measure]);

  useEffect(() => {
    const el = ref.current;
    const now = el?.querySelector<HTMLElement>('[aria-current="page"], [data-current="true"]');
    if (!el || !now) return;
    const a = now.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    if (a.left < b.left + 36) el.scrollLeft -= b.left + 36 - a.left;
    else if (a.right > b.right - 36) el.scrollLeft += a.right - (b.right - 36);
  }, [watch]);

  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' });
  };
  const arrow = (side: 'left' | 'right') => (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => step(side === 'left' ? -1 : 1)}
      aria-label={t(side === 'left' ? 'common.scrollLeft' : 'common.scrollRight')}
      className={cn(
        'absolute top-0 bottom-0 z-10 hidden w-10 items-center text-foreground sm:flex',
        side === 'left'
          ? 'left-0 justify-start bg-gradient-to-r from-background from-55% to-transparent'
          : 'right-0 justify-end bg-gradient-to-l from-background from-55% to-transparent',
      )}
    >
      <span className="grid size-7 place-items-center rounded-pill border bg-card shadow-sm">
        {side === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
      </span>
    </button>
  );

  return (
    <div className="relative">
      {more.left && arrow('left')}
      <div
        ref={ref}
        onScroll={measure}
        role={label ? 'navigation' : undefined}
        aria-label={label}
        className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}
      >
        {children}
      </div>
      {more.right && arrow('right')}
    </div>
  );
}
