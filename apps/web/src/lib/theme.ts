import { DEFAULT_THEME, generateTheme, type ThemeMode, type ThemeSettings } from '@mono/shared';
import { safeStorage } from './utils';

const CACHE_KEY = 'mono.theme';

export type ResolvedMode = 'light' | 'dark';

export function resolveMode(mode: ThemeMode): ResolvedMode {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Write every generated token onto <html> and keep the PWA status bar in step with the sidebar. */
export function applyTheme(settings: ThemeSettings, mode: ThemeMode) {
  const resolved = resolveMode(mode);
  const tokens = generateTheme({ ...settings, mode: resolved });
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(`--${k}`, v);
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.mode = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.sidebar ?? '#1F1E1B');
  safeStorage.set(CACHE_KEY, JSON.stringify({ settings, mode }));
}

/** Last theme used on this device, so a reload doesn't flash the default colours. */
export function cachedTheme(): { settings: ThemeSettings; mode: ThemeMode } {
  try {
    const raw = safeStorage.get(CACHE_KEY);
    if (raw) return JSON.parse(raw) as { settings: ThemeSettings; mode: ThemeMode };
  } catch {
    /* ignore */
  }
  return { settings: DEFAULT_THEME, mode: 'system' };
}
