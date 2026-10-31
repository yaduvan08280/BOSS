import { contrast, ensureContrast, hexToOklch, isHexColor, oklch } from './color';
import { STATUS_COLORS, STATUS_HUE_RANGES, STATUS_TONES } from './status';

export type ThemeOptions = {
  /** Seed colour, any hex. */
  seed: string;
  /** 0 = pure grey neutrals, 100 = strongly tinted towards the seed hue. */
  warmth: number;
  /** Corner radius for cards, in px (4–22). */
  radius: number;
  sidebar: 'dark' | 'light';
  /** Primary buttons in the seed colour, or in ink. */
  buttons: 'accent' | 'ink';
  mode: 'light' | 'dark';
};

export const DEFAULT_THEME: Omit<ThemeOptions, 'mode'> = {
  seed: '#EFC75E',
  warmth: 45,
  radius: 14,
  sidebar: 'dark',
  buttons: 'accent',
};

export const THEME_PRESETS: Record<string, Omit<ThemeOptions, 'mode'>> = {
  'ink-honey': DEFAULT_THEME,
  ink: { seed: '#1C1B19', warmth: 30, radius: 12, sidebar: 'dark', buttons: 'ink' },
  quartz: { seed: '#1F3A5F', warmth: 55, radius: 14, sidebar: 'light', buttons: 'accent' },
  indigo: { seed: '#4F46E5', warmth: 20, radius: 10, sidebar: 'light', buttons: 'accent' },
};

/** A curated pool shown as swatches in Appearance (any colour is still allowed via the picker). */
export const SEED_POOL = [
  '#EFC75E',
  '#E9A23B',
  '#D9822B',
  '#C8553D',
  '#B23A48',
  '#D4537E',
  '#9C4F96',
  '#6E4BB8',
  '#4F46E5',
  '#2F5BD3',
  '#1F3A5F',
  '#2B7BB9',
  '#1695A3',
  '#0F7B6C',
  '#2E8B57',
  '#5C8A2E',
  '#8A8B2E',
  '#A07A3B',
  '#7A5C43',
  '#5B5F66',
  '#334155',
  '#1C1B19',
  '#0E5A6E',
  '#7C2D12',
  '#BE185D',
  '#0891B2',
  '#65A30D',
  '#CA8A04',
  '#9333EA',
  '#DC2626',
] as const;

export type ThemeTokens = Record<string, string>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Generate every CSS variable (without the leading `--`) for a theme. */
export function generateTheme(input: ThemeOptions): ThemeTokens {
  const seed = isHexColor(input.seed) ? input.seed.toUpperCase() : DEFAULT_THEME.seed;
  const { l: L, c: C, h: H } = hexToOklch(seed);
  const nc = 0.003 + (clamp(input.warmth, 0, 100) / 100) * 0.028;
  const dark = input.mode === 'dark';
  const t: ThemeTokens = {};

  if (!dark) {
    t.background = oklch(0.955, nc, H);
    t.card = oklch(0.987, nc * 0.5, H);
    t.muted = oklch(0.93, nc * 1.1, H);
    t.border = oklch(0.895, nc, H);
    t.foreground = oklch(0.22, nc * 0.7, H);
    t['muted-foreground'] = oklch(0.47, nc, H);
    t.ink = oklch(0.22, nc * 0.9, H);
    t['ink-foreground'] = oklch(0.985, nc * 0.4, H);
    t.accent = seed;
    t['accent-soft'] = oklch(0.935, Math.min(C, 0.06), H);
    t['accent-soft-foreground'] = oklch(0.38, Math.min(C, 0.12), H);
  } else {
    t.background = oklch(0.175, nc, H);
    t.card = oklch(0.215, nc, H);
    t.muted = oklch(0.255, nc, H);
    t.border = oklch(0.31, nc, H);
    t.foreground = oklch(0.95, nc * 0.4, H);
    t['muted-foreground'] = oklch(0.73, nc, H);
    t.ink = oklch(0.93, nc * 0.6, H);
    t['ink-foreground'] = oklch(0.2, nc, H);
    t.accent = oklch(clamp(L, 0.68, 0.84), C, H);
    t['accent-soft'] = oklch(0.3, Math.min(C, 0.07), H);
    t['accent-soft-foreground'] = oklch(0.86, Math.min(C, 0.1), H);
  }

  if (input.sidebar === 'dark') {
    t.sidebar = dark ? oklch(0.135, nc, H) : oklch(0.215, nc * 1.1, H);
    t['sidebar-foreground'] = oklch(0.88, nc, H);
    t['sidebar-muted'] = oklch(0.64, nc, H);
    t['sidebar-hover'] = dark ? oklch(0.19, nc, H) : oklch(0.27, nc, H);
    t['sidebar-border'] = dark ? oklch(0.2, nc, H) : oklch(0.28, nc, H);
  } else {
    t.sidebar = dark ? oklch(0.2, nc * 1.2, H) : oklch(0.925, nc * 1.3, H);
    t['sidebar-foreground'] = dark ? oklch(0.9, nc, H) : oklch(0.25, nc, H);
    t['sidebar-muted'] = dark ? oklch(0.64, nc, H) : oklch(0.5, nc, H);
    t['sidebar-hover'] = dark ? oklch(0.25, nc, H) : oklch(0.89, nc * 1.3, H);
    t['sidebar-border'] = dark ? oklch(0.27, nc, H) : oklch(0.87, nc, H);
  }

  // Text on the accent: black-ish or white, whichever reads better.
  const nearBlack = oklch(0.2, nc, H);
  t['accent-foreground'] =
    contrast(t.accent!, '#FFFFFF') >= contrast(t.accent!, nearBlack) ? '#FFFFFF' : nearBlack;

  // Guarantee readable pairs (WCAG AA 4.5:1 for text, 3:1 for large/secondary labels).
  t['muted-foreground'] = ensureContrast(t['muted-foreground']!, t.card!, 4.5);
  t['muted-foreground'] = ensureContrast(t['muted-foreground'], t.background!, 4.5);
  t['accent-soft-foreground'] = ensureContrast(t['accent-soft-foreground']!, t['accent-soft']!, 4.5);
  t['sidebar-muted'] = ensureContrast(t['sidebar-muted']!, t.sidebar!, 3);
  t['accent-foreground'] = ensureContrast(t['accent-foreground'], t.accent!, 4.5);

  const accentButtons = input.buttons === 'accent';
  t.primary = accentButtons ? t.accent! : t.ink!;
  t['primary-foreground'] = accentButtons ? t['accent-foreground'] : t['ink-foreground']!;
  t['sidebar-active'] = t.accent!;
  t['sidebar-active-foreground'] = t['accent-foreground'];

  t.popover = t.card!;
  t['popover-foreground'] = t.foreground!;
  t['card-foreground'] = t.foreground!;
  t.input = t.border!;
  t.ring = dark
    ? oklch(clamp(L, 0.7, 0.85), Math.max(C, 0.08), H)
    : oklch(clamp(L, 0.5, 0.65), Math.max(C, 0.1), H);

  const statuses = STATUS_COLORS[input.mode];
  for (const tone of STATUS_TONES) {
    t[`status-${tone}-bg`] = statuses[tone].bg;
    t[`status-${tone}-fg`] = statuses[tone].fg;
    t[`status-${tone}`] = statuses[tone].solid;
  }
  t.destructive = statuses.bad.solid;
  t['destructive-foreground'] = '#FFFFFF';

  t.radius = `${clamp(Math.round(input.radius), 4, 22)}px`;
  return t;
}

/** Which status colour (if any) the seed could be confused with. */
export function seedClashesWithStatus(seed: string): 'bad' | 'warn' | 'ok' | null {
  const { c, h } = hexToOklch(seed);
  if (c < 0.07) return null;
  for (const [tone, [lo, hi]] of Object.entries(STATUS_HUE_RANGES)) {
    if (h >= lo && h <= hi) return tone as 'bad' | 'warn' | 'ok';
  }
  return null;
}

/** Render tokens as a CSS declaration block body: `--background: #...; ...` */
export function tokensToCss(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .map(([k, v]) => `--${k}: ${v};`)
    .join(' ');
}
