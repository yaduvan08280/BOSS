import { useEffect, useState } from 'react';
import { safeStorage } from '@/lib/utils';

const KEY = 'mono.largeText';

export function applyStoredTextSize() {
  if (safeStorage.get(KEY) === '1') document.documentElement.dataset.text = 'large';
}

/** Per-device "larger text" switch (useful for older staff on small phones). */
export function useLargeText(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => safeStorage.get(KEY) === '1');
  useEffect(() => {
    if (on) document.documentElement.dataset.text = 'large';
    else delete document.documentElement.dataset.text;
    safeStorage.set(KEY, on ? '1' : '0');
  }, [on]);
  return [on, setOn];
}
