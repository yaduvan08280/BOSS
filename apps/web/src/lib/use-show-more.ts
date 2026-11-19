import { useState } from 'react';

/**
 * A long list is drawn a part at a time: a phone that had to lay out five hundred cards at once froze for
 * seconds. `resetKey` (the tab, the filters) starts again from the first part.
 */
export function useShowMore<T>(items: T[], resetKey: string, step = 100) {
  // The count belongs to the list it was made for: another tab or filter starts from the first part again.
  const [state, setState] = useState({ key: resetKey, count: step });
  const count = state.key === resetKey ? state.count : step;
  return {
    rows: items.length > count ? items.slice(0, count) : items,
    left: Math.max(0, items.length - count),
    more: () => setState({ key: resetKey, count: count + step }),
    step,
  };
}
