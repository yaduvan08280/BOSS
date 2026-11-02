import type { KeyboardEvent } from 'react';

/** Arrow keys move through results, Enter opens, Escape clears. */
export function handleListKeys(
  e: KeyboardEvent,
  opts: {
    count: number;
    setActive: (fn: (a: number) => number) => void;
    onEnter: () => void;
    onEscape?: () => void;
  },
) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    opts.setActive((a) => Math.min(a + 1, opts.count - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    opts.setActive((a) => Math.max(a - 1, 0));
  } else if (e.key === 'Enter') {
    opts.onEnter();
  } else if (e.key === 'Escape') {
    opts.onEscape?.();
  }
}
