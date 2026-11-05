/**
 * The browser's "install this app" offer (Chrome / Edge / Android). It fires once, early, so it is caught at
 * start-up and kept until the person taps Install. iPhones have no such event: they get a "Share → Add to Home
 * Screen" hint instead.
 */
type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    changed();
  });
}

export const subscribeInstall = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const canPrompt = () => Boolean(deferred);

export async function promptInstall() {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  changed();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Safari on iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
