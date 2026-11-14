import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * The app-wide rule (decision 237): anything that scrolls sideways because the screen is not wide enough — a
 * table, a grid, a board, a row of chips — gets ◀ ▶ buttons at its edges, so nobody has to find the scrollbar at
 * the bottom of a long table. One watcher for the whole app (mounted once in the shell and on the sign-in pages):
 * every element with `overflow-x-auto`, `overflow-auto` or `data-scroll-x` that holds more than it shows gets the
 * buttons, in the middle of its part that is on screen (so they stay in reach while a long table scrolls by), and
 * only on a side that has more. Swiping, the wheel and the scrollbar still work. `data-no-arrows` opts an element
 * (and everything inside it) out — ScrollRow draws its own.
 */
const SELECTOR = '.overflow-x-auto, .overflow-auto, [data-scroll-x]';
const MIN_HIDDEN = 8;
const GAP = 6;

type Spot = {
  key: number;
  el: HTMLElement;
  host: HTMLElement | null; // null = the page; else the open dialog the buttons are drawn inside
  size: number;
  y: number;
  left: number | null;
  right: number | null;
};

const ids = new WeakMap<HTMLElement, number>();
let next = 1;
const idOf = (el: HTMLElement) => {
  if (!ids.has(el)) ids.set(el, next++);
  return ids.get(el)!;
};

type Box = { top: number; bottom: number; left: number; right: number };

/** The part of `el` that can be seen: its box cut by every ancestor that clips, and by `limit`. */
function visible(el: HTMLElement, limit: Box): Box | null {
  const r = el.getBoundingClientRect();
  let b: Box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  const cut = (c: Box) => {
    b = {
      top: Math.max(b.top, c.top),
      bottom: Math.min(b.bottom, c.bottom),
      left: Math.max(b.left, c.left),
      right: Math.min(b.right, c.right),
    };
  };
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') cut(p.getBoundingClientRect());
  }
  cut(limit);
  return b.bottom - b.top > 0 && b.right - b.left > 0 ? b : null;
}

/** The open modal dialog, if any: Radix switches off pointer events on the page behind it. */
function modalHost(): HTMLElement | null {
  if (document.body.style.pointerEvents !== 'none') return null;
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]');
  return open.length ? open[open.length - 1]! : null;
}

function measure(): Spot[] {
  const host = modalHost();
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // On the page, the sticky top bar and the phone's bottom tabs cover the edges.
  const top = host ? 0 : (document.querySelector('[data-top-bar]')?.getBoundingClientRect().bottom ?? 0);
  const bar = host ? null : document.querySelector<HTMLElement>('[data-bottom-bar]');
  const bottom = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().top : vh;
  const limit: Box = { top, bottom, left: 0, right: vw };
  const origin = host?.getBoundingClientRect();
  // Floating buttons (the assistant) the arrows must not sit under.
  const avoid = host
    ? []
    : [...document.querySelectorAll('[data-avoid-arrows]')].map((a) => a.getBoundingClientRect());

  const out: Spot[] = [];
  for (const el of (host ?? document).querySelectorAll<HTMLElement>(SELECTOR)) {
    if (el.scrollWidth - el.clientWidth < MIN_HIDDEN) continue;
    if (el.closest('[data-no-arrows]')) continue;
    if (!host && el.closest('[role="dialog"]')) continue; // a side sheet that is open without a modal
    const b = visible(el, limit);
    if (!b || b.right - b.left < 120) continue;
    const h = b.bottom - b.top;
    const size = h >= 52 ? 36 : 28;
    if (h < size) continue;
    const moreLeft = el.scrollLeft > 2;
    const moreRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    if (!moreLeft && !moreRight) continue;
    let y = (b.top + b.bottom) / 2 - size / 2;
    for (const a of avoid) {
      const hits = (x: number) => x < a.right && x + size > a.left && y < a.bottom && y + size > a.top;
      if (hits(b.left + GAP) || hits(b.right - size - GAP)) y = Math.max(b.top, a.top - size - 8);
    }
    // Inside a dialog the buttons sit in the dialog (it is positioned), so offsets are the dialog's.
    const dx = origin ? origin.left + (host!.clientLeft || 0) : 0;
    const dy = origin ? origin.top + (host!.clientTop || 0) - host!.scrollTop : 0;
    out.push({
      key: idOf(el),
      el,
      host,
      size,
      y: Math.round(y - dy),
      left: moreLeft ? Math.round(b.left + GAP - dx) : null,
      right: moreRight ? Math.round(b.right - size - GAP - dx) : null,
    });
  }
  return out;
}

const same = (a: Spot[], b: Spot[]) =>
  a.length === b.length &&
  a.every((s, i) => {
    const n = b[i]!;
    return s.key === n.key && s.host === n.host && s.y === n.y && s.left === n.left && s.right === n.right;
  });

export function ScrollArrows() {
  const { t } = useTranslation();
  const [spots, setSpots] = useState<Spot[]>([]);
  const frame = useRef(0);

  useEffect(() => {
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const now = measure();
        setSpots((was) => (same(was, now) ? was : now));
      });
    };
    update();
    // Scrolling anywhere (capture: inner areas too), resizing, and screens changing their content.
    document.addEventListener('scroll', update, { capture: true, passive: true });
    window.addEventListener('resize', update);
    const mo = new MutationObserver(update);
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    const timer = setInterval(update, 1500); // images and fonts that arrive late
    return () => {
      cancelAnimationFrame(frame.current);
      document.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      mo.disconnect();
      clearInterval(timer);
    };
  }, []);

  if (!spots.length) return null;
  const go = (el: HTMLElement, dir: 1 | -1) =>
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.75), behavior: 'smooth' });
  const button = (s: Spot, side: 'left' | 'right') => {
    const label = t(side === 'left' ? 'common.pageLeft' : 'common.pageRight');
    return (
      <button
        key={`${s.key}-${side}`}
        type="button"
        data-scroll-arrow={side}
        onClick={() => go(s.el, side === 'left' ? -1 : 1)}
        aria-label={label}
        title={label}
        style={{
          position: s.host ? 'absolute' : 'fixed',
          top: s.y,
          left: side === 'left' ? s.left! : s.right!,
          width: s.size,
          height: s.size,
        }}
        className="z-20 grid place-items-center rounded-full border bg-card/95 text-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {side === 'left' ? (
          <ChevronLeft className={s.size > 30 ? 'size-5' : 'size-4'} />
        ) : (
          <ChevronRight className={s.size > 30 ? 'size-5' : 'size-4'} />
        )}
      </button>
    );
  };
  const draw = (list: Spot[]) =>
    list.flatMap((s) => [
      ...(s.left !== null ? [button(s, 'left')] : []),
      ...(s.right !== null ? [button(s, 'right')] : []),
    ]);

  const host = spots[0]!.host;
  return createPortal(<>{draw(spots)}</>, host ?? document.body);
}
