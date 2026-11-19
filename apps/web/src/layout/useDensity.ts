import { useEffect, useState } from 'react';
import { safeStorage } from '@/lib/utils';

const KEY = 'mono.density';

export function applyStoredDensity() {
  if (safeStorage.get(KEY) === 'compact') document.documentElement.dataset.density = 'compact';
}

/**
 * Per-device "compact" switch (§3.1): the same screens with tighter spacing, for people who want more rows
 * on a desktop. It changes one token (the spacing unit); text size and touch targets on phones stay as they are.
 */
export function useDensity(): [boolean, (compact: boolean) => void] {
  const [compact, setCompact] = useState(() => safeStorage.get(KEY) === 'compact');
  useEffect(() => {
    if (compact) document.documentElement.dataset.density = 'compact';
    else delete document.documentElement.dataset.density;
    safeStorage.set(KEY, compact ? 'compact' : 'comfortable');
  }, [compact]);
  return [compact, setCompact];
}
