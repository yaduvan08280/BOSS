import { useEffect, useState } from 'react';

/**
 * True when the page's content area is narrower than `px` — a wide table would not fit and should be shown as
 * cards instead. It follows the real room left (the window, the browser's zoom, the side menu open or folded),
 * not only "is this a phone".
 */
export function useTooNarrow(px: number) {
  const room = () => {
    const main = typeof document === 'undefined' ? null : document.querySelector('main');
    if (!main) return false;
    const style = getComputedStyle(main);
    return main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) < px;
  };
  const [narrow, setNarrow] = useState(room);
  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const on = () => setNarrow(room());
    on();
    const watch = new ResizeObserver(on);
    watch.observe(main);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [px]);
  return narrow;
}
